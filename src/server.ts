import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { auditSource, renderAudit } from "./audit.js";
import { emptyRepoGuide, templateFallback } from "./onboarding.js";
import type { ContextSource, WriteMode } from "./source.js";
import { VERSION } from "./version.js";

const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

/** A small mark for clients that show one: three lines on the accent green. */
const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f6f5f"/>' +
      '<path d="M18 22h28M18 32h20M18 42h14" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>',
  );

/** Reads never change anything; a proposal writes, but only a branch + PR — nothing is destroyed. */
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const PROPOSE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/**
 * Register all org-context tools on a fresh MCP server. `name` is what the
 * client shows — org-context-<org> for a connected repository, so a person
 * with several contexts can tell them apart.
 */
export function buildServer(source: ContextSource, writeMode: WriteMode, name = "org-context"): McpServer {
  const server = new McpServer({
    name,
    version: VERSION,
    title: name,
    websiteUrl: "https://orgspec.org",
    icons: [{ src: ICON, mimeType: "image/svg+xml", sizes: ["any"] }],
  });

  server.registerTool(
    "get_context",
    {
      description:
        "Read the organizational context (Org Context Spec repo). Without arguments: returns the " +
        "context README (the reading order and writing rules — always start here) plus a list of all " +
        "context files — or, for a new/empty repository, onboarding instructions for seeding it. " +
        "With a path: returns that file, or its starter template if the file does not exist yet. " +
        "Read the relevant context BEFORE writing code, stories, or product documents. If you know " +
        "which team you work for, read teams/<team>.md early — it maps the team's tracker, systems, " +
        "and product areas.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Relative path to a context file, e.g. 'products/parking/product.md'. Omit for the README + file list."),
      },
      annotations: READ,
    },
    async ({ path: rel }) => {
      if (rel) {
        try {
          return text(await source.readFile(rel));
        } catch (err) {
          // The file (or the whole repo) does not exist yet — serve the spec's
          // starter template so the agent can propose the file into being.
          const template = templateFallback(rel);
          if (template !== undefined) return text(template);
          throw err;
        }
      }
      const files = await source.listFiles();
      if (files.length === 0) return text(emptyRepoGuide(source.describe()));
      let readme = "";
      try {
        readme = await source.readFile("README.md");
      } catch {
        readme = "(no README.md in the context repository)";
      }
      // The audit: what the context does not say yet. Signals for the agent
      // to raise when they matter to the task — never to fix unprompted.
      const findings = await auditSource(source);
      const auditText = findings.length
        ? `\n\n---\n\n${renderAudit(findings, { title: "Context audit — what the context does not say yet", limit: 15 })}` +
          `\nWhen a finding blocks or weakens the current task, tell the user and offer to fill it: read the ` +
          `template via get_context, fill it with what the user knows, propose via propose_context_change. ` +
          `Do not fill gaps unprompted or with invented content.`
        : "";
      return text(`${readme}\n\n---\n\nAll context files:\n${files.map((f) => `- ${f}`).join("\n")}${auditText}`);
    },
  );

  server.registerTool(
    "propose_context_change",
    {
      description:
        "Propose one coherent change to the context — one or several files that together make up a " +
        "single logical decision. Bundle everything that belongs together into ONE call: one proposal " +
        "becomes one commit (and one pull request for review), never one per file. IMPORTANT: the " +
        "model recommends, a human decides — show the user exactly what will change and get their " +
        "explicit approval BEFORE calling this tool. Provide the complete new content of each file.",
      inputSchema: {
        changes: z
          .array(
            z.object({
              file: z.string().describe("Relative path of the context file, e.g. 'products/parking/product.md'."),
              new_content: z.string().describe("The complete new content of the file."),
            }),
          )
          .min(1)
          .describe("The file changes making up this ONE proposal — all files that belong to the same decision."),
        summary: z
          .string()
          .describe(
            "One-line summary of the decision, used as the commit message and pull request title. " +
              "E.g. 'Update parking effect goal target to 4 min and the actor assumption it rests on'.",
          ),
      },
      annotations: PROPOSE,
    },
    async ({ changes, summary }) => {
      return text(
        await source.writeFiles(
          changes.map((c) => ({ file: c.file, content: c.new_content })),
          summary,
          writeMode,
        ),
      );
    },
  );

  // ChatGPT connectors require tools named exactly `search` and `fetch` outside
  // developer mode. Thin views over the same files — no new capability.
  server.registerTool(
    "search",
    {
      description: "Search the organizational context files. Returns matching files; use fetch to read one.",
      inputSchema: { query: z.string().describe("Search query") },
      annotations: READ,
    },
    async ({ query }) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const files = await source.listFiles();
      const hits: { id: string; title: string; url: string; score: number }[] = [];
      for (const id of files) {
        const body = await source.readFile(id).catch(() => "");
        const hay = `${id}\n${body}`.toLowerCase();
        const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
        if (score > 0 || terms.length === 0) hits.push({ id, title: titleOf(id, body), url: urlOf(source, id), score });
      }
      hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      return text({ results: hits.slice(0, 20).map(({ score: _s, ...h }) => h) });
    },
  );

  server.registerTool(
    "fetch",
    {
      description: "Read one organizational context file by id (its path, as returned by search).",
      inputSchema: { id: z.string().describe("File path, e.g. 'organisation/constraints.md'") },
      annotations: READ,
    },
    async ({ id }) => {
      const body = await source.readFile(id);
      return text({ id, title: titleOf(id, body), text: body, url: urlOf(source, id), metadata: {} });
    },
  );

  return server;
}

function titleOf(id: string, body: string): string {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id;
}

function urlOf(source: ContextSource, id: string): string {
  return source.fileUrl?.(id) ?? `${source.describe()}/${id}`;
}
