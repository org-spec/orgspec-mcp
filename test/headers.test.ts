import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { securityHeaders } from "../src/headers.js";
import { MERMAID_INIT, MERMAID_INIT_HASH, MERMAID_INTEGRITY, MERMAID_ORIGIN, MERMAID_SRC, MERMAID_TAIL, MERMAID_VERSION } from "../src/mermaid.js";
import { shell } from "../src/theme.js";

const REQUIRED = ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security", "Content-Security-Policy"];

test("securityHeaders: every response carries the full set", () => {
  for (const ct of ["text/html; charset=utf-8", "application/json", "text/plain; charset=utf-8"]) {
    const h = securityHeaders(ct);
    for (const name of REQUIRED) assert.ok(h[name], `${name} on ${ct}`);
    assert.equal(h["X-Frame-Options"], "DENY");
    assert.equal(h["Referrer-Policy"], "no-referrer");
    assert.match(h["Strict-Transport-Security"], /max-age=\d{7,}; includeSubDomains/);
  }
});

test("securityHeaders: HTML policy allows only self, the pinned Mermaid origin and its init hash", () => {
  const csp = securityHeaders("text/html; charset=utf-8")["Content-Security-Policy"];
  const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";
  assert.equal(directive("script-src"), `script-src 'self' ${MERMAID_ORIGIN} '${MERMAID_INIT_HASH}'`);
  assert.ok(!directive("script-src").includes("unsafe-inline"));
  assert.ok(!csp.includes("unsafe-eval"));
  assert.equal(directive("object-src"), "object-src 'none'");
  assert.equal(directive("base-uri"), "base-uri 'none'");
  assert.equal(directive("frame-ancestors"), "frame-ancestors 'none'");
  assert.match(directive("form-action"), /^form-action 'self' https:$/);
});

test("securityHeaders: non-HTML gets a deny-all policy", () => {
  assert.equal(securityHeaders("application/json")["Content-Security-Policy"], "default-src 'none'; frame-ancestors 'none'");
});

test("mermaid: the CSP hash is the hash of the inline init script actually emitted", () => {
  const inline = MERMAID_TAIL.match(/<script>([^<]*)<\/script>/)?.[1];
  assert.equal(inline, MERMAID_INIT);
  assert.equal(MERMAID_INIT_HASH, `sha256-${createHash("sha256").update(inline!).digest("base64")}`);
  assert.match(MERMAID_INIT, /securityLevel: "strict"/);
});

test("mermaid: pinned exact version with Subresource Integrity", () => {
  assert.match(MERMAID_VERSION, /^\d+\.\d+\.\d+$/, "exact version, not a range");
  assert.equal(MERMAID_SRC, `${MERMAID_ORIGIN}/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`);
  assert.match(MERMAID_INTEGRITY, /^sha384-[A-Za-z0-9+/]{64}$/);
  assert.ok(MERMAID_TAIL.includes(`integrity="${MERMAID_INTEGRITY}"`));
  assert.ok(MERMAID_TAIL.includes('crossorigin="anonymous"'));
});

test("theme shell: no inline event handlers or scripts beyond the tail", () => {
  const html = shell({ title: "t", body: "<p>x</p>", nav: [{ href: "/a", label: "<b>" }] });
  assert.ok(!/\son\w+="/.test(html));
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("&lt;b&gt;"), "nav labels are escaped");
});

test("netlify.toml: static headers mirror the function policy", () => {
  const toml = readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
  const fn = securityHeaders("text/html; charset=utf-8");
  for (const name of REQUIRED.filter((n) => n !== "Content-Security-Policy")) {
    assert.ok(toml.includes(`${name} = "${fn[name]}"`), `${name} in netlify.toml matches headers.ts`);
  }
  const staticCsp = toml.match(/Content-Security-Policy = "([^"]+)"/)?.[1] ?? "";
  for (const d of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'"]) {
    assert.ok(staticCsp.includes(d), `static CSP has ${d}`);
  }
  assert.ok(!staticCsp.includes("unsafe-inline'") || staticCsp.includes("style-src 'self' 'unsafe-inline'"), "inline only for styles");
  assert.ok(!/script-src[^;]*unsafe-inline/.test(staticCsp), "no inline scripts on the landing page");
});

test("landing page: no inline script or handlers (the static CSP would block them)", () => {
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /\ssrc="\/[^"]+"/, "every script tag is external and same-origin");
  assert.ok(!/\son\w+="/.test(html), "no on*= handlers");
});
