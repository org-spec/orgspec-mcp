import { generateKeyPairSync } from "node:crypto";
import type { AppConfig } from "../src/app.js";

/**
 * Shared fixtures. Tests run against a throwaway RSA key generated at load —
 * never a real App key — and a fetch stub in place of GitHub, so the suite
 * needs no network and no secrets.
 */

function freshKey(): string {
  return generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
}

/** A complete App configuration with its own key material. */
export function testConfig(): AppConfig {
  return { appId: "12345", privateKey: freshKey(), clientId: "Iv1.testclient", clientSecret: "test-client-secret" };
}

/** The config the module-level `appConfig()` reads from the environment. */
export const cfg: AppConfig = testConfig();

/** A second config with different key material — anything sealed with `cfg` must fail here. */
export const otherCfg: AppConfig = testConfig();

/** Put `cfg` in the environment so code paths that call appConfig() see it. */
export function installEnvConfig(): void {
  process.env.ORG_CONTEXT_APP_ID = cfg.appId;
  process.env.ORG_CONTEXT_APP_PRIVATE_KEY = cfg.privateKey;
  process.env.ORG_CONTEXT_APP_CLIENT_ID = cfg.clientId;
  process.env.ORG_CONTEXT_APP_CLIENT_SECRET = cfg.clientSecret;
}

export type Route = (req: { method: string; url: URL; headers: Headers; body: string }) => unknown;

/**
 * Replace global fetch with a table of routes keyed by "METHOD host/path".
 * The handler's return value is sent as JSON (or a Response is passed through).
 * Unknown routes fail the test loudly. Returns a restore function.
 */
export function stubFetch(routes: Record<string, Route>): { calls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.host}${url.pathname}`;
    calls.push(key);
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch in test: ${key}`);
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const body = typeof init?.body === "string" ? init.body : "";
    const out = await route({ method, url, headers, body });
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

/** GitHub as seen by a signed-in user: token → installations → repositories. */
export function githubUser(opts: {
  login: string;
  userToken: string;
  installations: Record<string, string[]>;
}): Record<string, Route> {
  const authed = (headers: Headers) => headers.get("authorization") === `Bearer ${opts.userToken}`;
  const routes: Record<string, Route> = {
    "POST github.com/login/oauth/access_token": ({ body }) => {
      const { code } = JSON.parse(body) as { code: string };
      return code === "good-code" ? { access_token: opts.userToken } : { error_description: "bad code" };
    },
    "GET api.github.com/user": ({ headers }) =>
      authed(headers) ? { login: opts.login } : new Response("{}", { status: 401 }),
    "GET api.github.com/user/installations": ({ headers }) =>
      authed(headers)
        ? { installations: Object.keys(opts.installations).map((id) => ({ id: Number(id) })) }
        : new Response("{}", { status: 401 }),
  };
  for (const [id, repos] of Object.entries(opts.installations)) {
    routes[`GET api.github.com/user/installations/${id}/repositories`] = () => ({
      repositories: repos.map((full_name) => ({ full_name })),
    });
  }
  return routes;
}

/** Body reader for renderOAuth requests. */
export const bodyOf = (s: string) => () => Promise.resolve(s);
