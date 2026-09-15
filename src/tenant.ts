import { createHash } from "node:crypto";
import { appConfig, installationToken, isAppKey, repoOfToken, verifyKey } from "./app.js";
import { GitHubSource } from "./github.js";
import { isRepoName, type WriteMode } from "./source.js";

/**
 * Bring-your-own-repo tenant, read from request headers. The client's MCP
 * configuration IS the onboarding: it names the context repo and carries the
 * caller's own GitHub token — the server stores nothing.
 *
 *   Authorization:        Bearer <fine-grained GitHub token for the repo>
 *                         — or a key issued by /setup after installing the
 *                         GitHub App (`oc1.<installation>.<mac>`, see app.ts)
 *   X-Org-Context-Repo:   owner/repo
 *   X-Org-Context-Branch: optional branch (default: the repo's default)
 *
 * Writes are always proposals (branch + pull request) — the model recommends,
 * a human decides. The GitHub token is the authentication: an invalid token
 * fails at GitHub with 401. Tokens must never be logged.
 */
export interface Tenant {
  repo: string;
  /** The Bearer as sent: a GitHub token, or an App key (then installationId is set). */
  token: string;
  installationId?: string;
  branch?: string;
  writeMode: WriteMode;
}

/**
 * Read a tenant from request headers. Returns undefined when no
 * X-Org-Context-Repo header is present (single-tenant env mode applies).
 * Throws on a malformed tenant request.
 */
export function tenantFromHeaders(get: (name: string) => string | null | undefined): Tenant | undefined {
  const bearer = (get("authorization") ?? "").replace(/^Bearer\s+/, "").trim();
  // An OAuth-issued token (`oc2.`) names its repo itself — no header needed.
  const repo = get("x-org-context-repo")?.trim() || repoOfToken(bearer);
  if (!repo) return undefined;
  if (!isRepoName(repo)) {
    throw new Error(`X-Org-Context-Repo expects 'owner/repo' (letters, digits, '-', '_', '.'), got: ${repo}`);
  }
  const auth = get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) {
    throw new Error("X-Org-Context-Repo requires your GitHub token in 'Authorization: Bearer <token>'");
  }
  const branch = get("x-org-context-branch")?.trim();
  const tenant: Tenant = { repo, token, branch: branch || undefined, writeMode: "propose" };
  if (isAppKey(token)) {
    const cfg = appConfig();
    if (!cfg) throw new Error("This server has no GitHub App configured — use a fine-grained token instead.");
    tenant.installationId = verifyKey(cfg, token, repo);
    if (!tenant.installationId) {
      throw new Error("The key is not valid for this repository. Open /setup to get the current one.");
    }
  }
  return tenant;
}

const MAX_POOL_SIZE = 50;

/**
 * Pool of GitHubSources keyed per tenant so read caches survive across
 * requests while an instance is warm. Keys are hashes — the pool never
 * holds a token in a form that could leak through introspection or logs.
 */
export class SourcePool {
  private readonly pool = new Map<string, GitHubSource>();

  get(tenant: Tenant): GitHubSource {
    const key = createHash("sha256")
      .update(`${tenant.repo}\n${tenant.branch ?? ""}\n${tenant.token}`)
      .digest("hex");
    let source = this.pool.get(key);
    if (!source) {
      if (this.pool.size >= MAX_POOL_SIZE) {
        const oldest = this.pool.keys().next().value;
        if (oldest !== undefined) this.pool.delete(oldest);
      }
      const { installationId } = tenant;
      const auth = installationId
        ? () => installationToken(appConfig()!, installationId) // verified present in tenantFromHeaders
        : tenant.token;
      source = new GitHubSource(tenant.repo, auth, tenant.branch);
      this.pool.set(key, source);
    }
    return source;
  }
}
