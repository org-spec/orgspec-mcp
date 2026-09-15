// Landing page behaviour. Kept in its own file so the Content Security Policy
// can allow same-origin scripts only (no inline script) — see netlify.toml.
(() => {
  const $ = (id) => document.getElementById(id);
  // The permanent address is mcp.orgspec.org (root, no path); any other host
  // (the .netlify.app URL, a self-hosted copy) serves the endpoint at /mcp.
  const endpoint = location.hostname.endsWith("orgspec.org")
    ? "https://mcp.orgspec.org"
    : `${location.origin}/mcp`;
  $("endpoint").textContent = endpoint;
  // Same rule as the server: "acme/org-context" → acme, "acme/acme-org-context" → acme.
  const serverSuffix = (repo) => {
    const [owner, name = ""] = repo.toLowerCase().split("/");
    return name.replace(/^org-context-?/, "").replace(/-?org-context$/, "").replace(/^context$/, "") || owner;
  };
  function render() {
    const repo = $("repo").value.trim() || "<owner/repo>";
    const token = $("token").value.trim() || "<your GitHub token>";
    const branch = $("branch").value.trim();
    const lines = [
      `claude mcp add --transport http org-context-${serverSuffix(repo)} ${endpoint} \\`,
      `  --header "Authorization: Bearer ${token}" \\`,
      `  --header "X-Org-Context-Repo: ${repo}"`,
    ];
    if (branch) lines.push(`  --header "X-Org-Context-Branch: ${branch}"`);
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].endsWith("\\")) lines[i] += " \\";
    }
    $("cmd").textContent = lines.join("\n");
  }
  for (const id of ["repo", "token", "branch"]) $(id).addEventListener("input", render);
  $("copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("cmd").textContent);
    $("copy").textContent = "Copied ✓";
    setTimeout(() => ($("copy").textContent = "Copy command"), 1500);
  });
  render();
  // Signed in already? Then the way in is "Your repositories", not "Sign in".
  fetch("/whoami", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me) return;
      $("nav").innerHTML = '<a href="/home">Your repositories</a> <a href="/logout">Sign out</a>';
      const who = me.user ? " as " + String(me.user).replace(/[^A-Za-z0-9._-]/g, "") : "";
      $("signed").innerHTML = `Signed in${who} · <a href="/home">Your repositories</a>`;
    })
    .catch(() => {});
})();
