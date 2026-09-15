import { escapeHtml } from "./markdown.js";

/**
 * One look for every page the app host serves — the landing page, sign-in,
 * setup, consent, the repository list and the context view. Neutral and
 * quiet: warm off-white, one green accent, system type. public/index.html
 * carries a copy of the same tokens (it is a static file).
 */
export const CSS = `
:root {
  --bg: #faf9f7; --card: #ffffff; --ink: #21201d; --muted: #6f6d67;
  --line: #e7e4de; --accent: #2f6f5f; --accent-soft: #eaf2ef;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header.site { border-bottom: 1px solid var(--line); background: var(--card); }
header.site .inner {
  max-width: 52rem; margin: 0 auto; padding: 1rem 1.25rem;
  display: flex; align-items: baseline; gap: 1.5rem; flex-wrap: wrap;
}
header.site .org { font-weight: 650; font-size: 1.05rem; color: var(--ink); }
header.site .org small { font-weight: 400; color: var(--muted); margin-left: .5rem; font-size: .85rem; }
nav a { color: var(--muted); margin-right: 1rem; font-size: .95rem; }
nav a.active { color: var(--accent); font-weight: 600; }
main { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
footer.site {
  max-width: 52rem; margin: 0 auto; padding: 0 1.25rem 2.5rem;
  color: var(--muted); font-size: .85rem;
}
h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 .75rem; letter-spacing: -.01em; }
h2 { font-size: 1.25rem; margin: 2.2rem 0 .6rem; letter-spacing: -.01em; }
h3 { font-size: 1.05rem; margin: 1.6rem 0 .4rem; }
h4 { font-size: .95rem; margin: 1.2rem 0 .3rem; }
p { margin: .55rem 0; }
hr { border: none; border-top: 1px solid var(--line); margin: 2rem 0; }
blockquote {
  margin: 1rem 0; padding: .7rem 1rem; border-left: 3px solid var(--accent);
  background: var(--accent-soft); border-radius: 0 6px 6px 0; color: #3d5a51;
  font-size: .93rem;
}
blockquote p { margin: .3rem 0; }
code {
  background: #f1efe9; border-radius: 4px; padding: .1em .35em;
  font: .88em ui-monospace, "SF Mono", Menlo, monospace;
}
pre { background: #f1efe9; border-radius: 8px; padding: .9rem 1rem; overflow-x: auto; }
pre code { background: none; padding: 0; }
pre.mermaid { background: var(--card); border: 1px solid var(--line); text-align: center; }
.tablewrap { overflow-x: auto; margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; font-size: .93rem; background: var(--card); }
th, td { border: 1px solid var(--line); padding: .5rem .7rem; text-align: left; vertical-align: top; }
th { background: #f4f2ed; font-weight: 600; }
ul, ol { padding-left: 1.4rem; }
li { margin: .3rem 0; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: .8rem; margin: .8rem 0 0; }
a.card, label.card {
  display: block; background: var(--card); border: 1px solid var(--line);
  border-radius: 10px; padding: .9rem 1rem; color: var(--ink);
}
a.card:hover, label.card:hover { border-color: var(--accent); text-decoration: none; }
a.card h3 { margin: 0 0 .3rem; font-size: 1rem; }
a.card p { margin: 0; color: var(--muted); font-size: .88rem; line-height: 1.5; }
a.card .path { display: block; margin-top: .5rem; color: #a5a29a; font-size: .75rem; }
label.card { cursor: pointer; margin: .5rem 0; }
label.card input { margin-right: .6rem; accent-color: var(--accent); }
.crumbs { color: var(--muted); font-size: .88rem; margin-bottom: 1.2rem; }
.lede { color: var(--muted); max-width: 38rem; }
.note { color: var(--muted); font-size: .9rem; }
.suggest { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); font-size: .9rem; color: var(--muted); }
.button, button.button {
  display: inline-block; padding: .55rem 1.1rem; background: var(--accent); color: #fff;
  border: 0; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer;
}
.button:hover { text-decoration: none; filter: brightness(1.08); }
button.quiet {
  font: inherit; font-size: .9rem; padding: .35rem .8rem; background: var(--card);
  border: 1px solid var(--line); border-radius: 6px; color: var(--ink); cursor: pointer;
}
.field { display: block; margin-top: .75rem; font-weight: 600; font-size: .9rem; }
.field small { color: var(--muted); font-weight: 400; }
.field input {
  display: block; width: 100%; margin-top: .25rem; font: inherit; padding: .45rem .6rem;
  border: 1px solid var(--line); border-radius: 6px; background: var(--card);
}
details { margin: 1.2rem 0; } summary { cursor: pointer; color: var(--muted); }
.actions { margin-top: 2rem; color: var(--muted); font-size: .9rem; }
`;

export const BRAND = "orgspec";
export const FOOTER =
  `<a href="https://github.com/org-spec/org-context-spec">Org Context Spec</a> — an open specification · ` +
  `hosted service operated by Lean State AB`;

export interface NavItem {
  href: string;
  label: string;
  active?: boolean;
}

/** The page shell: header with brand (or org name) and nav, main, footer. */
export function shell(opts: {
  title: string;
  brand?: string;
  brandNote?: string;
  nav?: NavItem[];
  body: string;
  footer?: string;
  /** Extra markup at the end of body — scripts. */
  tail?: string;
}): string {
  const nav = (opts.nav ?? [])
    .map((n) => `<a href="${n.href}"${n.active ? ' class="active"' : ""}>${escapeHtml(n.label)}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(opts.title)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="site"><div class="inner">
  <span class="org">${escapeHtml(opts.brand ?? BRAND)}${opts.brandNote ? `<small>${escapeHtml(opts.brandNote)}</small>` : ""}</span>
  <nav>${nav}</nav>
</div></header>
<main>${opts.body}</main>
<footer class="site">${opts.footer ?? FOOTER}</footer>
${opts.tail ?? ""}
</body>
</html>`;
}
