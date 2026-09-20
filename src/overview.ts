import { escapeHtml, extractTeaser, extractTitle } from "./markdown.js";
import { blank, col, links, resolveLink, tables, targets, WRONG_RULES, type ContextFile, type Finding, type Rule } from "./audit.js";

/**
 * The overview: the organisation as a chain, top to bottom — why (the
 * organisation layer), what (the product areas), who and where (teams, the
 * system map, the method). Nothing here is configured: titles, first lines
 * and the links between files are read from the repository as it is, so the
 * page is the same for an eight-team company and a three-file start.
 *
 * What is missing is shown as missing. The organisation layer's gaps are
 * the message, not something to paper over with cards.
 */

const ORG_SLOTS: [stem: string, title: string, what: string][] = [
  ["constraints", "Constraints", "the binding rules, read before acting"],
  ["goals", "Goals", "what every product effect traces to"],
  ["principles", "Principles", "the ones that change decisions"],
  ["ways-of-working", "Ways of working", "the rhythm and who calls it"],
];

const fileHref = (base: string, path: string) => `${base}/f/${path.split("/").map(encodeURIComponent).join("/")}`;
const title = (f: ContextFile) => extractTitle(f.content) ?? f.path.split("/").pop()!.replace(/\.md$/, "");
const byPath = (files: ContextFile[], path: string) => files.find((f) => f.path === path);

