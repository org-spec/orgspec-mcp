#!/usr/bin/env node
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import { GitHubSource } from "./github.js";
import { LocalSource, type ContextSource, type WriteMode } from "./source.js";
import { SourcePool, tenantFromHeaders } from "./tenant.js";
import { renderOAuth, wwwAuthenticate } from "./oauth.js";
import { renderPortal } from "./portal.js";
import { serverName } from "./connect.js";
import { renderSetup } from "./setup.js";
import { equalSecrets } from "./secret.js";
import { securityHeaders } from "./headers.js";
import { renderWeb, type WebConfig } from "./web.js";

/**
 * Hosted entry: MCP over streamable HTTP, stateless (a fresh server+transport
 * per request). Two modes, decided per request:
 *
 * Bring your own repo (multi-tenant): the client sends X-Org-Context-Repo
 * plus its own GitHub token as the Bearer key — see tenant.ts. Needs no
 * server configuration at all.
 *
 * Default repo (single-tenant), via environment:
 *
 *   ORG_CONTEXT_GITHUB       owner/repo to serve (else ORG_CONTEXT_PATH folder)
 *   ORG_CONTEXT_GITHUB_TOKEN token with contents+PR permission on that repo
 *   ORG_CONTEXT_WRITE_MODE   direct | propose (default: propose for hosted)
 *   MCP_ACCESS_KEY           Bearer key clients must send for the default repo.
 *                            Required when a default repo is configured; the
 *                            server refuses to start without it unless
 *   ORG_CONTEXT_ALLOW_OPEN=1 explicitly opts in (local development only)
 *   ORG_CONTEXT_WEB_KEY      enables the read-only web view of the default repo
 *                            at /c/<key>/ — a capability link for humans
 *   ORG_CONTEXT_WEB_CONTACT  optional email for the view's "Suggest a change" link
 *   ORG_CONTEXT_APP_*        GitHub App (id, private key, client id/secret) —
 *                            enables /setup and App-issued keys, see app.ts
 *   PORT                     default 3000
 */

const envWriteMode: WriteMode =
  (process.env.ORG_CONTEXT_WRITE_MODE ?? "propose") === "direct" ? "direct" : "propose";

function createEnvSource(): ContextSource | undefined {
  const repo = process.env.ORG_CONTEXT_GITHUB;
  if (repo) {
    const token = process.env.ORG_CONTEXT_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
    if (!token) throw new Error("ORG_CONTEXT_GITHUB requires ORG_CONTEXT_GITHUB_TOKEN or GITHUB_TOKEN");
    return new GitHubSource(repo, token, process.env.ORG_CONTEXT_BRANCH);
  }
  if (process.env.ORG_CONTEXT_PATH) return new LocalSource(process.env.ORG_CONTEXT_PATH);
  return undefined;
}

// Process lifetime: read caches survive across requests, per tenant.
const envSource = createEnvSource();
const pool = new SourcePool();
const accessKey = process.env.MCP_ACCESS_KEY;
if (envSource && !accessKey && process.env.ORG_CONTEXT_ALLOW_OPEN !== "1") {
  // Fail closed: a default repo without a key would be readable by anyone who reaches the port.
  console.error(
    `org-context-mcp: refusing to serve ${envSource.describe()} without MCP_ACCESS_KEY. ` +
      `Set it, or ORG_CONTEXT_ALLOW_OPEN=1 to run open for local development.`,
  );
  process.exit(1);
}
const webConfig: WebConfig | undefined = process.env.ORG_CONTEXT_WEB_KEY
  ? { key: process.env.ORG_CONTEXT_WEB_KEY, contact: process.env.ORG_CONTEXT_WEB_CONTACT }
  : undefined;
const port = Number(process.env.PORT ?? 3000);

const httpServer = createServer(async (req, res) => {
  const fail = (status: number, error: string, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify({ error }));
  };
  try {
    // Read-only web view (capability link) — served from the default repo only.
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const readBody = () =>
      new Promise<string>((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });
    const webPage =
      (await renderWeb(req.url ?? "", req.method, envSource, webConfig)) ??
      (await renderSetup(url, req.method)) ??
      (await renderPortal({ url, method: req.method ?? "GET", cookie: req.headers.cookie })) ??
      (await renderOAuth({ url, method: req.method ?? "GET", body: readBody }));
    if (webPage) {
      res.writeHead(webPage.status, {
        "Content-Type": webPage.contentType,
        "Cache-Control": "no-store",
        ...securityHeaders(webPage.contentType),
        ...webPage.headers,
      });
      return void res.end(webPage.body);
    }
    if ((req.url ?? "").split("?")[0] !== "/mcp") {
      return fail(404, "Not found. MCP endpoint: POST /mcp");
    }
    if (req.method !== "POST") {
      // Stateless server: no SSE stream to resume, no session to delete.
      return fail(405, "Method not allowed. Stateless MCP: POST only.", { Allow: "POST" });
    }

    let source: ContextSource;
    let writeMode: WriteMode;
    let tenant;
    try {
      tenant = tenantFromHeaders((name) => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      });
    } catch (err) {
      return fail(400, err instanceof Error ? err.message : "Bad request");
    }
    if (tenant) {
      // BYO mode: the caller's GitHub token is the authentication.
      source = pool.get(tenant);
      writeMode = tenant.writeMode;
    } else {
      if (accessKey && !equalSecrets(req.headers.authorization ?? "", `Bearer ${accessKey}`)) {
        return fail(401, "Unauthorized: missing or wrong Bearer key", { "WWW-Authenticate": wwwAuthenticate(url) });
      }
      if (!envSource) {
        return fail(
          400,
          "No default repo configured. Either send X-Org-Context-Repo + your GitHub token " +
            "as Bearer key, or set ORG_CONTEXT_GITHUB or ORG_CONTEXT_PATH on the server.",
        );
      }
      source = envSource;
      writeMode = envWriteMode;
    }

    const server = buildServer(source, writeMode, tenant ? serverName(tenant.repo) : "org-context");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    // Never log headers here — in BYO mode the Authorization header is a tenant's GitHub token.
    console.error("org-context-mcp http error:", err);
    if (!res.headersSent) {
      fail(500, "Internal server error");
    }
  }
});

httpServer.listen(port, () => {
  const defaultRepo = envSource
    ? `default repo ${envSource.describe()} (auth: ${accessKey ? "bearer key" : "OPEN — set MCP_ACCESS_KEY"}), plus`
    : "no default repo —";
  console.error(
    `org-context-mcp: http://localhost:${port}/mcp — ${defaultRepo} bring-your-own-repo via ` +
      `X-Org-Context-Repo + GitHub token` +
      (webConfig && envSource ? `; web view at /c/<ORG_CONTEXT_WEB_KEY>/` : ""),
  );
});
