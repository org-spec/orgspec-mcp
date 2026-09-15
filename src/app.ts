import { createHash, createHmac, createPrivateKey, sign } from "node:crypto";
import { equalSecrets } from "./secret.js";
import { isRepoName } from "./source.js";

/**
 * GitHub App integration — the alternative to pasting a fine-grained token.
 *
 * The user installs the App on the context repo. The server then issues a
 * KEY per repo, `oc1.<installation id>.<mac>`, that the client sends as its
 * Bearer. The mac is an HMAC over installation + repo with a secret derived
 * from the App's private key, so the server verifies keys statelessly and
 * stores nothing. On each request the key resolves to a short-lived
 * installation token (minted with the App's private key, cached while the
 * instance is warm). Revocation = uninstall the App, or rotate the private
 * key (which invalidates every issued key at once).
 *
 * Configuration (all four, or the App path stays off):
 *   ORG_CONTEXT_APP_ID             the App's numeric id
 *   ORG_CONTEXT_APP_PRIVATE_KEY    PEM; literal "\n" sequences are accepted
 *   ORG_CONTEXT_APP_CLIENT_ID      OAuth client id (for /setup)
 *   ORG_CONTEXT_APP_CLIENT_SECRET  OAuth client secret (for /setup)
 */
export interface AppConfig {
  appId: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
}

const API = "https://api.github.com";
const KEY_PREFIX = "oc1";
/** Same key, with the repo embedded — for OAuth clients that send only a Bearer. */
const TOKEN_PREFIX = "oc2";

export function appConfig(): AppConfig | undefined {
  const appId = process.env.ORG_CONTEXT_APP_ID?.trim();
  const privateKey = normalizePem(process.env.ORG_CONTEXT_APP_PRIVATE_KEY ?? "");
  const clientId = process.env.ORG_CONTEXT_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.ORG_CONTEXT_APP_CLIENT_SECRET?.trim();
  if (!appId || !privateKey || !clientId || !clientSecret) return undefined;
  return { appId, privateKey, clientId, clientSecret };
}

/**
 * Accept a PEM however an env-var editor or a stray keypress mangled it:
 * literal "\\n", newlines collapsed to spaces, stripped, or inserted anywhere
 * — even inside the header. Strips all whitespace, then rebuilds the PEM the
 * decoder wants: spaced header, base64 wrapped at 64 columns.
 */
export function normalizePem(raw: string): string {
  const compact = raw.replace(/\\n/g, "").replace(/\s+/g, "");
  const m = compact.match(/-----BEGIN([A-Z]+?)-----(.+?)-----END\1-----/);
  if (!m) {
    throw new Error(
      `ORG_CONTEXT_APP_PRIVATE_KEY is not a PEM (${compact.length} chars, no "-----BEGIN … KEY-----" header). ` +
        `Paste the whole .pem file GitHub generated — not the SHA256 fingerprint.`,
    );
  }
  // "RSAPRIVATEKEY" → "RSA PRIVATE KEY", "PRIVATEKEY" → "PRIVATE KEY" (PKCS#8).
  const label = m[1].replace(/^([A-Z]*?)(PRIVATE|PUBLIC)KEY$/, (_, kind: string, what: string) =>
    `${kind ? `${kind} ` : ""}${what} KEY`);
  const body = m[2].match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${body.join("\n")}\n-----END ${label}-----\n`;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

/** Short-lived JWT that authenticates as the App itself (RS256, no library needed). */
export function appJwt(cfg: AppConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: cfg.appId }));
  let key;
  try {
    key = createPrivateKey(cfg.privateKey);
  } catch (err) {
    throw new Error(
      `ORG_CONTEXT_APP_PRIVATE_KEY has a PEM header but does not parse (${err instanceof Error ? err.message : err}). ` +
        `Re-paste the .pem file GitHub generated; the value may have been truncated.`,
    );
  }
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64url(signature)}`;
}

async function gh<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "org-context-mcp",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* not json */
    }
    throw new Error(`GitHub ${method} ${path}: ${res.status} ${message}`);
  }
  return JSON.parse(text) as T;
}

// Module scope: survives while the instance is warm. Tokens live ~1h.
const installationTokens = new Map<string, { token: string; expiresAt: number }>();