/** Files a document links to, as repository paths. */
function linkedPaths(f: ContextFile, paths: Set<string>): string[] {
  const out: string[] = [];
  for (const { href } of links(f.content)) {
    if (/^([a-z]+:|#|\/\/)/i.test(href)) continue;
    for (const t of targets(resolveLink(f.path, href), paths)) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** The paragraph under a heading such as "## Vision", else the teaser. */
function sectionText(content: string, re: RegExp): string | undefined {
  const lines = content.split(/\r?\n/);
  const at = lines.findIndex((l) => /^##+\s/.test(l) && re.test(l));
  if (at === -1) return undefined;
  const rest = lines.slice(at + 1).join("\n").split(/\n#+\s/)[0];
  return extractTeaser(rest, 140);
}

/**
 * The top-level bullets of a file, each as its bold lead or first sentence —
 * the spec's template writes constraints and principles as a quote and a
 * list, which has no teaser paragraph to show.
 */
export function bulletLeads(content: string, max = 3): { leads: string[]; more: number } {
  const bullets: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^[-*] /.test(line)) bullets.push(line.slice(2).trim());
    else if (bullets.length > 0 && /^\s+\S/.test(line)) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  const leads = bullets.slice(0, max).map((b) => {
    const lead = (/^\*\*(.+?)\*\*/.exec(b)?.[1] ?? /^(.+?[.;])(\s|$)/.exec(b)?.[1] ?? b).replace(/[*_`]/g, "").replace(/[.;]$/, "");
    return lead.length > 90 ? `${lead.slice(0, lead.lastIndexOf(" ", 89))}…` : lead;
  });
  return { leads, more: Math.max(0, bullets.length - max) };
}

/** Effect-goal rows in a product file, and how many lack a value. */
export function effectGoals(content: string): { total: number; incomplete: number } {
  let total = 0;
  let incomplete = 0;
  for (const t of tables(content)) {
    if (col(t.header, /effect goal|effektmål/i) === -1) continue;
    const cols = [col(t.header, /baseline|utgångsläge|nuläge/i), col(t.header, /^(target|mål|målvärde)/i), col(t.header, /horizon|horisont|när/i)];
    for (const r of t.rows) {
      total++;
      if (cols.some((c) => c !== -1 && blank(r.cells[c]))) incomplete++;
    }
  }
  return { total, incomplete };
}

interface Product {
  file: ContextFile;
  name: string;
  vision?: string;
  team?: ContextFile;
  goals: { total: number; incomplete: number };
}
interface Team {
  file: ContextFile;
  name: string;
  line?: string;
  products: Product[];
  systems: number;
  ownMethod: boolean;
}

export interface Chain {
  products: Product[];
  teams: Team[];
  goals?: ContextFile;
}

/** The relations the chain is drawn from — all derived from links. */
export function chain(files: ContextFile[]): Chain {
  const paths = new Set(files.map((f) => f.path));
  const productFiles = files.filter((f) => /^products\/[^/]+\/product\.md$/.test(f.path));
  const products: Product[] = (productFiles.length ? productFiles : files.filter((f) => /^products\/[^/]+\.md$/.test(f.path))).map((f) => {
    const teamPath = linkedPaths(f, paths).find((p) => /^teams\/[^/]+\.md$/.test(p));
    return {
      file: f,
      name: title(f),
      vision: sectionText(f.content, /vision/i) ?? extractTeaser(f.content, 140),
      team: teamPath ? byPath(files, teamPath) : undefined,
      goals: effectGoals(f.content),
    };
  });
  const teams: Team[] = files
    .filter((f) => /^teams\/[^/]+\.md$/.test(f.path))
    .map((f) => {
      const stem = f.path.slice("teams/".length, -3);
      const linked = linkedPaths(f, paths);
      const owned = products.filter((p) => linked.includes(p.file.path) || p.team?.path === f.path);
      return {
        file: f,
        name: title(f),
        line: extractTeaser(f.content, 90),
        products: owned,
        systems: linked.filter((p) => p.startsWith("system/") && !/README\.md$/.test(p)).length,
        ownMethod: files.some((m) => m.path.startsWith(`method/${stem}/`)),
      };
    });
  return { products, teams, goals: byPath(files, "organisation/goals.md") };
}

/** The organisation's own word for its product areas, if the README names them. */
function whatLabel(files: ContextFile[]): string {
  const readme = byPath(files, "README.md");
  if (readme) {
    for (const m of readme.content.matchAll(/\[([^\]`<>/]{2,40})\]\((?:\.\/)?products\/?\)/g)) return m[1].trim();
  }
  return "product areas";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line above the bands: what waits for a decision. */
export function decisionLine(findings: Finding[], base: string): string {
  const phrase: Partial<Record<Rule, (n: number) => string>> = {
    "missing-file": (n) => plural(n, "expected file", "expected files") + " missing",
    "owner-todo": (n) => plural(n, "owner says", "owners say") + " TODO",
    "effect-goal-incomplete": (n) => plural(n, "effect-goal value", "effect-goal values") + " to be established",
    "horizon-passed": (n) => plural(n, "goal horizon", "goal horizons") + " passed",
    "goal-untraced": (n) => plural(n, "product", "products") + " not traced to a goal",
    "open-questions": (n) => plural(n, "open question", "open questions"),
  };
  // Phrases in priority order (the order of `phrase` above); at most three are shown.
  const counts = (Object.keys(phrase) as Rule[]).map((r) => [r, findings.filter((f) => f.rule === r).length] as [Rule, number]).filter(([, n]) => n > 0);
  const total = counts.reduce((a, [, n]) => a + n, 0);
  if (total === 0) return "";
  const parts = counts.slice(0, 3).map(([r, n]) => phrase[r]!(n));
  return (
    `<div class="decide"><b>${plural(total, "thing waits", "things wait")} for a decision</b>` +
    parts.map((p) => `<span>· ${escapeHtml(p)}</span>`).join("") +
    `<a href="${base}/audit">See all</a></div>`
  );
}

export function overviewBody(files: ContextFile[], base: string, findings: Finding[]): string {
  const paths = new Set(files.map((f) => f.path));
  const c = chain(files);
  const href = (p: string) => fileHref(base, p);
  const slot = (h: string, p: string) => `<div class="slot"><h3>${h}</h3>${p ? `<p>${p}</p>` : ""}</div>`;

  // WHY — the organisation layer as lines, gaps shown as gaps.
  const why: string[] = [];
  if (!c.goals) {
    why.push(
      `<div class="chain-start">The chain starts here. Constraints, goals and principles are what everything below traces to` +
      (ORG_SLOTS.every(([s]) => !paths.has(`organisation/${s}.md`)) ? ` — none of them exist yet` : "") +
      `. Add goals first: without them no effect goal below can trace anywhere.</div>`,
    );
  }
  for (const [stem, name, what] of ORG_SLOTS) {
    const f = byPath(files, `organisation/${stem}.md`);
    if (!f) {
      why.push(`<div class="slot gap"><h3>${name}</h3><p>not yet — ${what}</p></div>`);
      continue;
    }
    const teaser = extractTeaser(f.content, 120);
    const heads = stem === "goals" ? [...f.content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].replace(/[*_`]/g, "").trim()).slice(0, 6) : [];
    // No headings and no teaser paragraph: the file is a list — show its first lines.
    const { leads, more } = heads.length || teaser ? { leads: [], more: 0 } : bulletLeads(f.content);
    const items = [...heads, ...leads].map((h) => `<li>${escapeHtml(h)}</li>`);
    if (more) items.push(`<li class="note">+ ${more} more</li>`);
    why.push(
      slot(`<a href="${href(f.path)}">${escapeHtml(title(f))}</a>`, items.length ? "" : escapeHtml(teaser ?? "")).replace(
        "</h3>",
        `</h3>${items.length ? `<ul>${items.join("")}</ul>` : ""}`,
      ),
    );
  }
  for (const f of files.filter((f) => f.path.startsWith("organisation/") && !ORG_SLOTS.some(([s]) => f.path === `organisation/${s}.md`))) {
    const kind = f.path.split("/").length > 2 ? ` <span class="note">· ${escapeHtml(f.path.split("/")[1])}</span>` : "";
    why.push(slot(`<a href="${href(f.path)}">${escapeHtml(title(f))}</a>${kind}`, escapeHtml(extractTeaser(f.content, 120) ?? "")));
  }

  // WHAT — one entry per product area.
  const what = c.products.map(
    (p) =>
      `<a class="product" href="${href(p.file.path)}"><h3>${escapeHtml(p.name)}</h3>` +
      (p.vision ? `<p class="vision">${escapeHtml(p.vision)}</p>` : "") +
      `<div class="meta">` +
      (p.team ? `<span>${escapeHtml(title(p.team))}</span><span>·</span>` : "") +
      `<span>${plural(p.goals.total, "effect goal")}${p.goals.incomplete ? ` <span class="dot" title="${p.goals.incomplete} to be established"></span>` : ""}</span>` +
      `</div></a>`,
  );

  // WHO · WHERE — compact team rows, then the map and the method as one line each.
  const who = c.teams.map(
    (t) =>
      `<a class="team" href="${href(t.file.path)}"><span class="name">${escapeHtml(t.name)}${t.line ? `<small>${escapeHtml(t.line)}</small>` : ""}</span>` +
      `<span class="owns">${t.products.length ? `<b>${t.products.map((p) => escapeHtml(p.name)).join(", ")}</b>` : "<b>no product area</b>"}` +
      (t.systems ? ` · ${plural(t.systems, "system")}` : "") +
      (t.ownMethod ? " · own method" : "") +
      `</span></a>`,
  );
  const systemFiles = files.filter((f) => f.path.startsWith("system/"));
  const systemMap = byPath(files, "system/README.md");
  const systemCount = systemFiles.filter((f) => f !== systemMap).length;
  const methodHome = byPath(files, "method/README.md") ?? files.find((f) => f.path.startsWith("method/"));
  const methodCount = files.filter((f) => /^method\/[^/]+\.md$/.test(f.path) && f.path !== "method/README.md").length;
  const overrides = new Set(files.filter((f) => /^method\/[^/]+\//.test(f.path)).map((f) => f.path.split("/")[1])).size;
  const rowline: string[] = [];
  if (systemMap) rowline.push(`<a href="${href(systemMap.path)}">The system map${systemCount ? ` — ${plural(systemCount, "system")}` : ""}</a>`);
  else if (systemCount) rowline.push(`<span>Systems: ${systemFiles.map((f) => `<a href="${href(f.path)}">${escapeHtml(title(f))}</a>`).join(", ")}</span>`);
  if (methodHome) rowline.push(`<a href="${href(methodHome.path)}">How content is created here${methodCount ? ` — ${plural(methodCount, "method")}` : ""}${overrides ? `, ${plural(overrides, "team override")}` : ""}</a>`);

  const band = (label: string, sub: string, inner: string) =>
    `<section class="band"><div class="label">${label}<small>${escapeHtml(sub)}</small></div><div>${inner}</div></section>`;
  return (
    decisionLine(findings, base) +
    band("Why", "the organisation", `<div class="why">${why.join("")}</div>`) +
    (what.length ? band("What", whatLabel(files), `<div class="products">${what.join("")}</div>`) : "") +
    (who.length || rowline.length
      ? band("Who · Where", "teams and the map", `<div class="teams">${who.join("")}</div>` + (rowline.length ? `<div class="rowline">${rowline.join("")}</div>` : ""))
      : "")
  );
}

/** Breadcrumbs that climb the chain: product → its team, team → its products. */
export function chainCrumbs(files: ContextFile[], path: string, base: string): string {
  const c = chain(files);
  const home = `<a href="${base}/">Overview</a>`;
  const goals = c.goals ? `<a href="${fileHref(base, c.goals.path)}">${escapeHtml(title(c.goals))}</a>` : `<span class="gap">Goals (not yet)</span>`;
  const sep = " › ";
  const product = c.products.find((p) => p.file.path === path);
  if (product) {
    return `<div class="crumbs">${[home, goals, `<b>${escapeHtml(product.name)}</b>` + (product.team ? ` · owned by <a href="${fileHref(base, product.team.path)}">${escapeHtml(title(product.team))}</a>` : "")].join(sep)}</div>`;
  }
  const team = c.teams.find((t) => t.file.path === path);
  if (team) {
    const owned = team.products.length ? team.products.map((p) => `<a href="${fileHref(base, p.file.path)}">${escapeHtml(p.name)}</a>`).join(", ") : `<span class="note">no product area</span>`;
    return `<div class="crumbs">${[home, goals, owned, `<b>${escapeHtml(team.name)}</b>`].join(sep)}</div>`;
  }
  return `<div class="crumbs">${home}${sep}${escapeHtml(path)}</div>`;
}

export { WRONG_RULES };
