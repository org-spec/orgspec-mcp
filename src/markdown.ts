/**
 * Minimal Markdown renderer for the web view, covering the subset the Org
 * Context Spec templates use: ATX headings, tables, lists, blockquotes,
 * fenced code, inline code/bold/italic/links.
 *
 * Hand-rolled on purpose: all text is HTML-escaped before any markup is
 * added, so repo content can never inject HTML, and the server keeps its
 * zero-dependency footprint.
 */

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Maps a markdown href to a rendered URL (or returns it unchanged). */
export type LinkResolver = (href: string) => string;

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEME = /^(?:https?|mailto):/i;

/**
 * Only relative links and http(s)/mailto may become anchors. Repo content is
 * untrusted: a `javascript:` or `data:` href would run in the reader's session
 * on the app host, where the connect page shows repository keys. Anything
 * else is rendered as its link text, without an anchor.
 */
export function isSafeHref(href: string): boolean {
  return !HAS_SCHEME.test(href) || SAFE_SCHEME.test(href);
}

function renderInlineText(escaped: string, link: LinkResolver): string {
  let s = escaped;
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
    const target = link(href);
    return isSafeHref(target) ? `<a href="${target}">${text}</a>` : text;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return s;
}

/** Inline markdown → HTML. Code spans are lifted out first so nothing inside them is transformed. */
export function renderInline(src: string, link: LinkResolver = (h) => h): string {
  const parts: string[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    parts.push(renderInlineText(escapeHtml(src.slice(last, m.index)), link));
    parts.push(`<code>${escapeHtml(m[1])}</code>`);
    last = m.index + m[0].length;
  }
  parts.push(renderInlineText(escapeHtml(src.slice(last)), link));
  return parts.join("");
}

/** Block-level markdown → HTML. */
export function renderMarkdown(src: string, link: LinkResolver = (h) => h): string {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]): void => {
    if (buf.length > 0) out.push(`<p>${buf.map((l) => renderInline(l, link)).join(" ")}</p>`);
    buf.length = 0;
  };

  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      // ```mermaid blocks become <pre class="mermaid">: the page loads Mermaid
      // only when one is present and renders it in the browser. Text stays
      // text — diffable, proposable, readable by agents.
      const info = line.slice(3).trim().toLowerCase();
      flushParagraph(para);
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence
      out.push(
        info === "mermaid"
          ? `<pre class="mermaid">${escapeHtml(code.join("\n"))}</pre>`
          : `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4}) (.*)$/);
    if (heading) {
      flushParagraph(para);
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2], link)}</h${level}>`);
      i++;
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) {
      flushParagraph(para);
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^>/.test(line)) {
      flushParagraph(para);
      const quoted: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) quoted.push(lines[i++].replace(/^> ?/, ""));
      const paragraphs = quoted
        .join("\n")
        .split(/\n{2,}|\n(?=\s*$)/)
        .map((p) => p.trim())
        .filter((p) => p !== "");
      out.push(
        `<blockquote>${paragraphs.map((p) => `<p>${renderInline(p.replaceAll("\n", " "), link)}</p>`).join("")}</blockquote>`,
      );
      continue;
    }

    if (/^\|/.test(line)) {
      flushParagraph(para);
      const rows: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (row: string): string[] =>
        row
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const isSeparator = (row: string): boolean => /^[\s:|-]+$/.test(row);
      const body = rows.filter((r) => !isSeparator(r));
      if (body.length > 0) {
        const [head, ...rest] = body;
        const tr = (row: string, tag: "th" | "td"): string =>
          `<tr>${cells(row)
            .map((c) => `<${tag}>${renderInline(c, link)}</${tag}>`)
            .join("")}</tr>`;
        out.push(
          `<div class="tablewrap"><table><thead>${tr(head, "th")}</thead>` +
            `<tbody>${rest.map((r) => tr(r, "td")).join("")}</tbody></table></div>`,
        );
      }
      continue;
    }

    const listItem = (l: string): RegExpMatchArray | null => l.match(/^(\s*)(?:[-*]|\d+\.) (.*)$/);
    const first = listItem(line);
    if (first) {
      flushParagraph(para);
      const ordered = /^\s*\d+\./.test(line);
      const tag = ordered ? "ol" : "ul";
      const items: string[] = [];
      while (i < lines.length) {
        const m = listItem(lines[i]);
        if (m) {
          items.push(`<li>${renderInline(m[2], link)}</li>`);
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length > 0) {
          // continuation line of the previous item
          items[items.length - 1] = items[items.length - 1].replace(
            /<\/li>$/,
            ` ${renderInline(lines[i++].trim(), link)}</li>`,
          );
        } else break;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph(para);
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushParagraph(para);
  return out.join("\n");
}

/** The document's first `# ` heading as plain text, else undefined. */
export function extractTitle(src: string): string | undefined {
  const m = src.match(/^# (.+)$/m);
  if (!m) return undefined;
  return m[1].replace(/[*_`]/g, "").trim();
}

/** First plain paragraph (not heading/quote/table/list/fence) — the card teaser. */
export function extractTeaser(src: string, maxLen = 160): string | undefined {
  const para: string[] = [];
  for (const line of src.split(/\r?\n/)) {
    const t = line.trim();
    // Indented lines are list/quote continuations, a bare "Label:" line is a
    // lead-in to something below — neither reads as a teaser on its own.
    const special =
      t === "" || /^\s/.test(line) || /^(#|>|\||```|[-*] |\d+\. |-{3,}$)/.test(t) || (para.length === 0 && /:$/.test(t));
    if (special) {
      if (para.length > 0) break;
      continue;
    }
    para.push(t);
  }
  if (para.length === 0) return undefined;
  const joined = para.join(" ");
  if (joined.length <= maxLen) return joined;
  const cut = joined.slice(0, maxLen - 1);
  const atWord = cut.lastIndexOf(" ") > maxLen * 0.6 ? cut.slice(0, cut.lastIndexOf(" ")) : cut;
  return `${atWord.replace(/[,;:.\s]+$/, "")}…`;
}

