import type { ContextSource } from "./source.js";
import { CANONICAL_GAPS } from "./onboarding.js";

/**
 * Audit: reproducible checks that point at what is missing, unverified or
 * past its date in a context repository. Reads only conventions the spec
 * already has — TODO, "unverified" prose, effect-goal tables, template
 * placeholders, open-question sections, links and the reading order.
 *
 * Findings are signals, never grades: no score, no ranking of people, and
 * nothing here blocks a merge. Same files in, same findings out — for the
 * agent (get_context), for CI (`orgspec audit`), and for humans
 * (the web view).
 */

export interface ContextFile {
  path: string;
  content: string;
}

export interface Finding {
  rule: Rule;
  file: string;
  /** 1-based line, when the finding points at one. */
  line?: number;
  message: string;
}

export type Rule =
  | "missing-file"
  | "broken-link"
  | "unreachable"
  | "placeholder"
  | "todo"
  | "owner-todo"
  | "effect-goal-incomplete"
  | "horizon-passed"
  | "goal-untraced"
  | "unverified"
  | "open-questions";

export const RULES: Record<Rule, string> = {
  "missing-file": "a file the spec's reading order expects is not there",
  "broken-link": "a relative link points at nothing in the repository",
  unreachable: "a file no link from the README leads to — agents will not find it",
  placeholder: "a template placeholder <like this> was never replaced",
  todo: "lines marked TODO",
  "owner-todo": "an owner field still says TODO — nobody is responsible",
  "effect-goal-incomplete": "an effect goal without baseline, target or horizon",
  "horizon-passed": "a goal's horizon has passed and no outcome is recorded",
  "goal-untraced": "a product's effect goals do not trace to an organisation goal",
  unverified: "a statement the authors themselves marked as unverified or assumed",
  "open-questions": "questions waiting for a decision",
};

const isMarkdown = (p: string) => p.endsWith(".md");

/** POSIX-resolve `href` relative to the directory of `from`. */
function resolveLink(from: string, href: string): string {
  const clean = href.split("#")[0].split("?")[0];
  if (!clean) return from;
  const parts = from.split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/") + (clean.endsWith("/") ? "/" : "");
}

const isExternal = (href: string) => /^([a-z]+:|#|\/\/)/i.test(href);

function links(content: string): { href: string; line: number }[] {
  const out: { href: string; line: number }[] = [];
  content.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) out.push({ href: m[1], line: i + 1 });
  });
  return out;
}

/** Files a link target covers: the file itself, or everything under a directory link. */
function targets(resolved: string, paths: Set<string>): string[] {
  if (paths.has(resolved)) return [resolved];
  const prefix = resolved.endsWith("/") ? resolved : `${resolved}/`;
  return [...paths].filter((p) => p.startsWith(prefix));
}

interface Table {
  header: string[];
  rows: { cells: string[]; line: number }[];
}

function tables(content: string): Table[] {
  const lines = content.split("\n");
  const out: Table[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
    const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const table: Table = { header: cells(lines[i]), rows: [] };
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) table.rows.push({ cells: cells(lines[j]), line: j + 1 });
    out.push(table);
    i = j;
  }
  return out;
}

const col = (header: string[], re: RegExp) => header.findIndex((h) => re.test(h));
const blank = (cell: string | undefined) =>
  !cell ||
  /^(—|–|-|\?|n\/a|tbd|okänt|unknown|saknas)$/i.test(cell) ||
  /\bTODO\b|att fastställa|ej fastställ|to be (measured|determined|defined|set)|not (yet )?(measured|set)/i.test(cell);

/** End of the period a horizon names, for the unambiguous forms only. */
export function horizonEnd(cell: string): Date | undefined {
  const s = cell.trim();
  let m = s.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/);
  if (m) return m[3] ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(+m[1], +m[2], 0);
  m = s.match(/\b(?:([QTH])([1-4])\s*(\d{4})|(\d{4})\s*([QTH])([1-4]))\b/i);
  if (m) {
    const kind = (m[1] ?? m[5]).toUpperCase();
    const n = +(m[2] ?? m[6]);
    const year = +(m[3] ?? m[4]);
    const months = kind === "Q" ? 3 : kind === "T" ? 4 : 6;
    return new Date(year, n * months, 0);
  }
  return undefined;
}

