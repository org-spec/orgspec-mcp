# Changelog

Semantic versioning from 0.3.0 on: a **minor** bump when the tool surface,
environment variables, CLI flags or the served template change in a way a
self-hosted installation must read about; a **patch** bump otherwise. The
hosted service at mcp.orgspec.org follows `main`; the npm package follows the
`v*` tags.

## 0.4.0 — unreleased

- Web view: the overview is now the organisation as a chain, top to bottom —
  **why** (constraints, goals, principles, ways of working, shown as gaps when
  missing), **what** (one entry per product area with vision, owning team and
  effect-goal count; the README's own word for the areas labels the band),
  **who · where** (teams with what they own, the system map and the method as
  one line each). Derived from titles, first lines and links — nothing to
  configure. A line above the bands says what waits for a decision. File pages
  get breadcrumbs that climb the chain (product → team, team → products).
- Audit report grouped into "Needs fixing" and "Open" — the same rules, read
  differently: what is wrong, and what the authors marked as open themselves.

## 0.3.1 — 2026-09-16

- Security: `orgspec serve` in open mode (a default repo without
  `MCP_ACCESS_KEY`) now binds to `127.0.0.1` only. It used to listen on every
  interface, exposing an unauthenticated endpoint to the LAN while the log
  said `localhost`. Keyed and bring-your-own-repo servers still bind to every
  interface; new `ORG_CONTEXT_HOST` overrides the bind address in either mode.
  The log now states the real address. Reported from a self-hosting pilot.
- Dropped the unused `esbuild` devDependency (its install script tripped npm's
  install-time controls in CI).

## 0.3.0 — 2026-09-15

First version published to npm.

- Package renamed `org-context-mcp` → `orgspec` (replaces the 0.0.1 name
  reservation). One binary, `orgspec`: MCP over stdio by default,
  `orgspec serve` for the streamable HTTP server (self-hosting),
  `orgspec audit <dir>` for the report.
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
