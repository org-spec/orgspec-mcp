import { test } from "node:test";
import assert from "node:assert/strict";
import { audit, renderAudit } from "../src/audit.js";
import { bulletLeads, chain, chainCrumbs, decisionLine, effectGoals, overviewBody } from "../src/overview.js";

/**
 * The overview is derived, never configured: these fixtures pin what it reads
 * from a repository — titles, first lines, links, effect-goal tables — and
 * that missing organisation files show as gaps, not as nothing.
 */

const files = [
  { path: "README.md", content: "# Acme\n\n## Reading order\n\n1. [organisation/](organisation/)\n2. [teams/](teams/)\n3. [Value streams](products/)\n4. [system/](system/)\n5. [method/](method/)\n" },
  { path: "organisation/teams.md", content: "# Ownership map\n\nTeam → tracker → areas.\n" },
  {
    path: "products/shop/product.md",
    content:
      "# Shop\n\n| Property | Value |\n|---|---|\n| Owning team | [Web team](../../teams/web.md) |\n| Owner | TODO |\n\n## Vision\n\nBuy in under a minute.\n\n## Effect goals\n\n| Effect goal | Metric | Baseline | Target | Horizon |\n|---|---|---|---|---|\n| Faster checkout | time | 4 min | 1 min | T2 2027 |\n| Repeat buyers | share | att fastställa | +15 % | 2027 |\n",
  },
  { path: "teams/web.md", content: "# Web team\n\nThe storefront and checkout.\n\n## Owns\n\n- [Shop](../products/shop/product.md)\n- [Gateway](../system/gateway.md)\n" },
  { path: "teams/platform.md", content: "# Platform team\n\nShared platform.\n" },
  { path: "system/gateway.md", content: "# Gateway\n\n- Repo: x\n" },
  { path: "method/README.md", content: "# Method\n" },
  { path: "method/story-writing.md", content: "# Stories\n" },
  { path: "method/web/issue-convention.md", content: "# Issues, our way\n" },
];
const base = "/c/k";

test("chain: product → team and team → products/systems come from links", () => {
  const c = chain(files);
  assert.equal(c.products.length, 1);
  assert.equal(c.products[0].team?.path, "teams/web.md");
  assert.equal(c.products[0].vision, "Buy in under a minute.");
  const web = c.teams.find((t) => t.file.path === "teams/web.md")!;
  assert.deepEqual(web.products.map((p) => p.name), ["Shop"]);
  assert.equal(web.systems, 1);
  assert.equal(web.ownMethod, true, "method/web/ exists");
  assert.equal(c.teams.find((t) => t.file.path === "teams/platform.md")!.ownMethod, false);
  assert.equal(c.goals, undefined);
});

test("effectGoals counts rows and the ones without a value", () => {
  assert.deepEqual(effectGoals(files[2].content), { total: 2, incomplete: 1 });
  assert.deepEqual(effectGoals("# No table\n"), { total: 0, incomplete: 0 });
});

test("overview: gaps shown as gaps, the organisation's word for its areas, teams with what they own", () => {
  const html = overviewBody(files, base, audit(files));
  assert.match(html, /class="slot gap"><h3>Goals<\/h3>/, "missing goals is a gap slot");
  assert.match(html, /class="chain-start"/, "the chain-start message appears when goals are missing");
  assert.match(html, /<a href="\/c\/k\/f\/organisation\/teams\.md">Ownership map<\/a>/, "other organisation files are listed");
  assert.match(html, /<small>Value streams<\/small>/, "the README's word labels the What band");
  assert.match(html, /class="product" href="\/c\/k\/f\/products\/shop\/product\.md"><h3>Shop<\/h3>/);
  assert.match(html, /<span>Web team<\/span><span>·<\/span><span>2 effect goals <span class="dot"/);
  assert.match(html, /<b>Shop<\/b> · 1 system · own method/);
  assert.match(html, /<b>no product area<\/b>/, "a team without a product area says so");
  assert.match(html, /Systems: <a href="\/c\/k\/f\/system\/gateway\.md">Gateway<\/a>/, "no system README → the systems are listed");
  assert.match(html, /How content is created here — 1 method, 1 team override/);
  assert.ok(!html.includes("story-writing"), "method files are not on the overview");
});

test("decision line counts decision-type findings only", () => {
  const html = decisionLine(audit(files), base);
  assert.match(html, /<b>\d+ things wait for a decision<\/b>/);
  assert.match(html, /1 expected file missing/);
  assert.match(html, /1 owner says TODO/);
  assert.match(html, /1 effect-goal value to be established/);
  assert.equal(decisionLine([], base), "");
});

test("crumbs climb the chain", () => {
  assert.match(chainCrumbs(files, "products/shop/product.md", base), /Overview<\/a> › <span class="gap">Goals \(not yet\)<\/span> › <b>Shop<\/b> · owned by <a href="\/c\/k\/f\/teams\/web\.md">Web team<\/a>/);
  assert.match(chainCrumbs(files, "teams/web.md", base), /› <a href="\/c\/k\/f\/products\/shop\/product\.md">Shop<\/a> › <b>Web team<\/b>/);
  assert.match(chainCrumbs(files, "method/README.md", base), /Overview<\/a> › method\/README\.md/);
  const withGoals = [...files, { path: "organisation/goals.md", content: "# Goals\n\n## Grow\n" }];
  assert.match(chainCrumbs(withGoals, "products/shop/product.md", base), /<a href="\/c\/k\/f\/organisation\/goals\.md">Goals<\/a>/);
  assert.match(overviewBody(withGoals, base, []), /<li>Grow<\/li>/, "goals are listed by heading");
  assert.ok(!overviewBody(withGoals, base, []).includes("chain-start"));
});

test("audit report groups what is wrong before what is open", () => {
  const md = renderAudit(audit(files));
  const fixing = md.indexOf("## Needs fixing");
  const open = md.indexOf("## Open");
  assert.ok(fixing > -1 && open > fixing, md);
  assert.match(md.slice(fixing, open), /owner-todo/);
  assert.match(md.slice(open), /effect-goal-incomplete/);
});

test("overview: a list-shaped organisation file shows its first lines, not an empty slot", () => {
  const principles =
    "# Principles\n\n> Only the ones that changed a decision.\n\n- **One booking, one screen.** If a flow needs a second\n  screen, split the product.\n- Card data is never stored; payments go through the provider. Source: `ref: policy:X`.\n- Third\n- Fourth\n";
  assert.deepEqual(bulletLeads(principles), {
    leads: ["One booking, one screen", "Card data is never stored", "Third"],
    more: 1,
  });
  const html = overviewBody([...files, { path: "organisation/principles.md", content: principles }], base, []);
  assert.match(html, /<li>One booking, one screen<\/li>/);
  assert.match(html, /\+ 1 more/);
});
