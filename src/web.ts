import type { ContextSource } from "./source.js";
import { equalSecrets } from "./secret.js";
import { escapeHtml, extractTitle, renderMarkdown } from "./markdown.js";
import { audit, renderAudit } from "./audit.js";
import { chainCrumbs, overviewBody } from "./overview.js";
import { shell } from "./theme.js";
import { connectHtml } from "./connect.js";
import { MERMAID_TAIL } from "./mermaid.js";

/**
 * Read-only web view of the context repository, for the humans the context is
 * about — no GitHub account, no tooling, just a link.
 *
 * Access is a capability URL: /c/<key>/… where <key> is ORG_CONTEXT_WEB_KEY.
 * Whoever holds the link can read (never write) the context — the same trust
 * model as a shared document link. The view is deliberately not a file
* browser: the overview renders the organization as a chain — why, what, who
 * and where — derived from the files and the links between them (overview.ts).
 */

export interface WebConfig {
  key: string;
  /** Optional email shown as a "Suggest a change" link on every page. */
  contact?: string;
}

function page(opts: {
  title: string;
  orgName: string;
  base: string;
  active: "overview" | "audit" | "connect" | "";
  body: string;
  footer: string;
  /** Link back to the signed-in user's repository list, when there is one. */
  home?: string;
  who?: string;
  hasConnect?: boolean;
}): string {
  return shell({
    title: opts.title,
    brand: opts.orgName,
    brandNote: opts.who,
    nav: [
      { href: `${opts.base}/`, label: "Overview", active: opts.active === "overview" },
      { href: `${opts.base}/audit`, label: "Audit", active: opts.active === "audit" },
      ...(opts.hasConnect ? [{ href: `${opts.base}/connect`, label: "Connect", active: opts.active === "connect" }] : []),
      ...(opts.home ? [{ href: opts.home, label: "Your repositories" }] : []),
    ],
    body: opts.body,
    footer: opts.footer,
    // Loaded only on pages that contain a diagram — pinned and SRI-protected, see mermaid.ts.
    tail: opts.body.includes('class="mermaid"') ? MERMAID_TAIL : "",
  });
}

/** Resolve a markdown link relative to the current file into a view URL. */
function linkResolver(base: string, fromFile: string): (href: string) => string {
  return (href: string): string => {
    if (/^[a-z]+:/i.test(href)) return href; // absolute (https:, mailto:, …)
    const [path, anchor] = href.split("#");
    if (!path.endsWith(".md")) return href;
    const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")).split("/") : [];
    for (const seg of path.split("/")) {
      if (seg === "" || seg === ".") continue;
      else if (seg === "..") dir.pop();
      else dir.push(seg);
    }
    const resolved = dir.join("/");
    return `${base}/f/${resolved.split("/").map(encodeURIComponent).join("/")}${anchor ? `#${anchor}` : ""}`;
  };
}

function suggestBlock(contact: string | undefined, subject: string): string {
  if (!contact) return "";
  const mailto = `mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent(subject)}`;
  return `<div class="suggest">Something outdated or missing? <a href="${mailto}">Suggest a change</a> — every change is reviewed by a person before it becomes truth.</div>`;
}

async function readAll(source: ContextSource): Promise<{ path: string; content: string }[]> {
  // In parallel: one request per file against GitHub, ~0.3 s each — serial
  // reads made a cold page take ~8 s for a 28-file repo.
  const files = await source.listFiles();
  return Promise.all(files.map(async (path) => ({ path, content: await source.readFile(path) })));
}

function orgNameOf(files: { path: string; content: string }[], source: ContextSource): string {
  const readme = files.find((f) => f.path === "README.md");
  const title = readme ? extractTitle(readme.content) : undefined;
  return (title ?? source.describe()).replace(/^Org context — /, "");
}

/** A finished page, runtime-agnostic — adapters turn it into a real response. */
export interface WebPage {
  status: number;
  contentType: string;
  body: string;
  headers?: Record<string, string>;
}

/**
 * Render a request under /c/ into a page. Returns undefined when the path is
 * not a web-view path. Pure of any HTTP runtime, so the same view serves the
 * Node server and the Netlify function.
 */
export async function renderWeb(
  urlPath: string,
  method: string | undefined,
  source: ContextSource | undefined,
  cfg: WebConfig | undefined,
): Promise<WebPage | undefined> {
  const url = urlPath.split("?")[0];
  if (!url.startsWith("/c/")) return undefined;

  const html = (status: number, body: string): WebPage => ({
    status,
    contentType: "text/html; charset=utf-8",
    body,
  });
  const plain = (status: number, body: string): WebPage => ({
    status,
    contentType: "text/plain; charset=utf-8",
    body,
  });

  if (!cfg || !source) return plain(404, "Web view is not enabled on this server.");
  if (method !== "GET") return plain(405, "GET only.");

  const [, , key, ...restSegs] = url.split("/");
  if (!key || !equalSecrets(decodeURIComponent(key), cfg.key)) {
    return plain(404, "Not found.");
  }
  const base = `/c/${encodeURIComponent(cfg.key)}`;
  const rest = restSegs.map(decodeURIComponent).join("/");
  return renderContext(base, rest, source, cfg.contact);
}

