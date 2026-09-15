# orgspec-mcp

Reference MCP server for the [Org Context Spec](https://github.com/org-spec/org-context-spec)
v0.1. Serves an `org-context/` repository to any MCP-capable AI agent, and lets
agents propose changes that a human approves.

**Status: v0.3, in pilot use.** Two storage backends: a local folder, or a
GitHub repository reached through the REST API (no local clone, no git binary —
in propose mode every change becomes a pull request). Two transports: stdio
(local) and streamable HTTP (one Node process to self-host, or Netlify). An
Azure DevOps backend is planned.

## Tools

Two tools — read and propose:

| Tool | Purpose |
|---|---|
| `get_context` | The context README (reading order, writing rules) + file list + gaps, or any single file; empty repos get onboarding instructions, missing files their starter template |
| `propose_context_change` | One coherent change — one or several files, one commit, one pull request for review |
| `search`, `fetch` | Compatibility views over the same files, in the shape ChatGPT connectors require |

## Audit

Reproducible checks that point at what the context does not say yet: files
the reading order does not reach, template placeholders never replaced, TODO
items, owners left as TODO, effect goals without baseline, target or horizon,
horizons that have passed with no outcome recorded, statements the authors
themselves marked as unverified, and questions waiting for a decision. It reads
only conventions the spec already has — no new syntax.

Findings are signals, never grades: no score, nothing blocks a merge. Same
files in, same findings out, wherever it runs:

- `get_context` without arguments appends the top findings, so an agent can
  raise the ones that matter to its task (and propose a fix through the
  normal review loop — never fill gaps unprompted).
- `npx orgspec-mcp audit [dir] [--json]` prints the full report for a
  local folder — for the terminal or a CI step. Exit code is always 0.
- The web view has an **Audit** page per repository.

## Usage

Local folder (a git clone — commits stay local):

```sh
npx orgspec-mcp --context /path/to/org-context
```

GitHub repository (reads and writes via the REST API — nothing to install or
clone, works for teammates without git):

```sh
GITHUB_TOKEN=ghp_... npx orgspec-mcp --github owner/repo --write-mode propose
```

Options:

- `--context <path>` (or `ORG_CONTEXT_PATH`) — local context repository root. Default: current directory.
- `--github <owner/repo>` (or `ORG_CONTEXT_GITHUB`) — serve a GitHub repository
  instead of a local folder. Requires a token in `ORG_CONTEXT_GITHUB_TOKEN` or
  `GITHUB_TOKEN` with contents (and, for propose mode, pull request) permission
  on that repository.
- `--branch <name>` (or `ORG_CONTEXT_BRANCH`) — branch to serve in GitHub mode.
  Default: the repository's default branch.
- `--write-mode direct|propose` (or `ORG_CONTEXT_WRITE_MODE`) — `direct`
  commits approved changes on the current/default branch; `propose` puts each
  change on a new `context/...` branch — in GitHub mode it also opens a pull
  request for human review. Default: `direct` for a local folder (your own
  clone), `propose` for a GitHub repository (shared — a person reviews).

What the server reads and writes: markdown files (`.md`) outside hidden paths,
and proposals only inside the spec's structure — `README.md`, `organisation/`,
`products/`, `teams/`, `method/`, `system/`. Other repository files (tool
configuration, workflows, agent instruction files) are neither served nor
writable through the tools.

Client configuration (Claude Desktop, Claude Code, VS Code, Cursor, …):

```json
{
  "mcpServers": {
    "org-context": {
      "command": "npx",
      "args": ["-y", "orgspec-mcp", "--context", "/path/to/org-context"]
    }
  }
}
```

## Hosted mode (HTTP)

For teams that accept context passing through a hosted server (the same trust
model as Jira Cloud or Notion). The server reads and writes the context repo
via the GitHub API. Two ways to connect:

### GitHub App (recommended)

Instead of pasting a token, the user installs a GitHub App on the context repo
and gets a ready command from `/setup` (and again, any time, from the
repository's Connect page when signed in). The server is named after the
repository, `org-context-<repo>`, so several contexts can sit side by side and
both agent and human see which organisation a tool belongs to. The server issues a key per repo
(`oc1.<installation>.<mac>`, an HMAC the server verifies statelessly) and
resolves it to a short-lived installation token on each request — nothing is
stored. Revoke by uninstalling the App; rotate the private key to invalidate
every key at once.

Register the App once (GitHub → Settings → Developer settings → GitHub Apps):

- **Callback URL:** `https://<your host>/setup`, and tick **Request user
  authorization (OAuth) during installation** — that is how `/setup` knows who
  installed. Also tick **Redirect on update** so reconfiguring lands there too.
- **Repository permissions:** Contents *read and write*, Pull requests *read and
  write*. No webhook needed (untick *Active*).
- **Where can this App be installed:** any account.
- Generate a **private key** and note the **App ID**, **Client ID**, and a
  **client secret**.

Then set on the server: `ORG_CONTEXT_APP_ID`, `ORG_CONTEXT_APP_PRIVATE_KEY`
(the PEM; a single line with literal `\n` is accepted), `ORG_CONTEXT_APP_CLIENT_ID`,
`ORG_CONTEXT_APP_CLIENT_SECRET`. Without them the App path is simply off and
`/setup` answers 404.

### ChatGPT, claude.ai, Gemini, Copilot — OAuth

Clients that cannot send custom headers use standard MCP authorization
(OAuth 2.1 with PKCE, dynamic client registration, RFC 9728 discovery). Add
the MCP URL as a connector; the client discovers `/.well-known/oauth-protected-resource`
on the MCP host, sends the user to sign in with GitHub via the App, and a
consent page asks which installed context repo to expose. The token it
receives is the same per-repo key with the repo embedded (`oc2.…`) — still
stateless, nothing stored. Registered clients, pending sign-ins and
authorization codes are all sealed, self-expiring blobs that travel through
the client.

Requires the GitHub App above plus a second callback URL on it:
`https://<app host>/oauth/callback`. The MCP host and the app host must be
siblings (`mcp.` / `app.`), or set `ORG_CONTEXT_APP_ORIGIN` explicitly.

ChatGPT's connectors also require tools named `search` and `fetch`; the server
exposes both as thin views over the same files.

### Bring your own repo (multi-tenant, stateless)

Any client can point a running server at its own context repo — the MCP
configuration is the whole onboarding. The client sends its repo and its own
GitHub token in headers; the token doubles as the access key, and the server
stores nothing:

```sh
claude mcp add --transport http org-context https://<site>/mcp \
  --header "Authorization: Bearer <fine-grained GitHub token>" \
  --header "X-Org-Context-Repo: owner/org-context"
```

Optional header: `X-Org-Context-Branch: <branch>` (default: the repo's
default branch). Writes are always proposals — every change becomes a pull
request for human review.

The token: a fine-grained token with **Repository access: only the context
repo** (so the blast radius is that repo alone) and repository permissions
**Contents: read and write** plus **Pull requests: read and write**. Both are
needed — with Contents alone, a proposal is committed to a branch but the
pull request fails with 403. The token passes through the server on every request but is
never stored or logged; if that trust model does not fit, self-host — see
below.

### Default repo (single-tenant)

Requests without `X-Org-Context-Repo` are served from a repo configured on
the server, gated by a shared access key.

Run anywhere with Node:

```sh
ORG_CONTEXT_GITHUB=owner/repo ORG_CONTEXT_GITHUB_TOKEN=github_pat_... \
MCP_ACCESS_KEY=some-long-random-string npm run start:http
```

With a default repo configured the server refuses to start without
`MCP_ACCESS_KEY`; set `ORG_CONTEXT_ALLOW_OPEN=1` to run it open on a local
machine.

Deploy to Netlify (git-linked — every push deploys):

1. Push this repository to GitHub and link it to a Netlify site
   (Site configuration → Build & deploy → Link repository). `netlify.toml`
   holds the build settings; Netlify bundles `netlify/functions/mcp.mts`
   itself.
2. Bring-your-own-repo mode works with no configuration at all. To also serve
   a default repo, add environment variables `ORG_CONTEXT_GITHUB`,
   `ORG_CONTEXT_GITHUB_TOKEN` (a fine-grained token limited to the context
   repo: contents + pull requests, read/write) and `MCP_ACCESS_KEY` (any long
   random string) — then trigger a redeploy so they take effect.

Connect from Claude Code:

```sh
claude mcp add --transport http org-context https://mcp.orgspec.org \
  --header "Authorization: Bearer <access key>"
# self-hosted copies serve the endpoint at https://<site>.netlify.app/mcp
```

Notes: the server is stateless (works on serverless); writes default to
propose mode — every change becomes a pull request in the context repo. All
context passes through the host in plaintext during processing; use a
fine-grained token so the blast radius is the context repo alone.

## The write rule

`propose_context_change` embeds the spec's writing rule: **the model
recommends, a human decides.** The tool instructs agents to show the exact
change and get explicit approval before calling. In a git repository every
approved change becomes a commit — reviewable, diffable, revertable.

## Self-hosting with the package

The npm package is the same code the hosted service runs. `orgspec-mcp-http`
starts the HTTP server (MCP endpoint, web view, `/setup` and OAuth when a
GitHub App is configured) as one Node process:

```sh
MCP_ACCESS_KEY=<long random string> ORG_CONTEXT_GITHUB=owner/repo \
  ORG_CONTEXT_GITHUB_TOKEN=github_pat_... npx orgspec-mcp-http
```

The process stores nothing and needs no outbound access beyond the GitHub
API. Environment variables are listed at the top of `src/http.ts`.

### The two keys

Both keys are values **you invent** — long random strings, generated for
example with `openssl rand -base64 24 | tr -d '/+='`. Nothing is fetched or
registered anywhere.

- `MCP_ACCESS_KEY` admits MCP clients on `/mcp` (sent as the Bearer key).
- `ORG_CONTEXT_WEB_KEY` turns on the read-only web view at `/c/<that key>/`
  — a capability link: whoever has the link can read, nobody else. Without
  the variable there is no web view at all.

Share the link where the audience already is (intranet, team channel). To
revoke, restart with a new value; the old link stops working immediately.
On an internal network the link is reachable only from inside, which is a
second lock on top of the key.

### On your own machine, from a local clone

The zero-configuration path — no token, no App, no proxy exception, and it
works the same against GitHub.com, GitHub Enterprise Server or any other git
host, because the server never talks to an API. Use it for a personal setup
or a first pilot inside an organisation:

```sh
git clone <the context repository> ~/org-context
claude mcp add org-context -s user -- npx -y orgspec-mcp --context ~/org-context
```

Other MCP clients get the same stdio command. Approved changes become
commits in the clone (`--write-mode propose` puts them on a `context/...`
branch instead); push and open pull requests with git as usual.

The web view over the same clone, visible only to you:

```sh
ORG_CONTEXT_PATH=~/org-context ORG_CONTEXT_ALLOW_OPEN=1 \
  ORG_CONTEXT_WEB_KEY=<key> PORT=3456 npx orgspec-mcp-http
# → http://localhost:3456/c/<key>/  (audit at /c/<key>/audit)
```

`ORG_CONTEXT_ALLOW_OPEN=1` skips the MCP access key, which is fine on
localhost and nowhere else. Switch to `ORG_CONTEXT_GITHUB` + a fine-grained
token when several people should reach one server without a clone, or when
proposals should open pull requests by themselves.

## Development

```sh
npm install
npm run build   # tsc → dist/
npm test        # type-checks src/ + test/, runs the suite (node:test, no extra deps)
```

The suite needs no network and no secrets: it generates its own App key
material and stubs GitHub. It covers the security-critical paths — key
issuing and verification, sealed state, the OAuth/PKCE flow, the /setup
authorisation, path validation, the Markdown renderer, the security
headers — and runs the Node server black-box. `npm test` is also Netlify's
build command, so a red test blocks the deploy; `.github/workflows/ci.yml`
runs the same on pull requests.

Before a release, `npm run pack:smoke` packs the tarball, installs it into a
scratch prefix and runs both binaries — what CI does in the `pack` job. To try
the unpublished package in a client, point it at the tarball:

```sh
npm pack                                  # → orgspec-mcp-<version>.tgz
npx --yes --package ./orgspec-mcp-<version>.tgz orgspec-mcp --context /path/to/org-context
```

## Releases

The hosted service follows `main`; the npm package follows `v*` tags, see
[CHANGELOG.md](CHANGELOG.md). `npm version minor|patch` bumps, commits and
tags; `git push --follow-tags` lets `.github/workflows/release.yml` publish
through npm trusted publishing (no token secret).

## License

MIT
