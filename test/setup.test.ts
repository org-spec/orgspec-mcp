import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderSetup } from "../src/setup.js";
import { issueKey } from "../src/app.js";
import { cfg, githubUser, installEnvConfig, stubFetch } from "./helpers.js";

installEnvConfig();

const APP = "https://app.example.test";
const USER_TOKEN = "gho_alice";
// Alice reaches installation 501 (one repo) and 502 (one of its two repos).
// Installation 777 exists on GitHub (the App is installed there) but Alice
// has no access to any of its repositories — she must not get keys for it.
const ALICE = { "501": ["acme/org-context"], "502": ["beta/ctx"] };

let restore: () => void = () => {};
beforeEach(() => {
  restore = stubFetch({
    ...githubUser({ login: "alice", userToken: USER_TOKEN, installations: ALICE }),
    "GET api.github.com/app": () => ({ slug: "org-context-test-app" }),
  }).restore;
});
afterEach(() => restore());

const setup = (qs: string, method = "GET") => renderSetup(new URL(`${APP}/setup${qs}`), method);

test("H1 regression: keys are issued only for repositories the signed-in user can reach", async () => {
  const denied = await setup("?code=good-code&installation_id=777&setup_action=install");
  assert.equal(denied!.status, 403);
  assert.ok(!denied!.body.includes("oc1."), "no key material on the refusal page");

  const ok = await setup("?code=good-code&installation_id=502&setup_action=install");
  assert.equal(ok!.status, 200);
  assert.ok(ok!.body.includes(issueKey(cfg, "502", "beta/ctx")), "key for the repo she can reach");
  assert.ok(!ok!.body.includes(issueKey(cfg, "502", "beta/ctx-2")), "no key for a sibling repo she cannot reach");
  assert.ok(!ok!.body.includes(issueKey(cfg, "501", "acme/org-context")), "keys are per installation");
});

test("setup: the session cookie is HttpOnly, Secure, SameSite and bounded", async () => {
  const ok = await setup("?code=good-code&installation_id=501");
  const cookie = ok!.headers!["Set-Cookie"];
  assert.match(cookie, /^oc_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
});

test("setup: a bad OAuth code never reaches the repository listing", async () => {
  const res = await setup("?code=stolen&installation_id=501");
  assert.equal(res!.status, 502);
  assert.ok(!res!.body.includes("oc1."));
});

test("setup: without a code it sends the user to install the App; other methods refused", async () => {
  const res = await setup("");
  assert.equal(res!.status, 302);
  assert.equal(res!.headers!.Location, "https://github.com/apps/org-context-test-app/installations/new");
  assert.equal((await setup("", "POST"))!.status, 405);
  assert.equal(await renderSetup(new URL(`${APP}/other`), "GET"), undefined);
});

test("setup: signed in but not installed anywhere yet → guidance, no keys", async () => {
  const res = await setup("?code=good-code");
  assert.equal(res!.status, 200);
  assert.ok(res!.body.includes("installations/new"));
  assert.ok(!res!.body.includes("oc1."));
});

test("setup: refuses to run without a configured App", async () => {
  const saved = process.env.ORG_CONTEXT_APP_ID;
  delete process.env.ORG_CONTEXT_APP_ID;
  try {
    assert.equal((await setup("?code=good-code&installation_id=501"))!.status, 404);
  } finally {
    process.env.ORG_CONTEXT_APP_ID = saved;
  }
  // A present but broken key is reported as misconfiguration, never as open access.
  const key = process.env.ORG_CONTEXT_APP_PRIVATE_KEY;
  process.env.ORG_CONTEXT_APP_PRIVATE_KEY = "SHA256:fingerprint-pasted-by-mistake";
  try {
    assert.equal((await setup("?code=good-code&installation_id=501"))!.status, 500);
  } finally {
    process.env.ORG_CONTEXT_APP_PRIVATE_KEY = key;
  }
});
