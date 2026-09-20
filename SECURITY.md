# Security

## Reporting a vulnerability

Report privately through GitHub:
**[Report a vulnerability](https://github.com/org-spec/orgspec-mcp/security/advisories/new)**.
Please do not open a public issue for something exploitable.

You can expect an answer within a few days. A confirmed issue is fixed on
`main` first — the hosted service at orgspec.org deploys from there — then
released to npm as a patch version, with the advisory published and the
reporter credited unless they prefer otherwise.

## Supported versions

The latest release on npm, and `main`. The project is pre-1.0: fixes are not
backported to older minor versions.

## What the server handles

Worth knowing before you report, and before you deploy:

- **Stateless.** The server stores nothing: no tokens, no context, no
  accounts. Keys are HMACs it verifies on each request; OAuth state travels
  through the client as sealed, self-expiring blobs.
- **Tokens pass through.** In bring-your-own-repo mode the caller's GitHub
  token reaches the server on every request and is used for that request
  only. Use a fine-grained token limited to the context repository, or
  self-host.
- **Context passes through in plaintext** while a request is processed — the
  same trust model as any hosted tool that reads your documents.
- **Reads and writes are confined** to Markdown files inside the spec's
  structure. Workflows, tool configuration and agent instruction files are
  neither served nor writable through the tools.
- **Writes are proposals.** Against GitHub, every change is a pull request a
  person reviews.

Reports about any of these boundaries not holding are exactly what we want.

## Releases

npm versions are published from tagged commits through trusted publishing
with provenance, staged by CI and approved by a maintainer with 2FA. Check
any version with `npm audit signatures`.
