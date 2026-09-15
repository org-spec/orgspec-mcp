import { type AppConfig, appConfig, issueKey, open, seal } from "./app.js";
import { escapeHtml } from "./markdown.js";
import { SourcePool } from "./tenant.js";
import { type WebPage, renderContext } from "./web.js";
import { claudeCommand, mcpEndpoint } from "./connect.js";
import { shell } from "./theme.js";

/**
 * The signed-in side of the app host: come back after connecting a repo and
 * read your context.
 *
 *   GET /login            → GitHub sign-in through the App (state: "login")
 *   GET /oauth/callback   ← handled in oauth.ts; a "login" state lands here
 *   GET /home             your repositories
 *   GET /o/<owner>/<repo>/…   the context, rendered like the capability link
 *   GET /logout
 *
 * The session is a sealed cookie holding the repos the user could reach
 * through App installations at sign-in time — nothing stored server-side.
 * Access ends when the App is uninstalled (tokens stop minting) or the
 * cookie expires.
 */

const COOKIE = "oc_session";
const SESSION_TTL_MS = 7 * 24 * 3_600_000;
const LOGIN_TTL_MS = 10 * 60_000;

interface Session {
  t: "session";
  /** GitHub login — shown in the header, never used for authorisation. */
  user?: string;
  /** installation id → repos */
  repos: Record<string, string[]>;
  exp: number;
}

export interface PortalRequest {
  url: URL;
  method: string;
  cookie?: string | null;
}

// Module scope: read caches survive while the instance is warm.
const pool = new SourcePool();

const redirect = (location: string, headers: Record<string, string> = {}): WebPage => ({
  status: 302,
  contentType: "text/plain; charset=utf-8",
  body: "",
  headers: { Location: location, ...headers },
});

/** Set-Cookie header value for a fresh session over these repos. */
export function sessionCookie(cfg: AppConfig, repos: Record<string, string[]>, user?: string): string {
  const session: Session = { t: "session", user, repos, exp: Date.now() + SESSION_TTL_MS };
  return `${COOKIE}=${seal(cfg, session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function readSession(cfg: AppConfig, cookie: string | null | undefined): Session | undefined {
  const raw = cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return raw ? open<Session>(cfg, raw, "session") : undefined;
}

/** Where /login sends the browser: GitHub, with a sealed "login" state oauth.ts recognises. */
export function loginRedirect(cfg: AppConfig, origin: string): WebPage {
  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", cfg.clientId);
  gh.searchParams.set("redirect_uri", `${origin}/oauth/callback`);
  gh.searchParams.set("state", seal(cfg, { t: "login", exp: Date.now() + LOGIN_TTL_MS }));
  return redirect(gh.toString());
}

export async function renderPortal(req: PortalRequest): Promise<WebPage | undefined> {
  const { url, method } = req;
  const path = url.pathname;
  if (path !== "/login" && path !== "/logout" && path !== "/home" && path !== "/whoami" && !path.startsWith("/o/")) return undefined;
  if (method !== "GET") return { status: 405, contentType: "text/plain; charset=utf-8", body: "GET only." };

  let cfg: AppConfig | undefined;
  try {
    cfg = appConfig();
  } catch (err) {
    return { status: 500, contentType: "text/plain; charset=utf-8", body: err instanceof Error ? err.message : String(err) };
  }
  if (!cfg) return { status: 404, contentType: "text/plain; charset=utf-8", body: "No GitHub App is configured on this server." };

  if (path === "/login") return loginRedirect(cfg, url.origin);
  if (path === "/logout") return redirect("/", { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0` });

  const session = readSession(cfg, req.cookie);
  if (path === "/whoami") {
    // For the static landing page: is this browser signed in? JSON, no secrets.
    const body = session ? { user: session.user ?? null, repositories: Object.values(session.repos).flat().length } : null;
    return { status: session ? 200 : 401, contentType: "application/json", body: JSON.stringify(body), headers: { "Cache-Control": "no-store" } };
  }
  if (!session) return redirect("/login");
  const who = session.user ? `Signed in as ${session.user}` : undefined;

  if (path === "/home") {
    const cards = Object.values(session.repos)
      .flat()
      .sort()
      .map(
        (repo) =>
          `<a class="card" href="/o/${repo.split("/").map(encodeURIComponent).join("/")}/"><h3>${escapeHtml(repo.split("/")[1])}</h3>` +
          `<p>Read the context and its audit, or fetch the configuration for an AI client.</p><span class="path">github.com/${escapeHtml(repo)}</span></a>`,
      )
      .join("");
    return {
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shell({
        title: "Your repositories — orgspec",
        brandNote: who,
        nav: [
          { href: "/home", label: "Your repositories", active: true },
          { href: "/logout", label: "Sign out" },
        ],
        body:
          `<h1>Your context repositories</h1>` +
          `<p class="lede">Each one is a git repository you own. What you read here is what your AI reads.</p>` +
          (cards ? `<div class="cards">${cards}</div>` : `<p>The App is not installed on any repository you can access yet.</p>`) +
          `<p class="actions"><a href="/setup">Connect another repository</a></p>`,
      }),
    };
  }

  // /o/<owner>/<repo>/<rest…>
  const [, , owner, repo, ...restSegs] = path.split("/");
  const wanted = `${decodeURIComponent(owner ?? "")}/${decodeURIComponent(repo ?? "")}`.toLowerCase();
  const found = Object.entries(session.repos).find(([, list]) => list.some((r) => r.toLowerCase() === wanted));
  if (!found) return { status: 404, contentType: "text/plain; charset=utf-8", body: "Not one of your repositories." };
  const [installationId, list] = found;
  const fullName = list.find((r) => r.toLowerCase() === wanted)!;
  const source = pool.get({
    repo: fullName,
    token: issueKey(cfg, installationId, fullName),
    installationId,
    writeMode: "propose",
  });
  const base = `/o/${fullName.split("/").map(encodeURIComponent).join("/")}`;
  const connect = claudeCommand(mcpEndpoint(url), fullName, issueKey(cfg, installationId, fullName));
  return renderContext(base, restSegs.map(decodeURIComponent).join("/"), source, undefined, "/home", { who, connect });
}
