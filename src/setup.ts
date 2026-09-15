import { appConfig, exchangeCode, installUrl, issueKey, userInstallationRepos, userLogin } from "./app.js";
import { connectHtml, mcpEndpoint } from "./connect.js";
import { sessionCookie } from "./portal.js";
import { escapeHtml } from "./markdown.js";
import type { WebPage } from "./web.js";
import { shell } from "./theme.js";

/**
 * GET /setup — the page GitHub sends the user to after installing the App
 * (its "Callback URL", with "Request user authorization during installation"
 * on). One shot, no session: the OAuth code proves who installed, the page
 * shows a ready-to-run command per repository, and nothing is kept.
 *
 * Without a code it redirects to the App's install page — that is what the
 * landing page's button links to.
 */

const page = (status: number, title: string, body: string): WebPage => ({
  status,
  contentType: "text/html; charset=utf-8",
  body: shell({
    title: `${title} — orgspec`,
    nav: [{ href: "/home", label: "Your repositories" }],
    body: `<h1>${escapeHtml(title)}</h1>${body}`,
  }),
});

export async function renderSetup(url: URL, method: string | undefined): Promise<WebPage | undefined> {
  if (url.pathname !== "/setup") return undefined;
  let cfg;
  try {
    cfg = appConfig();
  } catch (err) {
    return page(500, "Server misconfigured", `<p>${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`);
  }
  if (!cfg) {
    return { status: 404, contentType: "text/plain; charset=utf-8", body: "No GitHub App is configured on this server." };
  }
  if (method !== "GET") return { status: 405, contentType: "text/plain; charset=utf-8", body: "GET only." };

  const code = url.searchParams.get("code");
  const installationId = url.searchParams.get("installation_id");

  try {
    if (!code) {
      return { status: 302, contentType: "text/plain; charset=utf-8", body: "", headers: { Location: await installUrl(cfg) } };
    }
    const userToken = await exchangeCode(cfg, code);
    if (!installationId || !/^\d+$/.test(installationId)) {
      return page(
        200,
        "Almost there",
        `<p>You signed in, but the App is not installed on a repository yet
         ${url.searchParams.get("setup_action") === "request" ? "— your request is waiting for an owner's approval" : ""}.</p>
         <p><a href="${escapeHtml(await installUrl(cfg))}">Install it on your context repository</a>, then you land back here.</p>`,
      );
    }
    // Authorisation: list the installation's repositories AS THE USER, never as
    // the App. The App sees every repository it is installed on; the user only
    // those they can reach on GitHub. Keys are shown for the latter alone —
    // otherwise an organisation member with access to one repo would walk away
    // with working keys for all of them.
    const byInstallation = await userInstallationRepos(userToken);
    const repos = byInstallation[installationId];
    if (!repos) {
      return page(403, "Not your installation", `<p>This installation has no repository you can access on GitHub.</p>`);
    }
    const session = sessionCookie(cfg, byInstallation, await userLogin(userToken));
    const endpoint = mcpEndpoint(url);
    const blocks = repos.map(
      (repo) => `<h2>${escapeHtml(repo)}</h2>${connectHtml(endpoint, repo, issueKey(cfg, installationId, repo))}`,
    );
    const connected = page(
      200,
      "Connected",
      `<p>The App is installed. <a href="/home">Read your context in the browser</a>, or connect an AI client.
         You can fetch this configuration again any time from the repository's Connect page.</p>
       ${blocks.join("")}`,
    );
    return { ...connected, headers: { "Set-Cookie": session } };
  } catch (err) {
    return page(502, "GitHub did not cooperate", `<p>${escapeHtml(err instanceof Error ? err.message : String(err))}</p>
      <p><a href="/setup">Try again</a></p>`);
  }
}
