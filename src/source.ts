import { promises as fs } from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type WriteMode = "direct" | "propose";

/** One file in a proposal. */
export interface FileChange {
  file: string;
  content: string;
}

export interface WriteResult {
  files: { file: string; action: "created" | "updated" }[];
  committed: boolean;
  branch?: string;
  pullRequest?: string;
  /** Human/agent-readable remark about how the write was handled. */
  note?: string;
}

/**
 * A store holding an org-context repository. Two implementations:
 * a local folder (optionally a git clone) and a GitHub repository
 * reached through the REST API.
 */
export interface ContextSource {
  /** Canonical URL of a file for humans, if the backend has one (used for citations). */
  fileUrl?(rel: string): string;
  /** All markdown files in the context, as sorted repo-relative paths. */
  listFiles(): Promise<string[]>;
  /** Read one file. Throws if it does not exist. */
  readFile(rel: string): Promise<string>;
  /**
   * Apply one proposal — a coherent set of file changes — per the write mode.
   * One call = one commit (and in propose mode one branch + pull request),
   * regardless of how many files the proposal touches.
   */
  writeFiles(changes: FileChange[], summary: string, mode: WriteMode): Promise<WriteResult>;
  /** Human-readable description for the startup log. */
  describe(): string;
}

/** Refuse empty, absolute, or root-escaping paths. */
export function validateRel(rel: string): string {
  const normalized = rel.replaceAll("\\", "/");
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((seg) => seg === "..")
  ) {
    throw new Error(`Path escapes the context repository: ${rel}`);
  }
  return normalized;
}

/**
 * A file the server may READ: markdown, with no hidden segment. The same
 * filter listFiles applies — so a single-file read cannot reach what the
 * listing hides (.env, .github/workflows, tool configuration).
 */
export function validateContextFile(rel: string): string {
  const normalized = validateRel(rel);
  if (!normalized.endsWith(".md")) throw new Error(`Not a context file — only .md files are served: ${rel}`);
  if (normalized.split("/").some((seg) => seg.startsWith("."))) {
    throw new Error(`Not a context file — hidden paths are not served: ${rel}`);
  }
  return normalized;
}

/** The spec's top-level directories; README.md is the only file at the root. */
export const CONTEXT_DIRS = ["organisation", "products", "teams", "method", "system"] as const;

/**
 * A file a proposal may WRITE: inside the spec's structure. Keeps proposals
 * from planting agent-instruction files (AGENTS.md, CLAUDE.md, .github/…)
 * that other tools would obey — the structure is the contract.
 */
export function validateWritable(rel: string): string {
  const normalized = validateContextFile(rel);
  const [top, ...rest] = normalized.split("/");
  const inside = rest.length === 0 ? top === "README.md" : (CONTEXT_DIRS as readonly string[]).includes(top);
  if (!inside) {
    throw new Error(
      `Context files live in README.md or under ${CONTEXT_DIRS.map((d) => `${d}/`).join(", ")} — not ${rel}. ` +
        `Other repository files are outside the scope of a context proposal.`,
    );
  }
  return normalized;
}

/** GitHub's `owner/repo`: the characters GitHub itself allows, no dot segments. */
export function isRepoName(s: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s) && s.split("/").every((seg) => seg !== "." && seg !== "..");
}

export function proposalBranchName(summary: string): string {
  const slug =
    summary
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "change";
  return `context/${slug}-${Date.now().toString(36)}`;
}

/** A local org-context folder; commits via the git CLI when it is a repo. */
export class LocalSource implements ContextSource {
  constructor(private readonly root: string) {}

  describe(): string {
    return this.root;
  }

  private resolve(rel: string): string {
    const abs = path.resolve(this.root, validateRel(rel));
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error(`Path escapes the context repository: ${rel}`);
    }
    return abs;
  }

  async listFiles(): Promise<string[]> {
    const out: string[] = [];
    const root = this.root;
    async function walk(dir: string): Promise<void> {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else if (entry.name.endsWith(".md")) out.push(path.relative(root, abs).replaceAll(path.sep, "/"));
      }
    }
    await walk(root);
    return out.sort();
  }

  async readFile(rel: string): Promise<string> {
    return fs.readFile(this.resolve(validateContextFile(rel)), "utf8");
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      await exec("git", ["rev-parse", "--git-dir"], { cwd: this.root });
      return true;
    } catch {
      return false;
    }
  }

  async writeFiles(changes: FileChange[], summary: string, mode: WriteMode): Promise<WriteResult> {
    if (changes.length === 0) throw new Error("A proposal needs at least one file change.");
    const validated: { rel: string; abs: string; content: string }[] = [];
    const seen = new Set<string>();
    for (const c of changes) {
      const rel = validateWritable(c.file);
      if (seen.has(rel)) throw new Error(`Duplicate file in one proposal: ${rel}`);
      seen.add(rel);
      validated.push({ rel, abs: this.resolve(rel), content: c.content });
    }
    const files: WriteResult["files"] = [];
    for (const { rel, abs } of validated) {
      let action: "created" | "updated" = "created";
      try {
        await fs.access(abs);
        action = "updated";
      } catch {
        /* new file */
      }
      files.push({ file: rel, action });
    }

    const writeAll = async (): Promise<void> => {
      for (const { abs, content } of validated) {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, "utf8");
      }
    };
    const rels = validated.map((v) => v.rel);

    if (!(await this.isGitRepo())) {
      await writeAll();
      return { files, committed: false };
    }

    if (mode === "direct") {
      await writeAll();
      await exec("git", ["add", "--", ...rels], { cwd: this.root });
      await exec("git", ["commit", "-m", summary], { cwd: this.root });
      return { files, committed: true };
    }

    // propose: one commit on a new branch, then return to the original branch
    const branch = proposalBranchName(summary);
    const { stdout: cur } = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: this.root });
    const original = cur.trim();
    await exec("git", ["checkout", "-b", branch], { cwd: this.root });
    try {
      await writeAll();
      await exec("git", ["add", "--", ...rels], { cwd: this.root });
      await exec("git", ["commit", "-m", summary], { cwd: this.root });
    } finally {
      await exec("git", ["checkout", original], { cwd: this.root });
    }
    return { files, committed: true, branch };
  }
}
