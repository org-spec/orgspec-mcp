import { escapeHtml } from "./markdown.js";

/**
 * How a client connects to one repository — shown on /setup right after
 * installing, and again on the repository's Connect page for anyone who
 * needs the configuration for another client later.
 */

/** The permanent MCP address on orgspec.org; elsewhere the endpoint lives at /mcp. */
export function mcpEndpoint(url: URL): string {
  return url.hostname.endsWith("orgspec.org") ? "https://mcp.orgspec.org" : `${url.origin}/mcp`;
}

/**
 * The server's name in the client: the kind first (so agents and hooks
 * recognise it), the repository last (so several contexts can coexist and
 * both agent and human see which organisation a tool belongs to).
 */
/** The organisation part of a repo name, for prose: "acme/org-context-acme" → "acme". */
export function orgLabel(repo: string): string {
  return serverName(repo).replace(/^org-context-/, "");
}

export function serverName(repo: string): string {
  const [owner, name] = repo.toLowerCase().split("/");
  // "acme/org-context" → org-context-acme; "acme/acme-org-context" → org-context-acme.
  const org = name.replace(/^org-context-?/, "").replace(/-?org-context$/, "").replace(/^context$/, "") || owner;
  return `org-context-${org}`;
}

export function claudeCommand(endpoint: string, repo: string, key: string): string {
  return (
    `claude mcp add --transport http ${serverName(repo)} ${endpoint} \\\n` +
    `  --header "Authorization: Bearer ${key}" \\\n` +
    `  --header "X-Org-Context-Repo: ${repo}"`
  );
}

/** The Connect section for one repository, as HTML. */
export function connectHtml(endpoint: string, repo: string, key: string): string {
  return (
    `<h3>Claude Code</h3><pre><code>${escapeHtml(claudeCommand(endpoint, repo, key))}</code></pre>` +
    `<h3>Claude Desktop, Cursor, VS Code, other MCP clients</h3>` +
    `<p>An HTTP MCP server named <code>${escapeHtml(serverName(repo))}</code> at <code>${escapeHtml(endpoint)}</code> with two headers:</p>` +
    `<pre><code>Authorization: Bearer ${escapeHtml(key)}\nX-Org-Context-Repo: ${escapeHtml(repo)}</code></pre>` +
    `<h3>ChatGPT</h3>` +
    `<p>Works on ChatGPT Plus, Pro, Team and Enterprise (the free plan cannot add custom connections). ` +
    `Every person connects once, with their own GitHub account — nothing to install for anyone else.</p>` +
    `<ol>` +
    `<li>In ChatGPT open <strong>Settings → Plugins → Plugin Management</strong> (called <em>Connectors</em> in older versions) ` +
    `and choose to <strong>create</strong> or <strong>add</strong> a custom one.</li>` +
    `<li><strong>Name</strong> it after the organisation, for example <em>${escapeHtml(orgLabel(repo))} context</em>. ` +
    `This is the name you and ChatGPT will see; it cannot be set from the server. The description is optional.</li>` +
    `<li><strong>MCP server URL:</strong> <code>${escapeHtml(endpoint)}</code>. <strong>Authentication:</strong> OAuth. ` +
    `Leave client ID and secret empty — the server registers itself.</li>` +
    `<li>ChatGPT warns that the connection is unverified and that you should only add ones you trust. That text is shown ` +
    `for everything outside its own catalogue. Confirm, then save.</li>` +
    `<li>A GitHub page opens: sign in, and on the next page choose <strong>${escapeHtml(repo)}</strong>. Connect.</li>` +
    `<li>In a chat, enable the plugin (the tools or “+” menu) and ask something the context answers — for instance what ` +
    `the organisation's goals are. ChatGPT reads through <em>Get context</em>, <em>Search</em> and <em>Fetch</em>; ` +
    `<em>Propose context change</em> is the only writing action, and it always asks you first.</li>` +
    `</ol>` +
    `<p class="note">Revoke any time: remove the plugin in ChatGPT, or uninstall the App on GitHub — that ends every connection at once.</p>` +
    `<h3>claude.ai, Gemini, Copilot</h3>` +
    `<p>Same idea: add <code>${escapeHtml(endpoint)}</code> as a custom connector with OAuth, sign in with GitHub, pick this repository.</p>` +
    `<p class="note">The key grants read and propose access to this repository to whoever holds it — treat it like a ` +
    `password. To revoke it, uninstall the App on GitHub.</p>`
  );
}
