#!/bin/sh
# Packs the package and installs the tarball into a scratch prefix — the exact
# bytes a user gets from npm — then runs both binaries. Used by CI and by
# `npm run pack:smoke` locally. Exits non-zero on the first failure.
set -eu
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

tgz=$(npm pack --silent --pack-destination "$work")
echo "packed: $tgz"
tar -tzf "$work/$tgz" | sed 's|^package/||' | grep -q '^dist/http.js$' || { echo "dist/http.js missing from tarball"; exit 1; }
tar -tzf "$work/$tgz" | grep -q -E '^package/(src|test|netlify|public)/' && { echo "source files leaked into tarball"; exit 1; }

npm install --silent --no-audit --no-fund --prefix "$work/install" "$work/$tgz"
bin="$work/install/node_modules/.bin"

# stdio binary: the audit subcommand runs over a folder and always exits 0.
ctx="$work/ctx"; mkdir -p "$ctx"; printf '# Org context — smoke\n' > "$ctx/README.md"
"$bin/orgspec" audit "$ctx" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!Array.isArray(r.findings))process.exit(1);console.log("audit ok:",r.findings.length,"findings")})'

# HTTP binary: must fail closed (a default repo without MCP_ACCESS_KEY is refused).
if ORG_CONTEXT_PATH="$ctx" "$bin/orgspec" serve >/dev/null 2>&1; then
  echo "orgspec serve started without MCP_ACCESS_KEY — should have refused"; exit 1
fi
echo "http fail-closed ok"
echo "smoke ok"
