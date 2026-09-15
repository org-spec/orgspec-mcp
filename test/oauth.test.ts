import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { renderOAuth, wwwAuthenticate } from "../src/oauth.js";
import { open, verifyKey } from "../src/app.js";
import { bodyOf, cfg, githubUser, installEnvConfig, stubFetch } from "./helpers.js";

installEnvConfig();

const APP = "https://app.example.test";
const MCP = "https://mcp.example.test";
const CLIENT_REDIRECT = "https://chat.example/oauth/callback";
const USER_TOKEN = "gho_user_token";
const INSTALLS = { "501": ["acme/org-context"], "502": ["beta/ctx", "beta/ctx-2"] };

const get = (url: string) => renderOAuth({ url: new URL(url), method: "GET", body: bodyOf("") });
const post = (url: string, body: string) => renderOAuth({ url: new URL(url), method: "POST", body: bodyOf(body) });
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

let restore: () => void = () => {};
beforeEach(() => {
  delete process.env.ORG_CONTEXT_APP_ORIGIN;
  restore = stubFetch(githubUser({ login: "alice", userToken: USER_TOKEN, installations: INSTALLS })).restore;
});
afterEach(() => restore());

test("discovery: protected-resource metadata points MCP host at the app host", async () => {
  const meta = JSON.parse((await get(`${MCP}/.well-known/oauth-protected-resource`))!.body);
  assert.deepEqual(meta, { resource: MCP, authorization_servers: [APP], bearer_methods_supported: ["header"] });
  assert.equal(wwwAuthenticate(new URL(`${MCP}/`)), `Bearer resource_metadata="${MCP}/.well-known/oauth-protected-resource"`);
});

test("discovery: ORG_CONTEXT_APP_ORIGIN overrides host derivation (L4)", async () => {
  process.env.ORG_CONTEXT_APP_ORIGIN = "https://app.orgspec.org";
  const meta = JSON.parse((await get("https://random.netlify.app/.well-known/oauth-authorization-server"))!.body);
  assert.equal(meta.issuer, "https://app.orgspec.org");
  assert.equal(meta.token_endpoint, "https://app.orgspec.org/oauth/token");
});

test("discovery: authorization server requires PKCE S256 and public clients only", async () => {
  const meta = JSON.parse((await get(`${APP}/.well-known/oauth-authorization-server`))!.body);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(meta.grant_types_supported, ["authorization_code"]);
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal((await get(`${APP}/.well-known/other`)), undefined, "unknown well-known paths fall through");
});

