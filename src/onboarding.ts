import { TEMPLATE } from "./template.js";

/**
 * Agent-driven onboarding: an empty or sparse context repository is a normal
 * state, not an error. The server hands the agent the spec's structure and
 * seeding instructions; the agent interviews the user and creates files
 * through propose_context_change — the repo is born through the same
 * review loop that later maintains it.
 */

const isPack = (p: string) => p.startsWith("method-packs/");

const coreList = () =>
  Object.keys(TEMPLATE)
    .filter((p) => !isPack(p))
    .map((p) => `- ${p}`)
    .join("\n");

const packList = () =>
  Object.keys(TEMPLATE)
    .filter((p) => isPack(p) && p !== "method-packs/README.md")
    .map((p) => `- ${p}`)
    .join("\n");

/** Returned by get_context when the repository has no context files yet. */
export function emptyRepoGuide(repoDescription: string): string {
  return `This context repository (${repoDescription}) is EMPTY — that is a normal starting point, not an error.

You are onboarding this organization to the Org Context Spec: versioned organizational context — goals, products or service areas, teams, ways of working — in a git repo, read by agents before they work, changed only through human-reviewed proposals. The spec fits any kind of organization, not only software: "products" can be service areas, and where a dev team maps an issue tracker, a services team maps the business systems the work lives in.

How to seed it:

1. Tell the user their context repo is empty and offer to set it up together, starting from what they know RIGHT NOW. Do not demand completeness — a team file alone, or a README and one product file, is a useful start.
2. Interview briefly. Good first questions: What does your organization do and deliver? For whom? WHERE does the work live — an issue tracker (Jira/Linear/…), or business systems (CRM, ATS, contract tools, spreadsheets)? What are you trying to achieve this year?
3. Read the spec's starter templates by calling get_context with any of these paths (they are served as templates while the file does not exist in the repo):
${coreList()}
4. Create files with propose_context_change: fill the templates with what the user told you, keep the structure. Bundle what belongs together into ONE proposal — e.g. README.md plus the first team file in a single call; one proposal per decision, never one per file. On an empty repository the first proposal is committed directly to seed it; every proposal after that becomes a pull request for review.
5. Method packs — optional, proven starter methods by kind of work. Offer the pack that matches what the organization does, read its files via get_context, and copy the relevant ones into the repo's method/ folder (the user owns them from then on). Available:
${packList()}
   Only offer what fits: story-writing guides help a software team, not a recruitment firm. Rules the user states about their systems (labels, required steps, follow-up rhythm) go in the team file's systems map, not in method/.
6. Be honest and spare: mark the unverified as unverified, leave unknowns as a short TODO, and describe what exists — never what is absent (no "instead of X", no "we have no X"). Fill the pattern that fits, omit the rest; the structure carries the absences. The context grows over time — that is the design.
7. The organization's methods are THEIRS. Never suggest contributing their ways of working to the public spec or its method packs — that only ever happens on the owner's explicit initiative.

The rule for everything you write here: the model recommends, a human decides.`;
}

export const CANONICAL_GAPS: [pattern: RegExp, hint: string][] = [
  [/^README\.md$/, "README.md — reading order and writing rules; agents start here (template: README.md)"],
  [/^organisation\//, "organisation/ — goals and principles everything traces to (template: organisation/goals.md)"],
  [/^organisation\/goals\.md$/, "organisation/goals.md — the goals that effect goals trace to; without it nothing traces anywhere (template: organisation/goals.md)"],
  [/^products\/[^/]+\/product\.md$/, "products/<area>/product.md — vision, effect goals, audience; for a services company these are the service areas (template: products/your-product/product.md)"],
  [/^teams\//, "teams/<team>.md — what the team delivers and where the work lives: tracker mapping or business-systems map (template: teams/your-team.md)"],
  [/^method\//, "method/ — how work is created and improved here; proven starter packs exist per kind of work (see method-packs/README.md via get_context)"],
];

/**
 * A short gaps section for a sparse repo, appended to get_context's overview.
 * Computed from the file list alone — cheap, no extra API calls.
 */
export function gapsSection(files: string[]): string {
  const missing = CANONICAL_GAPS.filter(([pattern]) => !files.some((f) => pattern.test(f))).map(
    ([, hint]) => hint,
  );
  if (missing.length === 0) return "";
  return (
    `\n\n---\n\nContext gaps (per the Org Context Spec — normal for a growing repo):\n` +
    missing.map((m) => `- ${m}`).join("\n") +
    `\n\nWhen a gap blocks or weakens the current task, tell the user and offer to fill it: ` +
    `read the template via get_context, fill it with what the user knows, propose via propose_context_change. ` +
    `Do not fill gaps unprompted or with invented content.`
  );
}

/** Template fallback for get_context(path) when the file is not in the repo. */
export function templateFallback(rel: string): string | undefined {
  // Method-pack paths are served as-is: they never live in the user's repo
  // under that name — the agent copies chosen files into method/.
  if (isPack(rel) && TEMPLATE[rel] !== undefined) {
    return (
      `NOTE: this is a starter METHOD PACK file from the Org Context Spec — optional, proven ` +
      `methods for one kind of work. If it fits this organization, copy it (adapted as needed) into ` +
      `the repo's method/ folder via propose_context_change; the organization owns it from then on.\n\n---\n\n` +
      TEMPLATE[rel]
    );
  }
  // Direct hit, else map concrete paths onto the template's placeholder paths.
  const candidate =
    TEMPLATE[rel] ??
    TEMPLATE[rel.replace(/^products\/[^/]+\//, "products/your-product/").replace(/actors\/[^/]+\.md$/, "actors/your-actor.md")] ??
    TEMPLATE[rel.replace(/^organisation\/actors\/[^/]+\.md$/, "products/your-product/actors/your-actor.md")] ??
    TEMPLATE[rel.replace(/^teams\/[^/]+\.md$/, "teams/your-team.md")] ??
    TEMPLATE[rel.replace(/^system\/[^/]+\.md$/, "system/your-system.md")] ??
    TEMPLATE[rel.replace(/^method\/([^/]+\.md)$/, "method-packs/software/$1")];
  if (candidate === undefined) return undefined;
  return (
    `NOTE: '${rel}' does not exist in the context repository yet. Below is the Org Context Spec ` +
    `STARTER TEMPLATE for it. To create the file: fill the template with what the user actually ` +
    `knows (interview them; mark the rest as TODO) and call propose_context_change.\n\n---\n\n` +
    candidate
  );
}
