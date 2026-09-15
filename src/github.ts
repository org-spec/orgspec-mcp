import {
  type ContextSource,
  type FileChange,
  type WriteMode,
  type WriteResult,
  isRepoName,
  proposalBranchName,
  validateContextFile,
  validateWritable,
} from "./source.js";

const API = "https://api.github.com";
const CACHE_TTL_MS = 30_000;

/** The repository has no commits yet — a normal onboarding state, not a failure. */
export class EmptyRepoError extends Error {
  constructor(owner: string, repo: string) {
    super(`Repository ${owner}/${repo} is empty (no commits yet).`);
    this.name = "EmptyRepoError";
  }
}

interface CacheEntry<T> {
  at: number;
  value: T;
}

/**
 * An org-context repository on GitHub, read and written through the REST API.
 * No local clone and no git binary required. In "propose" mode every change
 * becomes a branch + pull request for human review.
 */
export class GitHubSource implements ContextSource {
  private readonly owner: string;
  private readonly repo: string;
  /** `/repos/<owner>/<repo>`, URL-encoded once — every API path starts here. */
  private readonly base: string;
  private branch?: string;
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  /** `token` is a static token or a provider — GitHub App installation tokens expire hourly. */
  constructor(
    repo: string,
    private readonly token: string | (() => Promise<string>),
    branch?: string,
  ) {
    if (!isRepoName(repo)) throw new Error(`Expected 'owner/repo' (letters, digits, '-', '_', '.'), got: ${repo}`);
    [this.owner, this.repo] = repo.split("/");
    this.base = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    this.branch = branch;
  }

  describe(): string {
    return `github.com/${this.owner}/${this.repo}${this.branch ? `@${this.branch}` : ""}`;
  }

  fileUrl(rel: string): string {
    return `https://github.com/${this.owner}/${this.repo}/blob/${this.branch ?? "HEAD"}/${rel}`;
  }