async function register(): Promise<string> {
  const res = await post(`${APP}/oauth/register`, JSON.stringify({ client_name: "Test", redirect_uris: [CLIENT_REDIRECT] }));
  assert.equal(res!.status, 201);
  return (JSON.parse(res!.body) as { client_id: string }).client_id;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

test("register: redirect_uris are required and the client_id is a sealed record of them", async () => {
  const bad = await post(`${APP}/oauth/register`, JSON.stringify({ client_name: "x" }));
  assert.equal(bad!.status, 400);
  const id = await register();
  assert.deepEqual(open<{ t: "client"; redirect_uris: string[] }>(cfg, id, "client")?.redirect_uris, [CLIENT_REDIRECT]);
});

test("authorize: unregistered redirect_uri, unknown client, missing PKCE are refused", async () => {
  const id = await register();
  const { challenge } = pkce();
  const base = `${APP}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(id)}`;
  assert.equal((await get(`${base}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&code_challenge=${challenge}&code_challenge_method=S256`))!.status, 400);
  assert.equal((await get(`${APP}/oauth/authorize?response_type=code&client_id=forged&redirect_uri=${encodeURIComponent(CLIENT_REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256`))!.status, 400);
  assert.equal((await get(`${base}&redirect_uri=${encodeURIComponent(CLIENT_REDIRECT)}`))!.status, 400, "no PKCE");
  assert.equal((await get(`${base}&redirect_uri=${encodeURIComponent(CLIENT_REDIRECT)}&code_challenge=${challenge}&code_challenge_method=plain`))!.status, 400, "plain PKCE");
});

test("full flow: authorize → GitHub → consent → code → PKCE token → per-repo oc2 key", async () => {
  const id = await register();
  const { verifier, challenge } = pkce();

  // 1. Client starts; we bounce to GitHub with a sealed flow as state.
  const auth = await get(
    `${APP}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(CLIENT_REDIRECT)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256&state=client-state-123`,
  );
  assert.equal(auth!.status, 302);
  const gh = new URL(auth!.headers!.Location);
  assert.equal(gh.origin + gh.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(gh.searchParams.get("client_id"), cfg.clientId);
  assert.equal(gh.searchParams.get("redirect_uri"), `${APP}/oauth/callback`);
  const state = gh.searchParams.get("state")!;

  // 2. GitHub sends the user back; the consent page lists only repos the USER can reach.
  const consent = await get(`${APP}/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`);
  assert.equal(consent!.status, 200);
  assert.ok(consent!.body.includes("acme/org-context") && consent!.body.includes("beta/ctx-2"));
  const grant = consent!.body.match(/name="grant" value="([^"]+)"/)![1];

  // 3. The user picks a repo; we redirect to the client with a code and the original state.
  const chosen = await post(`${APP}/oauth/consent`, form({ grant, choice: "502:beta/ctx-2" }));
  assert.equal(chosen!.status, 302);
  const back = new URL(chosen!.headers!.Location);
  assert.equal(back.origin + back.pathname, CLIENT_REDIRECT);
  assert.equal(back.searchParams.get("state"), "client-state-123");
  const code = back.searchParams.get("code")!;

  // 4. Wrong verifier fails; right verifier yields a key valid for exactly that repo.
  const wrong = await post(`${APP}/oauth/token`, form({ grant_type: "authorization_code", code, code_verifier: "not-it", redirect_uri: CLIENT_REDIRECT }));
  assert.equal(wrong!.status, 400);
  assert.equal(JSON.parse(wrong!.body).error, "invalid_grant");

  const ok = await post(`${APP}/oauth/token`, form({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CLIENT_REDIRECT, client_id: id }));
  assert.equal(ok!.status, 200);
  const { access_token, token_type } = JSON.parse(ok!.body) as { access_token: string; token_type: string };
  assert.equal(token_type, "bearer");
  assert.equal(verifyKey(cfg, access_token, "beta/ctx-2"), "502");
  assert.equal(verifyKey(cfg, access_token, "beta/ctx"), undefined, "sibling repo in the same installation is NOT covered");
  assert.equal(verifyKey(cfg, access_token, "acme/org-context"), undefined);
});

test("consent: a choice outside the user's grant is refused (no privilege escalation)", async () => {
  const id = await register();
  const { challenge } = pkce();
  const auth = await get(`${APP}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(CLIENT_REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256`);
  const state = new URL(auth!.headers!.Location).searchParams.get("state")!;
  const consent = await get(`${APP}/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`);
  const grant = consent!.body.match(/name="grant" value="([^"]+)"/)![1];
  for (const choice of ["501:beta/ctx", "999:acme/org-context", "502:acme/org-context", "", "502:"]) {
    assert.equal((await post(`${APP}/oauth/consent`, form({ grant, choice })))!.status, 400, choice);
  }
  // A grant forged without the key does not open at all.
  const forged = Buffer.from(JSON.stringify({ t: "grant", repos: { "1": ["x/y"] }, client_id: id, redirect_uri: CLIENT_REDIRECT, code_challenge: challenge })).toString("base64url");
  assert.equal((await post(`${APP}/oauth/consent`, form({ grant: `${forged}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, choice: "1:x/y" })))!.status, 400);
});

test("callback: tampered or foreign state is rejected before GitHub is called", async () => {
  const { calls } = stubFetch({});
  const res = await get(`${APP}/oauth/callback?code=good-code&state=forged.state`);
  assert.equal(res!.status, 400);
  assert.deepEqual(calls, [], "no GitHub call for a bad state");
});

test("token: codes are typed, so a session or grant blob cannot be exchanged", async () => {
  const notACode = (await import("../src/app.js")).seal(cfg, { t: "grant", installation: "501", repo: "acme/org-context", code_challenge: "x", client_id: "c", redirect_uri: CLIENT_REDIRECT });
  const res = await post(`${APP}/oauth/token`, form({ grant_type: "authorization_code", code: notACode, code_verifier: "x" }));
  assert.equal(res!.status, 400);
  const other = await post(`${APP}/oauth/token`, form({ grant_type: "client_credentials" }));
  assert.equal(other!.status, 400);
  assert.equal(JSON.parse(other!.body).error, "unsupported_grant_type");
});

test("no App configured: OAuth endpoints (but not discovery) answer 404", async () => {
  const saved = process.env.ORG_CONTEXT_APP_ID;
  delete process.env.ORG_CONTEXT_APP_ID;
  try {
    assert.equal((await post(`${APP}/oauth/register`, "{}"))!.status, 404);
    assert.equal((await get(`${APP}/.well-known/oauth-authorization-server`))!.status, 200);
  } finally {
    process.env.ORG_CONTEXT_APP_ID = saved;
  }
});
