# Contributing

Thanks for looking. This is the reference server for the
[Org Context Spec](https://github.com/org-spec/org-context-spec); it is small
on purpose, and the most useful contributions keep it that way.

## Where things go

- **A bug, or a client that does not connect** — open an issue here. The
  client, the transport (stdio, HTTP, hosted) and the version make it
  reproducible.
- **An idea for the server** — open an issue before writing code. It saves
  you the work if the answer is "that belongs in the spec" or "that is
  deliberately left out".
- **The layout, the file shapes, the writing rules** — that is the spec, not
  the server: [org-context-spec](https://github.com/org-spec/org-context-spec/issues).
- **A vulnerability** — not an issue. See [SECURITY.md](SECURITY.md).

## What the server will not grow into

Knowing these up front saves a pull request:

- **The tool surface stays small.** `get_context` and
  `propose_context_change`, plus `search` and `fetch` because ChatGPT requires
  them. New capabilities become arguments or derived views, not new tools.
- **Nothing is stored.** No database, no sessions, no accounts. If a feature
  needs state on the server, it does not belong in this repository.
- **The audit gives signals, never grades.** No score, nothing that blocks a
  merge, no syntax the spec does not already have.
- **The model recommends, a human decides.** Nothing writes to a shared
  repository without a person approving it.

## Working on the code

```sh
npm install
npm run build
npm test
```

Node 20 or later. The suite needs no network and no secrets, and it is the
deploy gate: a red test blocks the hosted service. A pull request should

- come with a test when it changes behaviour — above all in the paths the
  suite exists for: keys, sealed state, OAuth, path validation, the Markdown
  renderer, the security headers;
- add a line to [CHANGELOG.md](CHANGELOG.md) under *Unreleased* when someone
  running the server would notice the change;
- add no runtime dependency without saying why. There are two today.

Commit messages say what changed and why, in plain sentences. No prefix
convention is enforced.

## Licence

By contributing you agree that your contribution is licensed under the
[MIT licence](LICENSE) of this repository.
