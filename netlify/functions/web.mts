// Netlify Function entry for the read-only web view — serves /c/<key>/… as
// rendered pages of the DEFAULT repo (the humans' window into the context).
//
// Enable by setting, in the Netlify environment:
//   ORG_CONTEXT_GITHUB        owner/repo to render
//   ORG_CONTEXT_GITHUB_TOKEN  fine-grained token with Contents (read) on it
//   ORG_CONTEXT_WEB_KEY       the capability-link key — /c/<key>/ is the URL
//   ORG_CONTEXT_WEB_CONTACT   optional email for the "Suggest a change" link
//
// Without ORG_CONTEXT_WEB_KEY the view stays off. The view is read-only and
// single-tenant by design: BYO-repo tenants are not served here, since a
// capability URL cannot carry a GitHub token safely.
import { renderWeb } from "../../src/web.js";
import { GitHubSource } from "../../src/github.js";
import { securityHeaders } from "../../src/headers.js";

// Module scope: read caches survive while the function instance is warm.
let envSource: GitHubSource | undefined;

function getEnvSource(): GitHubSource | undefined {
  if (!envSource) {
    const repo = process.env.ORG_CONTEXT_GITHUB ?? "";
    const token = process.env.ORG_CONTEXT_GITHUB_TOKEN ?? "";
    if (!repo || !token) return undefined;
    envSource = new GitHubSource(repo, token, process.env.ORG_CONTEXT_BRANCH);
  }
  return envSource;
}

export default async (req: Request): Promise<Response> => {
  const cfg = process.env.ORG_CONTEXT_WEB_KEY
    ? { key: process.env.ORG_CONTEXT_WEB_KEY, contact: process.env.ORG_CONTEXT_WEB_CONTACT }
    : undefined;
  const page = await renderWeb(new URL(req.url).pathname, req.method, getEnvSource(), cfg);
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

export const config = { path: "/c/*" };