  private async api<T>(
    method: string,
    apiPath: string,
    body?: unknown,
    raw = false,
  ): Promise<{ status: number; data: T }> {
    const token = typeof this.token === "string" ? this.token : await this.token();
    const res = await fetch(`${API}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "org-context-mcp",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok && res.status !== 404) {
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* not json */
      }
      if (res.status === 409 && /empty/i.test(message)) {
        throw new EmptyRepoError(this.owner, this.repo);
      }
      if (res.status === 403 && /not accessible by personal access token/i.test(message)) {
        throw new Error(
          `GitHub API ${method} ${apiPath}: 403 — the token lacks a required permission. ` +
            `A fine-grained token needs Contents (read/write) AND Pull requests (read/write) ` +
            `on ${this.owner}/${this.repo} for propose mode.`,
        );
      }
      throw new Error(`GitHub API ${method} ${apiPath}: ${res.status} ${message}`);
    }
    const data = (raw ? text : text ? JSON.parse(text) : null) as T;
    return { status: res.status, data };
  }

  private cached<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.value;
    return undefined;
  }

  private setCache(key: string, value: unknown): void {
    this.cache.set(key, { at: Date.now(), value });
  }

  private async defaultBranch(): Promise<string> {
    if (this.branch) return this.branch;
    const { status, data } = await this.api<{ default_branch: string }>("GET", this.base);
    if (status === 404) throw new Error(`Repository not found: ${this.owner}/${this.repo}`);
    this.branch = data.default_branch;
    return this.branch;
  }

  async listFiles(): Promise<string[]> {
    const hit = this.cached<string[]>("tree");
    if (hit) return hit;
    const branch = await this.defaultBranch();
    let status: number;
    let data: { tree: { path: string; type: string }[]; truncated: boolean };
    try {
      ({ status, data } = await this.api<{ tree: { path: string; type: string }[]; truncated: boolean }>(
        "GET",
        `${this.base}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      ));
    } catch (err) {
      // An empty repo simply has no files yet — onboarding, not failure.
      if (err instanceof EmptyRepoError) return [];
      throw err;
    }
    if (status === 404) throw new Error(`Branch not found: ${branch}`);
    const files = data.tree
      .filter((e) => e.type === "blob" && e.path.endsWith(".md") && !e.path.split("/").some((s) => s.startsWith(".")))
      .map((e) => e.path)
      .sort();
    this.setCache("tree", files);
    return files;
  }

  async readFile(rel: string): Promise<string> {
    rel = validateContextFile(rel);
    const key = `file:${rel}`;
    const hit = this.cached<string>(key);
    if (hit !== undefined) return hit;
    const branch = await this.defaultBranch();
    const { status, data } = await this.api<string>(
      "GET",
      `${this.base}/contents/${encodePath(rel)}?ref=${encodeURIComponent(branch)}`,
      undefined,
      true,
    );
    if (status === 404) throw new Error(`No such context file: ${rel}`);
    this.setCache(key, data);
    return data;
  }

  async writeFiles(changes: FileChange[], summary: string, mode: WriteMode): Promise<WriteResult> {
    if (changes.length === 0) throw new Error("A proposal needs at least one file change.");
    const seen = new Set<string>();
    const validated = changes.map((c) => {
      const rel = validateWritable(c.file);
      if (seen.has(rel)) throw new Error(`Duplicate file in one proposal: ${rel}`);
      seen.add(rel);
      return { rel, content: c.content };
    });
    const base = await this.defaultBranch();
    const existing = new Set(await this.listFiles());
    const files: WriteResult["files"] = validated.map(({ rel }) => ({
      file: rel,
      action: existing.has(rel) ? "updated" : "created",
    }));

    const invalidate = (): void => {
      this.cache.delete("tree");
      for (const { rel } of validated) this.cache.delete(`file:${rel}`);
    };

    let refSha: string | undefined;
    try {
      const { status, data: ref } = await this.api<{ object: { sha: string } }>(
        "GET",
        `${this.base}/git/ref/heads/${encodeURIComponent(base)}`,
      );
      if (status !== 404) refSha = ref.object.sha;
    } catch (err) {
      if (!(err instanceof EmptyRepoError)) throw err;
    }

    if (!refSha) {
      // Empty repository: no base to build a tree on. Seed it with direct
      // contents commits — subsequent proposals get the branch + PR flow.
      for (const { rel, content } of validated) {
        await this.api("PUT", `${this.base}/contents/${encodePath(rel)}`, {
          message: summary,
          content: Buffer.from(content, "utf8").toString("base64"),
          branch: base,
        });
      }
      invalidate();
      return {
        files,
        committed: true,
        note: `Repository was empty — seeded directly with ${validated.length} file(s). Further changes become pull requests.`,
      };
    }

    // One tree, one commit — regardless of how many files the proposal touches.
    const { data: baseCommit } = await this.api<{ tree: { sha: string } }>(
      "GET",
      `${this.base}/git/commits/${refSha}`,
    );
    const { data: newTree } = await this.api<{ sha: string }>("POST", `${this.base}/git/trees`, {
      base_tree: baseCommit.tree.sha,
      tree: validated.map(({ rel, content }) => ({ path: rel, mode: "100644", type: "blob", content })),
    });
    const { data: commit } = await this.api<{ sha: string }>("POST", `${this.base}/git/commits`, {
      message: summary,
      tree: newTree.sha,
      parents: [refSha],
    });
    invalidate();

    if (mode === "direct") {
      await this.api("PATCH", `${this.base}/git/refs/heads/${encodeURIComponent(base)}`, {
        sha: commit.sha,
      });
      return { files, committed: true };
    }

    const branch = proposalBranchName(summary);
    await this.api("POST", `${this.base}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
    const fileList = files.map((f) => `- \`${f.file}\` (${f.action})`).join("\n");
    const { data: pr } = await this.api<{ html_url: string }>("POST", `${this.base}/pulls`, {
      title: summary,
      head: branch,
      base,
      body:
        `Proposed context change from org-context-mcp.\n\n` +
        `${fileList}\n\n` +
        `The model recommends, a human decides — review and merge to accept.`,
    });
    return { files, committed: true, branch, pullRequest: pr.html_url };
  }
}

/** Encode a repo path for a URL, keeping the `/` separators. */
function encodePath(rel: string): string {
  return rel.split("/").map(encodeURIComponent).join("/");
}
