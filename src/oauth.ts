import { createHash } from "node:crypto";
import {
  type AppConfig,
  appConfig,
  exchangeCode,
  issueKey,
  open,
  seal,
  userInstallationRepos,
  userLogin,
} from "./app.js";
import { escapeHtml } from "./markdown.js";
import { sessionCookie } from "./portal.js";
import type { WebPage } from "./web.js";
import { shell } from "./theme.js";

/**
 * MCP authorization (OAuth 2.1) for clients that cannot send custom headers —
 * ChatGPT, claude.ai connectors, Gemini, Copilot. The GitHub App is the
 * identity provider; the consent page asks which installed repo to expose;
 * the access token is the same per-repo key as /setup issues, with the repo
 * baked in (`oc2.…`) so the client sends nothing but the Bearer.
 *
 * Everything is stateless: registered clients, pending authorizations and
 * authorization codes are all sealed blobs (HMAC, short expiry) that travel
 * through the client and come back. Nothing is stored.
 *
 *   GET  /.well-known/oauth-protected-resource   (on the MCP host)  RFC 9728
 *   GET  /.well-known/oauth-authorization-server (on the app host)  RFC 8414
 *   POST /oauth/register     dynamic client registration            RFC 7591
 *   GET  /oauth/authorize    → GitHub sign-in
 *   GET  /oauth/callback     ← GitHub; renders the consent page
 *   POST /oauth/consent      → authorization code → client redirect
 *   POST /oauth/token        code + PKCE verifier → access token
 */

export interface OAuthRequest {
  url: URL;
  method: string;
  /** Request body, read lazily (form-urlencoded or JSON). */
  body: () => Promise<string>;
}

const CODE_TTL_MS = 5 * 60_000;
const FLOW_TTL_MS = 15 * 60_000;

const json = (status: number, value: unknown, headers: Record<string, string> = {}): WebPage => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(value),
  headers: { "Cache-Control": "no-store", ...headers },
});
const oauthError = (status: number, error: string, description: string): WebPage =>
  json(status, { error, error_description: description });
const redirect = (location: string): WebPage => ({
  status: 302,
  contentType: "text/plain; charset=utf-8",
  body: "",
  headers: { Location: location },
});
const html = (status: number, title: string, body: string): WebPage => ({
  status,
  contentType: "text/html; charset=utf-8",
  body: shell({ title: `${title} — orgspec`, body: `<h1>${escapeHtml(title)}</h1>${body}` }),
});

/** The app host is where humans and OAuth live; the MCP host is `mcp.` beside it. */
function appOrigin(url: URL): string {
  return process.env.ORG_CONTEXT_APP_ORIGIN ?? url.origin.replace("://mcp.", "://app.");
}
function mcpResource(url: URL): string {
  return url.hostname.startsWith("mcp.") ? url.origin : `${url.origin}/mcp`;
}

/** Header value that tells an MCP client where to start the OAuth dance. */
export function wwwAuthenticate(url: URL): string {
  return `Bearer resource_metadata="${mcpResource(url).replace(/\/mcp$/, "")}/.well-known/oauth-protected-resource"`;
}

interface Client {
  t: "client";
  redirect_uris: string[];
}
interface Flow {
  t: "flow";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  exp: number;
}
interface Grant extends Omit<Flow, "t"> {
  t: "grant";
  /** installation id → repos the signed-in user may expose */
  repos: Record<string, string[]>;
}
interface Code {
  t: "code";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  installation: string;
  repo: string;
  exp: number;
}

