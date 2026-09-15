#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { buildServer } from "./server.js";
import { LocalSource, type ContextSource, type WriteMode } from "./source.js";
import { GitHubSource } from "./github.js";
import { auditSource, renderAudit } from "./audit.js";
import { serverName } from "./connect.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const githubRepo = argValue("--github") ?? process.env.ORG_CONTEXT_GITHUB;

// Local folder: commit directly (it is the user's own clone; nothing leaves the
// machine). GitHub: propose — a shared repository gets a pull request unless
// the user explicitly asks for direct commits.
const requestedWriteMode = argValue("--write-mode") ?? process.env.ORG_CONTEXT_WRITE_MODE;
const writeMode: WriteMode = requestedWriteMode
  ? requestedWriteMode === "propose"
    ? "propose"
    : "direct"
  : githubRepo
    ? "propose"
    : "direct";
const contextRoot = path.resolve(
  argValue("--context") ?? process.env.ORG_CONTEXT_PATH ?? ".",
);

async function main(): Promise<void> {
  if (process.argv[2] === "serve") {
    // The HTTP server (MCP endpoint, web view, /setup, OAuth) — configured by
    // environment variables, documented at the top of http.ts. Self-hosting entry.
    await import("./http.js");
    return;
  }
  if (process.argv[2] === "audit") {
    // Reproducible report over a local context folder — for CI and the terminal.
    // Exit code is always 0: findings are signals, not a gate.
    const dir = path.resolve(process.argv.find((a, i) => i > 2 && !a.startsWith("--")) ?? ".");
    const findings = await auditSource(new LocalSource(dir));
    process.stdout.write(
      process.argv.includes("--json")
        ? `${JSON.stringify({ generatedAt: new Date().toISOString(), root: dir, findings }, null, 2)}\n`
        : renderAudit(findings),
    );
    return;
  }
  let source: ContextSource;
  if (githubRepo) {
    const token =
      process.env.ORG_CONTEXT_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
    if (!token) {
      console.error(
        "orgspec: --github requires a token in ORG_CONTEXT_GITHUB_TOKEN or GITHUB_TOKEN",
      );
      process.exit(1);
    }
    source = new GitHubSource(
      githubRepo,
      token,
      argValue("--branch") ?? process.env.ORG_CONTEXT_BRANCH,
    );
  } else {
    try {
      const stat = await fs.stat(contextRoot);
      if (!stat.isDirectory()) throw new Error("not a directory");
    } catch {
      console.error(`orgspec: context path is not a directory: ${contextRoot}`);
      process.exit(1);
    }
    source = new LocalSource(contextRoot);
  }
  const server = buildServer(source, writeMode, githubRepo ? serverName(githubRepo) : "org-context");
  await server.connect(new StdioServerTransport());
  console.error(`orgspec: serving ${source.describe()} (write mode: ${writeMode})`);
}

void main();