const excerpt = (s: string, max = 90) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function audit(files: ContextFile[], today = new Date()): Finding[] {
  const out: Finding[] = [];
  const paths = new Set(files.map((f) => f.path));
  const add = (rule: Rule, file: string, message: string, line?: number) => out.push({ rule, file, message, line });

  // missing-file — the spec's expected files (shared with onboarding's gaps)
  for (const [pattern, hint] of CANONICAL_GAPS) {
    if (!files.some((f) => pattern.test(f.path))) add("missing-file", "", hint);
  }

  // broken-link + reachability from the README
  const reachable = new Set<string>();
  const queue = paths.has("README.md") ? ["README.md"] : [];
  while (queue.length) {
    const p = queue.pop()!;
    if (reachable.has(p)) continue;
    reachable.add(p);
    const f = files.find((x) => x.path === p);
    if (!f || !isMarkdown(p)) continue;
    for (const { href } of links(f.content)) {
      if (isExternal(href)) continue;
      for (const t of targets(resolveLink(p, href), paths)) queue.push(t);
    }
  }
  for (const f of files) {
    if (!isMarkdown(f.path)) continue;
    for (const { href, line } of links(f.content)) {
      if (isExternal(href)) continue;
      if (targets(resolveLink(f.path, href), paths).length === 0) add("broken-link", f.path, `link to ${href} points at nothing`, line);
    }
    if (paths.has("README.md") && !reachable.has(f.path)) add("unreachable", f.path, "no link from the README leads here");
  }

  for (const f of files) {
    if (!isMarkdown(f.path)) continue;
    const lines = f.content.split("\n");

    // placeholder + todo + unverified, line by line
    const todoLines: { line: number; text: string }[] = [];
    let todoSection: number | undefined; // heading level of a "## TODO" section we are inside
    let rulesSection: number | undefined; // "Writing rules" — mentions of TODO/unverified there are instructions, not gaps
    let inFence = false;
    lines.forEach((text, i) => {
      const line = i + 1;
      if (/^\s*```/.test(text)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return; // code is code: placeholders and TODOs in it are the author's business
      const heading = text.match(/^(#+)\s+(.*)/);
      if (heading) {
        const level = heading[1].length;
        todoSection = /^todo\b/i.test(heading[2]) ? level : todoSection !== undefined && level <= todoSection ? undefined : todoSection;
        rulesSection = /writing rules|skrivregler/i.test(heading[2]) ? level : rulesSection !== undefined && level <= rulesSection ? undefined : rulesSection;
        return;
      }
      const prose = text.replace(/`[^`]*`/g, "`…`"); // inline code kept out of the placeholder check
      if (/<[A-ZÅÄÖ][^<>]{3,}>/.test(prose)) add("placeholder", f.path, excerpt(text), line);
      if (rulesSection !== undefined) return;
      // Items of a TODO section, or an inline "TODO:" / "TODO —" / a TODO table cell.
      // Not the word TODO mentioned in prose (e.g. a writing rule that says "mark as TODO").
      if (todoSection !== undefined ? /^\s*([-*]|\d+\.)\s+\S/.test(text) : /\bTODO\s*([:—–-]|\|)/.test(text)) {
        todoLines.push({ line, text: text.replace(/^\s*([-*]|\d+\.)\s+/, "") });
      }
      if (
        /\bunverified\b|\bnot (yet )?verified\b|\bto be verified\b|\bunconfirmed\b/i.test(text) ||
        /inte verifierat|ej verifierad|obekräftad|bör verifieras|bör bekräftas|\*\*bekräfta\*\*|\bantagen\b.*bekräfta/i.test(text)
      ) {
        add("unverified", f.path, excerpt(text), line);
      }
    });
    if (todoLines.length) {
      const [first] = todoLines;
      const more = todoLines.length > 1 ? ` (+${todoLines.length - 1} more)` : "";
      add("todo", f.path, `${excerpt(first.text)}${more}`, first.line);
    }

    // owner-todo, effect goals, horizons, tracing
    let hasEffectTable = false;
    for (const t of tables(f.content)) {
      const property = col(t.header, /^(property|egenskap)$/i);
      if (property === 0 && t.header.length === 2) {
        for (const r of t.rows) {
          if (/^(owner|ägare|product owner|produktägare)$/i.test(r.cells[0] ?? "") && blank(r.cells[1])) {
            add("owner-todo", f.path, `${r.cells[0]}: ${r.cells[1] || "empty"}`, r.line);
          }
        }
      }
      const goal = col(t.header, /effect goal|effektmål/i);
      if (goal === -1) continue;
      hasEffectTable = true;
      const baseline = col(t.header, /baseline|utgångsläge|nuläge/i);
      const target = col(t.header, /^(target|mål|målvärde)/i);
      const horizon = col(t.header, /horizon|horisont|när/i);
      for (const r of t.rows) {
        const name = excerpt(r.cells[goal] ?? "", 50);
        const missing = [
          [baseline, "baseline"],
          [target, "target"],
          [horizon, "horizon"],
        ]
          .filter(([idx]) => idx !== -1 && blank(r.cells[idx as number]))
          .map(([, label]) => label);
        if (missing.length) add("effect-goal-incomplete", f.path, `"${name}" lacks ${missing.join(", ")}`, r.line);
        const end = horizon !== -1 && r.cells[horizon] ? horizonEnd(r.cells[horizon]) : undefined;
        if (end && end < today) add("horizon-passed", f.path, `"${name}" — horizon ${r.cells[horizon]} has passed; record the outcome`, r.line);
      }
    }
    if (hasEffectTable && /\/product\.md$/.test(f.path) && !/\]\([^)]*goals\.md|ref:\s*goal:/.test(f.content)) {
      add("goal-untraced", f.path, "effect goals do not link to organisation/goals.md");
    }

    // open-questions: list items under a heading that names them
    let inSection: number | undefined;
    let count = 0;
    let at = 0;
    lines.forEach((text, i) => {
      const h = text.match(/^(#+)\s+(.*)/);
      if (h) {
        if (inSection !== undefined && h[1].length <= inSection) inSection = undefined;
        if (inSection === undefined && /öppna frågor|open questions|beslut som väntar|decisions? (pending|waiting)|unresolved/i.test(h[2])) {
          inSection = h[1].length;
          at = i + 1;
        }
        return;
      }
      if (inSection !== undefined && /^\s*([-*]|\d+\.)\s+\S/.test(text)) count++;
    });
    if (count) add("open-questions", f.path, `${count} question${count > 1 ? "s" : ""} waiting for a decision`, at);
  }

  return out.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
}

/** The report as markdown — readable by agents and humans alike. */
export function renderAudit(findings: Finding[], opts: { title?: string; limit?: number } = {}): string {
  const title = opts.title ?? "Context audit";
  if (findings.length === 0) return `# ${title}\n\nNo findings.\n`;
  const byRule = new Map<Rule, number>();
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const files = new Set(findings.map((f) => f.file).filter(Boolean));
  const head =
    `# ${title}\n\n` +
    `${findings.length} finding${findings.length > 1 ? "s" : ""} in ${files.size} file${files.size === 1 ? "" : "s"}.\n\n` +
    [...byRule.entries()].map(([r, n]) => `- **${r}** ×${n} — ${RULES[r]}`).join("\n") +
    "\n";
  const shown = opts.limit ? findings.slice(0, opts.limit) : findings;
  const sections: string[] = [];
  let current: string | undefined;
  for (const f of shown) {
    if (f.file !== current) {
      current = f.file;
      sections.push(`\n## ${f.file || "(repository)"}\n`);
    }
    sections.push(`- ${f.rule}${f.line ? ` (line ${f.line})` : ""}: ${f.message}`);
  }
  const more = shown.length < findings.length ? `\n\n…and ${findings.length - shown.length} more — the full report is on the repository's audit page.` : "";
  return head + sections.join("\n") + more + "\n";
}

/** Read every file of a source and audit it. */
export async function auditSource(source: ContextSource, today = new Date()): Promise<Finding[]> {
  const paths = await source.listFiles();
  const files = await Promise.all(paths.map(async (path) => ({ path, content: await source.readFile(path) })));
  return audit(files, today);
}
