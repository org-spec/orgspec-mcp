import { test } from "node:test";
import assert from "node:assert/strict";
import { issueKey } from "../src/app.js";
import { tenantFromHeaders } from "../src/tenant.js";
import { cfg, installEnvConfig, otherCfg } from "./helpers.js";

installEnvConfig();

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()];

test("tenantFromHeaders: no repo header and no oc2 token → single-tenant mode", () => {
  assert.equal(tenantFromHeaders(headers({})), undefined);
  assert.equal(tenantFromHeaders(headers({ authorization: "Bearer ghp_x" })), undefined);
});

test("tenantFromHeaders: fine-grained token + repo header", () => {
  const t = tenantFromHeaders(headers({ authorization: "Bearer ghp_abc", "x-org-context-repo": "acme/ctx", "x-org-context-branch": "main" }));
  assert.deepEqual(t, { repo: "acme/ctx", token: "ghp_abc", branch: "main", writeMode: "propose" });
});

test("tenantFromHeaders: writes are always proposals in BYO mode", () => {
  const t = tenantFromHeaders(headers({ authorization: "Bearer ghp_abc", "x-org-context-repo": "acme/ctx" }));
  assert.equal(t?.writeMode, "propose");
});

test("tenantFromHeaders: malformed repo names are refused before any network call", () => {
  for (const bad of ["acme", "../x", "a/b/c", "acme/ctx?x", "acme/ctx/../other"]) {
    assert.throws(() => tenantFromHeaders(headers({ authorization: "Bearer ghp_x", "x-org-context-repo": bad })), /owner\/repo/, bad);
  }
});

test("tenantFromHeaders: repo without bearer is an error, not open access", () => {
  assert.throws(() => tenantFromHeaders(headers({ "x-org-context-repo": "acme/ctx" })), /requires your GitHub token/);
  assert.throws(() => tenantFromHeaders(headers({ authorization: "Basic xyz", "x-org-context-repo": "acme/ctx" })), /requires/);
});

test("tenantFromHeaders: App key (oc1) is verified against the repo header", () => {
  const key = issueKey(cfg, "77", "acme/ctx");
  const t = tenantFromHeaders(headers({ authorization: `Bearer ${key}`, "x-org-context-repo": "acme/ctx" }));
  assert.equal(t?.installationId, "77");
  assert.throws(
    () => tenantFromHeaders(headers({ authorization: `Bearer ${key}`, "x-org-context-repo": "acme/other" })),
    /not valid for this repository/,
  );
  const foreign = issueKey(otherCfg, "77", "acme/ctx");
  assert.throws(() => tenantFromHeaders(headers({ authorization: `Bearer ${foreign}`, "x-org-context-repo": "acme/ctx" })), /not valid/);
});

test("tenantFromHeaders: OAuth token (oc2) needs no repo header", () => {
  const token = issueKey(cfg, "77", "acme/ctx", true);
  const t = tenantFromHeaders(headers({ authorization: `Bearer ${token}` }));
  assert.equal(t?.repo, "acme/ctx");
  assert.equal(t?.installationId, "77");
  // An explicit header that disagrees with the token is refused.
  assert.throws(() => tenantFromHeaders(headers({ authorization: `Bearer ${token}`, "x-org-context-repo": "acme/other" })), /not valid/);
});

test("tenantFromHeaders: App keys are refused when no App is configured", () => {
  const saved = process.env.ORG_CONTEXT_APP_ID;
  delete process.env.ORG_CONTEXT_APP_ID;
  try {
    const key = issueKey(cfg, "77", "acme/ctx");
    assert.throws(() => tenantFromHeaders(headers({ authorization: `Bearer ${key}`, "x-org-context-repo": "acme/ctx" })), /no GitHub App/);
  } finally {
    process.env.ORG_CONTEXT_APP_ID = saved;
  }
});
