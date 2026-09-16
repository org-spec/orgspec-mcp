import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Black-box test of the Node HTTP entry (src/http.ts): a real process, a
 * temporary context folder, real requests. Covers what a deploy must never
 * regress on: the access key gate, the fail-closed start, the security
 * headers and the capability-URL web view.
 */

const SERVER = new URL("../src/http.js", import.meta.url).pathname;
const KEY = "test-access-key";
const WEB_KEY = "test-web-key";

let dir: string;
let port: number;
let child: ChildProcess | undefined;
let base: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

function start(env: Record<string, string>): Promise<{ proc: ChildProcess; stderr: string; exited?: number | null }> {
  return new Promise((resolve) => {
    // Start from a clean slate: nothing from the developer's shell (a real
    // ORG_CONTEXT_GITHUB, say) may leak into the server under test.
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ORG_CONTEXT_|MCP_)/.test(k)));
    const proc = spawn(process.execPath, [SERVER], { env: { ...clean, ...env }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    proc.stderr!.on("data", (d) => {
      stderr += d;
      if (!settled && stderr.includes("orgspec: http://")) {
        settled = true;
        resolve({ proc, stderr });
      }
    });
    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        resolve({ proc, stderr, exited: code });
      }
    });
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "occtx-test-"));
  mkdirSync(join(dir, "organisation"));
  writeFileSync(join(dir, "README.md"), "# Test Org\n\nA test context.\n");
  writeFileSync(
    join(dir, "organisation", "goals.md"),
    "# Goals\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n[ok](https://example.com) [bad](javascript:alert(1))\n",
  );
  writeFileSync(join(dir, ".env"), "SECRET=do-not-serve\n");
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const started = await start({ PORT: String(port), ORG_CONTEXT_PATH: dir, MCP_ACCESS_KEY: KEY, ORG_CONTEXT_WEB_KEY: WEB_KEY });
  assert.equal(started.exited, undefined, `server failed to start: ${started.stderr}`);
  child = started.proc;
});

after(() => {
  child?.kill();
  rmSync(dir, { recursive: true, force: true });
});

const mcp = (headers: Record<string, string>, body: unknown) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } };

test("fail-closed: a default repo without MCP_ACCESS_KEY refuses to start", async () => {
  const p = await freePort();
  const res = await start({ PORT: String(p), ORG_CONTEXT_PATH: dir, MCP_ACCESS_KEY: "" });
  assert.equal(res.exited, 1);
  assert.match(res.stderr, /refusing to serve .* without MCP_ACCESS_KEY/);
});

test("mcp: no key or wrong key → 401 with a WWW-Authenticate pointer, never content", async () => {
  const none = await mcp({}, initialize);
  assert.equal(none.status, 401);
  assert.match(none.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  assert.equal(none.headers.get("content-security-policy"), null, "JSON error path is not the page path");
  const wrong = await mcp({ Authorization: `Bearer ${KEY}x` }, initialize);
  assert.equal(wrong.status, 401);
  const prefix = await mcp({ Authorization: `Bearer ${KEY.slice(0, -1)}` }, initialize);
  assert.equal(prefix.status, 401);
});

test("mcp: the right key initialises a session-less MCP server", async () => {
  const res = await mcp({ Authorization: `Bearer ${KEY}` }, initialize);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { result?: { serverInfo?: { name: string } } };
  assert.ok(body.result?.serverInfo?.name, JSON.stringify(body));
});

test("mcp: get_context reads context files and nothing else", async () => {
  const call = (name: string, args: unknown) =>
    mcp({ Authorization: `Bearer ${KEY}` }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } })
      .then((r) => r.json() as Promise<{ result?: { content?: { text: string }[]; isError?: boolean } }>)
      .then((j) => ({ text: j.result?.content?.map((c) => c.text).join("\n") ?? "", isError: j.result?.isError === true }));
  const goals = await call("get_context", { path: "organisation/goals.md" });
  assert.ok(goals.text.includes("# Goals"), goals.text.slice(0, 200));
  for (const path of [".env", "../.env", "organisation/../.env", "/etc/hosts"]) {
    const leak = await call("get_context", { path });
    assert.ok(!leak.text.includes("do-not-serve"), `${path}: ${leak.text.slice(0, 200)}`);
    assert.ok(!leak.text.includes("localhost"), `${path}: ${leak.text.slice(0, 200)}`);
  }
});

test("web view: wrong capability key is not found; the right one renders with security headers", async () => {
  assert.equal((await fetch(`${base}/c/not-the-key/`)).status, 404);
  const page = await fetch(`${base}/c/${WEB_KEY}/f/organisation/goals.md`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  assert.equal(page.headers.get("cache-control"), "no-store");
  const csp = page.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net 'sha256-[A-Za-z0-9+/=]+'/);
  const html = await page.text();
  assert.ok(html.includes('<pre class="mermaid">'));
  assert.ok(html.includes('integrity="sha384-'));
  assert.ok(!html.includes('href="javascript:'), "dangerous link neutralised");
  assert.ok(html.includes('href="https://example.com"'));
});

test("web view: hidden files are not reachable even with the key", async () => {
  const res = await fetch(`${base}/c/${WEB_KEY}/f/.env`);
  assert.notEqual(res.status, 200);
  assert.ok(!(await res.text()).includes("do-not-serve"));
});

test("unknown routes: JSON 404, no stack traces", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Not found/);
});

test("open mode (no key) binds to the loopback interface only", async () => {
  const p = await freePort();
  const res = await start({ PORT: String(p), ORG_CONTEXT_PATH: dir, MCP_ACCESS_KEY: "", ORG_CONTEXT_ALLOW_OPEN: "1" });
  try {
    assert.equal(res.exited, undefined, `server failed to start: ${res.stderr}`);
    assert.match(res.stderr, /orgspec: http:\/\/127\.0\.0\.1:/, "log states the real bind address");
    assert.equal((await fetch(`http://127.0.0.1:${p}/c/x/`)).status, 404, "reachable on loopback");
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && !i.internal && i.family === "IPv4");
    if (lan) {
      await assert.rejects(fetch(`http://${lan.address}:${p}/c/x/`), `reachable from the LAN address ${lan.address}`);
    }
  } finally {
    res.proc.kill();
  }
});

test("a keyed server binds to every interface, and the log says so", async () => {
  const p = await freePort();
  const res = await start({ PORT: String(p), ORG_CONTEXT_PATH: dir, MCP_ACCESS_KEY: KEY });
  try {
    assert.equal(res.exited, undefined, `server failed to start: ${res.stderr}`);
    assert.match(res.stderr, /orgspec: http:\/\/localhost:\d+\/mcp \(all interfaces\)/);
  } finally {
    res.proc.kill();
  }
});
