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
.crumbs .gap { color: #8a877f; font-style: italic; }
.decide { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; font-size: .93rem; color: var(--muted); margin: 0 0 1.8rem; }
.decide b { color: var(--ink); font-weight: 600; }
.band { display: grid; grid-template-columns: 7.5rem 1fr; gap: 1.25rem; padding: 1.6rem 0; border-top: 1px solid var(--line); }
.band:first-of-type { border-top: 0; padding-top: 0; }
.band > .label { font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); padding-top: .35rem; font-weight: 600; }
.band > .label small { display: block; letter-spacing: 0; text-transform: none; font-weight: 400; margin-top: .3rem; color: #8a877f; }
@media (max-width: 640px) { .band { grid-template-columns: 1fr; gap: .5rem; } }
.why { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1.4rem 2rem; }
.why .slot h3 { margin: 0 0 .3rem; font-size: 1rem; }
.why .slot p { margin: 0; font-size: .93rem; color: var(--muted); }
.why .slot ul { margin: .2rem 0 0; padding-left: 1.1rem; font-size: .93rem; color: var(--muted); }
.why .slot.gap h3 { color: #8a877f; font-weight: 500; }
.why .slot.gap p { color: #8a877f; font-style: italic; }
.chain-start { grid-column: 1 / -1; font-size: .9rem; color: var(--muted); border-left: 3px solid var(--accent); padding: .15rem .8rem; background: var(--accent-soft); border-radius: 0 6px 6px 0; }
.products { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr)); gap: .8rem; }
.product { display: block; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .9rem 1rem; }
.product:hover { text-decoration: none; border-color: var(--accent); }
.product h3 { margin: 0 0 .25rem; font-size: 1rem; }
.product .vision { font-size: .88rem; color: var(--muted); margin: 0 0 .6rem; }
.product .meta { font-size: .8rem; color: var(--muted); display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
.dot { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; background: #c9902e; vertical-align: middle; }
.teams { display: grid; grid-template-columns: 1fr 1fr; gap: .1rem 2rem; }
.teams .team:only-child { grid-column: 1 / -1; }
@media (max-width: 720px) { .teams { grid-template-columns: 1fr; } }
.team { display: grid; grid-template-columns: 9rem 1fr; gap: .8rem; padding: .5rem 0; border-bottom: 1px solid var(--line); color: var(--ink); align-items: baseline; }
.team:hover { text-decoration: none; } .team:hover .name { text-decoration: underline; }
.team .name { font-weight: 600; font-size: .95rem; }
.team .name small { display: block; font-weight: 400; color: var(--muted); font-size: .8rem; }
.team .owns { font-size: .86rem; color: var(--muted); } .team .owns b { color: var(--ink); font-weight: 500; }
.rowline { margin-top: 1.1rem; font-size: .93rem; color: var(--muted); display: flex; gap: 1.5rem; flex-wrap: wrap; }
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
  `<a href="https://github.com/org-spec/orgspec">Org Context Spec</a> — an open specification · ` +
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
