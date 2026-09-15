// Netlify Function entry — with a git-linked site, Netlify bundles this
// itself on every push.
//
// Two modes, decided per request:
//
// 1. Bring your own repo (multi-tenant, stateless): the client sends
//    X-Org-Context-Repo plus its own GitHub token as the Bearer key — see
//    src/tenant.ts. No server configuration needed; the token is the auth.
//
// 2. Default repo (single-tenant): no X-Org-Context-Repo header. Configure
//    in the Netlify UI (Environment variables):
//      ORG_CONTEXT_GITHUB        owner/repo holding the org context
//      ORG_CONTEXT_GITHUB_TOKEN  fine-grained token for that repo (contents + PRs)
//      MCP_ACCESS_KEY            shared Bearer key clients must send
//      ORG_CONTEXT_WRITE_MODE    direct | propose (default: propose)
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "../../src/server.js";
import { GitHubSource } from "../../src/github.js";
import { SourcePool, tenantFromHeaders } from "../../src/tenant.js";
import type { ContextSource, WriteMode } from "../../src/source.js";
import { wwwAuthenticate } from "../../src/oauth.js";
import { serverName } from "../../src/connect.js";
import { equalSecrets } from "../../src/secret.js";

// Module scope: read caches survive while the function instance is warm.
const pool = new SourcePool();
let envSource: GitHubSource | undefined;

function getEnvSource(): GitHubSource {
  if (!envSource) {
    const repo = process.env.ORG_CONTEXT_GITHUB ?? "";
    const token = process.env.ORG_CONTEXT_GITHUB_TOKEN ?? "";
    if (!repo || !token) {
      throw new Error(
        "No default repo configured. Either send X-Org-Context-Repo + your GitHub token " +
          "as Bearer key, or set ORG_CONTEXT_GITHUB and ORG_CONTEXT_GITHUB_TOKEN in the Netlify environment.",
      );
    }
    envSource = new GitHubSource(repo, token, process.env.ORG_CONTEXT_BRANCH);
  }
  return envSource;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed. Stateless MCP: POST only." });
  }

  let source: ContextSource;
  let writeMode: WriteMode;
  let name = "org-context";
  try {
    const tenant = tenantFromHeaders((name) => req.headers.get(name));
    if (tenant) {
      name = serverName(tenant.repo);
      // BYO mode: the caller's GitHub token is the authentication.
      source = pool.get(tenant);
      writeMode = tenant.writeMode;
    } else {
      const key = process.env.MCP_ACCESS_KEY;
      if (!key) return json(500, { error: "Server misconfigured: MCP_ACCESS_KEY is not set" });
      if (!equalSecrets(req.headers.get("authorization") ?? "", `Bearer ${key}`)) {
        // The header points OAuth-capable clients (ChatGPT, claude.ai, …) at the sign-in flow.
        return json(401, { error: "Unauthorized: missing or wrong Bearer key" }, {
          "WWW-Authenticate": wwwAuthenticate(new URL(req.url)),
        });
      }
      source = getEnvSource();
      writeMode = (process.env.ORG_CONTEXT_WRITE_MODE ?? "propose") === "direct" ? "direct" : "propose";
    }
  } catch (err) {
    return json(400, { error: err instanceof Error ? err.message : "Bad request" });
  }

  try {
    const server = buildServer(source, writeMode, name);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (err) {
    // Never log headers or the request here — the Authorization header is a tenant's GitHub token.
    console.error("orgspec function error:", err);
    return json(500, { error: "Internal server error" });
  }
};

export const config = { path: "/mcp" };