/** Token scoped to one installation's repositories. Cached until shortly before expiry. */
export async function installationToken(cfg: AppConfig, installationId: string): Promise<string> {
  const hit = installationTokens.get(installationId);
  if (hit && hit.expiresAt - Date.now() > 60_000) return hit.token;
  const data = await gh<{ token: string; expires_at: string }>(
    appJwt(cfg),
    "POST",
    `/app/installations/${installationId}/access_tokens`,
  );
  installationTokens.set(installationId, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

const secretOf = (cfg: AppConfig): Buffer => createHash("sha256").update(cfg.privateKey).digest();

function hmac(cfg: AppConfig, data: string): string {
  return createHmac("sha256", secretOf(cfg)).update(data).digest("base64url").slice(0, 32);
}

function mac(cfg: AppConfig, installationId: string, repo: string): string {
  return hmac(cfg, `${installationId}\n${repo.toLowerCase()}`);
}

/**
 * The key a client sends as Bearer for this repo. `oc1` needs the repo in
 * X-Org-Context-Repo; `oc2` (withRepo) carries it, for OAuth clients.
 * Shown once on /setup; re-derivable there.
 */
export function issueKey(cfg: AppConfig, installationId: string, repo: string, withRepo = false): string {
  const m = mac(cfg, installationId, repo);
  return withRepo
    ? `${TOKEN_PREFIX}.${installationId}.${Buffer.from(repo).toString("base64url")}.${m}`
    : `${KEY_PREFIX}.${installationId}.${m}`;
}

export function isAppKey(bearer: string): boolean {
  return bearer.startsWith(`${KEY_PREFIX}.`) || bearer.startsWith(`${TOKEN_PREFIX}.`);
}

/** The repo an `oc2` token names, or undefined for other bearers. Unverified — verifyKey does that. */
export function repoOfToken(bearer: string): string | undefined {
  const [prefix, , repo] = bearer.split(".");
  if (prefix !== TOKEN_PREFIX || !repo) return undefined;
  const decoded = Buffer.from(repo, "base64url").toString();
  return isRepoName(decoded) ? decoded : undefined;
}

/** Returns the installation id the key is valid for this repo, or undefined. Constant-time compare. */
export function verifyKey(cfg: AppConfig, bearer: string, repo: string): string | undefined {
  const parts = bearer.split(".");
  const [prefix, installationId] = parts;
  const given = parts[prefix === TOKEN_PREFIX ? 3 : 2];
  if (!isAppKey(bearer) || !installationId || !/^\d+$/.test(installationId) || !given) return undefined;
  if (prefix === TOKEN_PREFIX && repoOfToken(bearer)?.toLowerCase() !== repo.toLowerCase()) return undefined;
  return equalSecrets(given, mac(cfg, installationId, repo)) ? installationId : undefined;
}

// --- Sealed blobs: signed, self-expiring state that travels through the client ---

/** `<base64url json>.<mac>` — tamper-evident, not encrypted: never seal secrets. */
export function seal(cfg: AppConfig, value: object): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${hmac(cfg, payload)}`;
}

/** Open a sealed blob of the expected type `t`; undefined if forged, wrong type, or past `exp`. */
export function open<T extends { t: string; exp?: number }>(cfg: AppConfig, blob: string, t: T["t"]): T | undefined {
  const [payload, m] = blob.split(".");
  if (!payload || !m || !equalSecrets(m, hmac(cfg, payload))) return undefined;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
    if (value.t !== t) return undefined;
    if (value.exp !== undefined && value.exp < Date.now()) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

// --- /setup helpers: the one-shot page after installation -------------------

/** Exchange the OAuth code GitHub appends to the setup redirect for a user token. */
export async function exchangeCode(cfg: AppConfig, code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "org-context-mcp" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) throw new Error(data.error_description ?? "GitHub returned no user token");
  return data.access_token;
}

/** GitHub login of the user a user token belongs to. */
export async function userLogin(userToken: string): Promise<string> {
  return (await gh<{ login: string }>(userToken, "GET", "/user")).login;
}

/**
 * Repos the signed-in user can reach through each of their App installations.
 *
 * This is THE authorisation check for issuing keys and sessions: it asks GitHub
 * as the user, so the answer is bounded by the user's own repository access.
 * Never substitute the App's view (`GET /installation/repositories`) — the App
 * sees every repository it is installed on, including ones this user cannot
 * open on GitHub.
 */
export async function userInstallationRepos(userToken: string): Promise<Record<string, string[]>> {
  const { installations } = await gh<{ installations: { id: number }[] }>(userToken, "GET", "/user/installations");
  const out: Record<string, string[]> = {};
  for (const { id } of installations) {
    const { repositories } = await gh<{ repositories: { full_name: string }[] }>(
      userToken,
      "GET",
      `/user/installations/${id}/repositories?per_page=100`,
    );
    if (repositories.length > 0) out[String(id)] = repositories.map((r) => r.full_name);
  }
  return out;
}

let slug: string | undefined;

/** Where to send a user who wants to install (or reconfigure) the App. */
export async function installUrl(cfg: AppConfig): Promise<string> {
  if (!slug) slug = (await gh<{ slug: string }>(appJwt(cfg), "GET", "/app")).slug;
  return `https://github.com/apps/${slug}/installations/new`;
}