/**
 * Render one context repository under `base`: the overview at `base/`, files
 * at `base/f/<path>`. Shared by the capability link (/c/<key>) and the
 * signed-in view (/o/<owner>/<repo>, see portal.ts).
 */
export async function renderContext(
  base: string,
  rest: string,
  source: ContextSource,
  contact: string | undefined,
  home?: string,
  signedIn?: { who?: string; connect?: string },
): Promise<WebPage> {
  const who = signedIn?.who;
  const hasConnect = Boolean(signedIn?.connect);
  const html = (status: number, body: string): WebPage => ({ status, contentType: "text/html; charset=utf-8", body });
  const plain = (status: number, body: string): WebPage => ({ status, contentType: "text/plain; charset=utf-8", body });
  try {
    const files = await readAll(source);
    const orgName = files.length > 0 ? orgNameOf(files, source) : source.describe();
    const footer =
      `Served from ${escapeHtml(source.describe())} · ` +
      `follows the <a href="https://github.com/org-spec/orgspec">Org Context Spec</a>` +
      (files.some((f) => f.path === "README.md")
        ? ` · <a href="${base}/f/README.md">how this repository works</a>`
        : "");

    if (rest === "" || rest === "/") {
      const body =
        files.length === 0
          ? `<h1>Nothing here yet</h1><p class="lede">This context repository is empty — a normal starting point. Content appears here as it is created and approved.</p>`
          : `<h1>${escapeHtml(orgName)}</h1><p class="lede">The organizational context AI agents read before they work here — and the humans' window into it. Every statement was proposed, reviewed, and accepted by a person.</p>` +
            overviewBody(files, base, audit(files)) +
            suggestBlock(contact, `Suggestion for the org context`);
      return html(200, page({ title: orgName, orgName, base, active: "overview", body, footer, home, who, hasConnect }));
    }

    if (rest === "connect" && signedIn?.connect) {
      // The command carries the key; connectHtml derives the endpoint/repo/key back out of it.
      const [, endpoint] = signedIn.connect.match(/ (\S+) \\$/m) ?? [];
      const key = signedIn.connect.match(/Bearer (\S+)"/)?.[1] ?? "";
      const repo = signedIn.connect.match(/X-Org-Context-Repo: ([^"]+)"/)?.[1] ?? "";
      const body =
        `<div class="crumbs"><a href="${base}/">Overview</a> / Connect</div>` +
        `<h1>Connect an AI client</h1><p class="lede">The same context for every client. Nothing is stored on the server — ` +
        `this page derives the key again each time you open it.</p>` +
        connectHtml(endpoint ?? "", repo, key);
      return html(200, page({ title: `Connect — ${orgName}`, orgName, base, active: "connect", body, footer, home, who, hasConnect }));
    }

    if (rest === "audit") {
      const findings = audit(files);
      const body =
        `<div class="crumbs"><a href="${base}/">Overview</a> / Audit</div>` +
        renderMarkdown(renderAudit(findings, { title: `Audit — ${orgName}` }), linkResolver(base, "README.md"));
      return html(200, page({ title: `Audit — ${orgName}`, orgName, base, active: "audit", body, footer, home, who, hasConnect }));
    }

    if (rest.startsWith("f/")) {
      const rel = rest.slice(2);
      const file = files.find((f) => f.path === rel);
      if (!file) {
        return html(404, page({ title: "Not found", orgName, base, active: "", body: `<h1>Not found</h1><p class="lede">No such context file: <code>${escapeHtml(rel)}</code></p>`, footer, home, who, hasConnect }));
      }
      const body =
        chainCrumbs(files, rel, base) +
        renderMarkdown(file.content, linkResolver(base, file.path)) +
        suggestBlock(contact, `Suggestion for ${rel}`);
      const title = extractTitle(file.content) ?? rel;
      return html(200, page({ title: `${title} — ${orgName}`, orgName, base, active: "", body, footer, home, who, hasConnect }));
    }

    return html(404, page({ title: "Not found", orgName, base, active: "", body: `<h1>Not found</h1>`, footer, home, who, hasConnect }));
  } catch (err) {
    console.error("orgspec web error:", err);
    return plain(500, "Internal server error.");
  }
}
