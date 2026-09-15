// Netlify Function entry for OAuth discovery and endpoints — see src/oauth.ts.
// Needs ORG_CONTEXT_APP_* in the environment for everything but discovery.
import { renderOAuth } from "../../src/oauth.js";
import { securityHeaders } from "../../src/headers.js";

export default async (req: Request): Promise<Response> => {
  const page = await renderOAuth({ url: new URL(req.url), method: req.method, body: () => req.text() });
  if (!page) return new Response("Not found.", { status: 404 });
  return new Response(page.body, {
    status: page.status,
    headers: { "Content-Type": page.contentType, ...securityHeaders(page.contentType), ...page.headers },
  });
};

export const config = { path: ["/oauth/*", "/.well-known/*"] };
