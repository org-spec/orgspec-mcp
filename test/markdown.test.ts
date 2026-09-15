import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, isSafeHref, renderInline, renderMarkdown } from "../src/markdown.js";

test("escapeHtml: the four characters that matter in text and attributes", () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;'&lt;/a&gt;");
});

test("isSafeHref: relative and http(s)/mailto only", () => {
  for (const ok of ["teams/a.md", "../README.md", "#anchor", "//cdn.example/x", "https://a.b", "HTTP://a.b", "mailto:x@y.z"]) {
    assert.equal(isSafeHref(ok), true, ok);
  }
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "ftp://x"]) {
    assert.equal(isSafeHref(bad), false, bad);
  }
});

test("renderMarkdown: content can never inject markup", () => {
  const out = renderMarkdown(`# Title <script>alert(1)</script>\n\nText <img src=x onerror=alert(1)> here.`);
  assert.ok(!out.includes("<script"), "script tag escaped");
  assert.ok(!out.includes("<img"), "img tag escaped");
  assert.ok(out.includes("&lt;script&gt;"));
});

test("renderMarkdown: dangerous link schemes render as plain text", () => {
  const cases: [string, boolean][] = [
    ["[x](javascript:alert(1))", false],
    ["[x](JAVASCRIPT:alert(1))", false],
    ["[x](data:text/html;base64,PHNjcmlwdD4=)", false],
    ["[x](vbscript:msgbox)", false],
    ["[x](https://example.com)", true],
    ["[x](mailto:a@b.c)", true],
    ["[x](teams/a.md)", true],
  ];
  for (const [src, anchored] of cases) {
    const out = renderMarkdown(src);
    assert.equal(out.includes("<a "), anchored, src);
    assert.ok(!/href="(javascript|data|vbscript):/i.test(out), src);
  }
});

test("renderMarkdown: percent-encoded and entity-encoded schemes stay inert", () => {
  // No scheme match → treated as relative; the browser resolves it as a path, not a scheme.
  const pct = renderMarkdown("[x](%6Aavascript:alert(1))");
  assert.ok(!pct.includes('href="javascript'));
  // Entities are escaped once and never decoded back into a scheme.
  const ent = renderMarkdown("[x](&#106;avascript:alert(1))");
  assert.ok(ent.includes("&amp;#106;") || !ent.includes("<a "), ent);
});

test("renderMarkdown: link text cannot break out of the href attribute", () => {
  const out = renderMarkdown('[x](https://a.b/" onclick="alert(1))');
  assert.ok(!out.includes('onclick="alert'), out);
});

test("renderMarkdown: the link resolver's result is checked, not the raw href", () => {
  const out = renderMarkdown("[x](teams/a.md)", () => "javascript:alert(1)");
  assert.ok(!out.includes("<a "), out);
});

test("renderInline: code spans are not transformed", () => {
  const out = renderInline("Use `[not](javascript:x)` and **bold**");
  assert.ok(out.includes("<code>[not](javascript:x)</code>"));
  assert.ok(out.includes("<strong>bold</strong>"));
});

test("renderMarkdown: mermaid fences become an escaped <pre class=mermaid>", () => {
  const out = renderMarkdown("```mermaid\nflowchart LR\n  A[<b>x</b>] --> B\n```");
  assert.ok(out.includes('<pre class="mermaid">'));
  assert.ok(out.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(!out.includes("<b>x</b>"));
});
