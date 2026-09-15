# Changelog

Semantic versioning from 0.3.0 on: a **minor** bump when the tool surface,
environment variables, CLI flags or the served template change in a way a
self-hosted installation must read about; a **patch** bump otherwise. The
hosted service at mcp.orgspec.org follows `main`; the npm package follows the
`v*` tags.

## 0.3.0 — unreleased

First version published to npm.

- Package renamed `org-context-mcp` → `orgspec-mcp`; binaries `orgspec-mcp`
  (stdio) and `orgspec-mcp-http` (streamable HTTP server for self-hosting).
- GitHub App onboarding (`/setup`, `oc1.` keys) and MCP OAuth for ChatGPT,
  claude.ai and other OAuth-capable clients (`oc2.` tokens, `search`/`fetch`).
- Portal and per-repository web view with Mermaid rendering; audit (top
  findings in `get_context`, `audit` CLI subcommand, `/audit` page).
- Security: reads and writes confined to the spec's structure, strict
  repository names, fail-closed HTTP entry, security headers, pinned Mermaid
  with SRI; test suite is the deploy gate.

## 0.2.0 — 2026-08-14

- `ContextSource` interface with a GitHub REST backend (`--github owner/repo`,
  propose mode opens pull requests) beside the local folder backend.
- Streamable HTTP transport with bearer-key auth; Netlify function entry.
- Bring-your-own-repo multi-tenant mode: `X-Org-Context-Repo` + the caller's
  own GitHub token, nothing stored server-side.
