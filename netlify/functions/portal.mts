// Netlify Function entry for the signed-in side: /login, /logout, /home, /o/* — see src/portal.ts.
import { renderPortal } from "../../src/portal.js";
import { securityHeaders } from "../../src/headers.js";

export default async (req: Request): Promise<Response> => {
  const page = await renderPortal({ url: new URL(req.url), method: req.method, cookie: req.headers.get("cookie") });
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

export const config = { path: ["/login", "/logout", "/home", "/whoami", "/o/*"] };