function parseForm(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

export async function renderOAuth(req: OAuthRequest): Promise<WebPage | undefined> {
  const { url, method } = req;
  const path = url.pathname;
  if (!path.startsWith("/oauth/") && !path.startsWith("/.well-known/")) return undefined;

  // Discovery documents need no App — but everything else does.
  if (path === "/.well-known/oauth-protected-resource") {
    return json(200, {
      resource: mcpResource(url),
      authorization_servers: [appOrigin(url)],
      bearer_methods_supported: ["header"],
    });
  }
  if (path === "/.well-known/oauth-authorization-server") {
    const issuer = appOrigin(url);
    return json(200, {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [],
    });
  }
  if (path.startsWith("/.well-known/")) return undefined;

  let cfg: AppConfig | undefined;
  try {
    cfg = appConfig();
  } catch (err) {
    return oauthError(500, "server_error", err instanceof Error ? err.message : String(err));
  }
  if (!cfg) return oauthError(404, "server_error", "No GitHub App is configured on this server.");

  try {
    switch (`${method} ${path}`) {
      case "POST /oauth/register": {
        const reg = JSON.parse((await req.body()) || "{}") as { redirect_uris?: unknown; client_name?: unknown };
        const uris = Array.isArray(reg.redirect_uris) ? reg.redirect_uris.filter((u) => typeof u === "string") : [];
        if (uris.length === 0) return oauthError(400, "invalid_client_metadata", "redirect_uris is required");
        const client: Client = { t: "client", redirect_uris: uris as string[] };
        return json(201, {
          client_id: seal(cfg, client),
          client_name: typeof reg.client_name === "string" ? reg.client_name : undefined,
          redirect_uris: uris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
        });
      }

      case "GET /oauth/authorize": {
        const q = url.searchParams;
        const client = open<Client>(cfg, q.get("client_id") ?? "", "client");
        const redirectUri = q.get("redirect_uri") ?? "";
        if (!client || !client.redirect_uris.includes(redirectUri)) {
          return oauthError(400, "invalid_request", "unknown client_id or redirect_uri not registered");
        }
        if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
          return oauthError(400, "invalid_request", "response_type=code with PKCE S256 is required");
        }
        const flow: Flow = {
          t: "flow",
          client_id: q.get("client_id")!,
          redirect_uri: redirectUri,
          code_challenge: q.get("code_challenge")!,
          state: q.get("state") ?? undefined,
          exp: Date.now() + FLOW_TTL_MS,
        };
        const gh = new URL("https://github.com/login/oauth/authorize");
        gh.searchParams.set("client_id", cfg.clientId);
        gh.searchParams.set("redirect_uri", `${appOrigin(url)}/oauth/callback`);
        gh.searchParams.set("state", seal(cfg, flow));
        return redirect(gh.toString());
      }

      case "GET /oauth/callback": {
        const state = url.searchParams.get("state") ?? "";
        const flow = open<Flow>(cfg, state, "flow");
        const login = !flow && open<{ t: "login"; exp: number }>(cfg, state, "login");
        if (!flow && !login) return html(400, "Expired", "<p>This sign-in took too long or was tampered with. Start again.</p>");
        const userToken = await exchangeCode(cfg, url.searchParams.get("code") ?? "");
        const repos = await userInstallationRepos(userToken);
        if (!flow) {
          // Plain sign-in to the app host (portal.ts), not an MCP client.
          const cookie = sessionCookie(cfg, repos, await userLogin(userToken));
          return { ...redirect(`${appOrigin(url)}/home`), headers: { Location: `${appOrigin(url)}/home`, "Set-Cookie": cookie } };
        }
        const pairs = Object.entries(repos).flatMap(([inst, list]) => list.map((repo) => [inst, repo] as const));
        if (pairs.length === 0) {
          return html(200, "No context repository yet",
            `<p>The App is not installed on any repository you can access.</p>
             <p><a href="${escapeHtml(appOrigin(url))}/setup">Install it on your context repository</a>, then start again from your chat client.</p>`);
        }
        const grant: Grant = { ...flow, t: "grant", repos };
        const choices = pairs
          .map(([inst, repo], i) =>
            `<label class="card"><input type="radio" name="choice" value="${escapeHtml(`${inst}:${repo}`)}" ${i === 0 ? "checked" : ""}>${escapeHtml(repo)}</label>`)
          .join("");
        return html(200, "Which context should this chat see?",
          `<form method="post" action="${escapeHtml(appOrigin(url))}/oauth/consent">
             <input type="hidden" name="grant" value="${escapeHtml(seal(cfg, grant))}">
             ${choices}
             <button type="submit" class="button">Connect</button>
           </form>
           <p class="note">The chat client gets read and propose access to that one repository. Revoke by uninstalling the App on GitHub.</p>`);
      }

      case "POST /oauth/consent": {
        const form = parseForm(await req.body());
        const grant = open<Grant>(cfg, form.get("grant") ?? "", "grant");
        const [installation, ...rest] = (form.get("choice") ?? "").split(":");
        const repo = rest.join(":");
        if (!grant || !installation || !grant.repos[installation]?.includes(repo)) {
          return html(400, "Expired", "<p>This choice took too long or was tampered with. Start again from your chat client.</p>");
        }
        const code: Code = {
          t: "code",
          client_id: grant.client_id,
          redirect_uri: grant.redirect_uri,
          code_challenge: grant.code_challenge,
          installation,
          repo,
          exp: Date.now() + CODE_TTL_MS,
        };
        const back = new URL(grant.redirect_uri);
        back.searchParams.set("code", seal(cfg, code));
        if (grant.state) back.searchParams.set("state", grant.state);
        return redirect(back.toString());
      }

      case "POST /oauth/token": {
        const form = parseForm(await req.body());
        if (form.get("grant_type") !== "authorization_code") {
          return oauthError(400, "unsupported_grant_type", "only authorization_code is supported; tokens do not expire");
        }
        const code = open<Code>(cfg, form.get("code") ?? "", "code");
        if (!code) return oauthError(400, "invalid_grant", "authorization code is invalid or expired");
        const verifier = form.get("code_verifier") ?? "";
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        if (challenge !== code.code_challenge) return oauthError(400, "invalid_grant", "PKCE verification failed");
        if (form.get("redirect_uri") && form.get("redirect_uri") !== code.redirect_uri) {
          return oauthError(400, "invalid_grant", "redirect_uri mismatch");
        }
        if (form.get("client_id") && form.get("client_id") !== code.client_id) {
          return oauthError(400, "invalid_grant", "client_id mismatch");
        }
        return json(200, {
          access_token: issueKey(cfg, code.installation, code.repo, true),
          token_type: "bearer",
        });
      }

      default:
        return oauthError(404, "invalid_request", `no such endpoint: ${method} ${path}`);
    }
  } catch (err) {
    return oauthError(502, "server_error", err instanceof Error ? err.message : String(err));
  }
}
