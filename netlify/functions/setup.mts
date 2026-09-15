// Netlify Function entry for GET /setup — the GitHub App's post-install page.
// Needs ORG_CONTEXT_APP_* in the Netlify environment; see src/app.ts.
import { renderSetup } from "../../src/setup.js";
import { securityHeaders } from "../../src/headers.js";

export default async (req: Request): Promise<Response> => {
  const page = await renderSetup(new URL(req.url), req.method);
  if (!page) return new Response("Not found.", { status: 404 });
  return new Response(page.body, {
    status: page.status,
    headers: {
      "Content-Type": page.contentType,
      "Cache-Control": "no-store",
      ...securityHeaders(page.contentType),
      ...page.headers,
    },
  });
};

export const config = { path: "/setup" };
