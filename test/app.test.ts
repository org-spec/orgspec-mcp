import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { appJwt, isAppKey, issueKey, normalizePem, open, repoOfToken, seal, verifyKey } from "../src/app.js";
import { cfg, otherCfg } from "./helpers.js";

const REPO = "acme/org-context";
const INST = "4242";

test("issueKey/verifyKey: oc1 key is bound to installation and repo", () => {
  const key = issueKey(cfg, INST, REPO);
  assert.match(key, /^oc1\.4242\.[A-Za-z0-9_-]{32}$/);
  assert.equal(isAppKey(key), true);
  assert.equal(verifyKey(cfg, key, REPO), INST);
  assert.equal(verifyKey(cfg, key, "ACME/Org-Context"), INST, "repo compare is case-insensitive like GitHub");
  assert.equal(verifyKey(cfg, key, "acme/other"), undefined, "another repo");
  assert.equal(verifyKey(otherCfg, key, REPO), undefined, "another App's key material");
});

test("verifyKey: tampering and malformed input", () => {
  const key = issueKey(cfg, INST, REPO);
  const [p, i, m] = key.split(".");
  assert.equal(verifyKey(cfg, `${p}.${i}.${m.slice(0, -1)}${m.endsWith("x") ? "y" : "x"}`, REPO), undefined, "mac changed");
  assert.equal(verifyKey(cfg, `${p}.9999.${m}`, REPO), undefined, "installation changed");
  assert.equal(verifyKey(cfg, `${p}.abc.${m}`, REPO), undefined, "non-numeric installation");
  assert.equal(verifyKey(cfg, `${p}.${i}.`, REPO), undefined, "empty mac");
  assert.equal(verifyKey(cfg, "oc1", REPO), undefined);
  assert.equal(verifyKey(cfg, "", REPO), undefined);
  assert.equal(verifyKey(cfg, "ghp_notAnAppKey", REPO), undefined);
  assert.equal(isAppKey("ghp_x"), false);
});

test("oc2 token carries its repo and verifies only against it", () => {
  const token = issueKey(cfg, INST, REPO, true);
  assert.match(token, /^oc2\.4242\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{32}$/);
  assert.equal(repoOfToken(token), REPO);
  assert.equal(verifyKey(cfg, token, REPO), INST);
  assert.equal(verifyKey(cfg, token, "acme/other"), undefined, "header repo must match embedded repo");
  // Swapping the embedded repo without re-signing fails.
  const [p, i, , m] = token.split(".");
  const forged = `${p}.${i}.${Buffer.from("acme/other").toString("base64url")}.${m}`;
  assert.equal(verifyKey(cfg, forged, "acme/other"), undefined);
  // A non-repo payload is not even reported as a repo.
  assert.equal(repoOfToken(`oc2.1.${Buffer.from("../etc").toString("base64url")}.x`), undefined);
  assert.equal(repoOfToken("oc1.1.x"), undefined);
});

test("seal/open: round trip, type tag, expiry, tamper, key material", () => {
  const blob = seal(cfg, { t: "flow", a: 1, exp: Date.now() + 60_000 });
  assert.deepEqual(open<{ t: "flow"; a: number; exp: number }>(cfg, blob, "flow")?.a, 1);
  assert.equal(open(cfg, blob, "grant"), undefined, "wrong type");
  assert.equal(open(otherCfg, blob, "flow"), undefined, "other key");
  const [payload, mac] = blob.split(".");
  assert.equal(open(cfg, `${payload}x.${mac}`, "flow"), undefined, "payload changed");
  assert.equal(open(cfg, `${payload}.${mac.slice(1)}`, "flow"), undefined, "mac changed");
  assert.equal(open(cfg, payload, "flow"), undefined, "no mac");
  assert.equal(open(cfg, "", "flow"), undefined);
  const expired = seal(cfg, { t: "flow", exp: Date.now() - 1 });
  assert.equal(open(cfg, expired, "flow"), undefined, "expired");
  const forever = seal(cfg, { t: "flow" });
  assert.ok(open(cfg, forever, "flow"), "no exp means no expiry (by design)");
});

test("seal: a forged payload with a valid-looking mac does not open", () => {
  const fake = Buffer.from(JSON.stringify({ t: "session", repos: { "1": ["x/y"] } })).toString("base64url");
  assert.equal(open(cfg, `${fake}.${"A".repeat(32)}`, "session"), undefined);
});

test("normalizePem: accepts mangled PEMs, rejects non-PEMs", () => {
  const clean = cfg.privateKey;
  assert.equal(normalizePem(clean), clean);
  assert.equal(normalizePem(clean.replaceAll("\n", "\\n")), clean, "literal backslash-n");
  assert.equal(normalizePem(clean.replaceAll("\n", " ")), clean, "newlines to spaces");
  assert.equal(normalizePem(clean.replaceAll("\n", "")), clean, "newlines stripped");
  assert.throws(() => normalizePem("SHA256:abcdef"), /not a PEM/);
  assert.throws(() => normalizePem(""), /not a PEM/);
});

test("appJwt: RS256, issued by the App, short-lived, verifiable with the public key", () => {
  const jwt = appJwt(cfg);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as { iss: string; iat: number; exp: number };
  assert.equal(payload.iss, cfg.appId);
  assert.ok(payload.exp - payload.iat <= 600, "GitHub caps App JWTs at 10 minutes");
  const pub = createPublicKey(cfg.privateKey);
  assert.equal(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), pub, Buffer.from(s, "base64url")), true);
  assert.equal(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey(otherCfg.privateKey), Buffer.from(s, "base64url")), false);
});
