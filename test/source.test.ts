import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_DIRS,
  isRepoName,
  proposalBranchName,
  validateContextFile,
  validateRel,
  validateWritable,
} from "../src/source.js";

test("validateRel: refuses paths that escape the repository", () => {
  for (const bad of ["", "/etc/passwd", "C:\\Windows", "../x.md", "a/../../x.md", "a\\..\\x.md"]) {
    assert.throws(() => validateRel(bad), /escapes/, bad);
  }
});

test("validateRel: normalises backslashes and keeps ordinary paths", () => {
  assert.equal(validateRel("teams/a.md"), "teams/a.md");
  assert.equal(validateRel("teams\\a.md"), "teams/a.md");
  assert.equal(validateRel("a/./b.md"), "a/./b.md");
});

test("validateContextFile: only markdown, no hidden segments", () => {
  assert.equal(validateContextFile("README.md"), "README.md");
  assert.equal(validateContextFile("organisation/goals.md"), "organisation/goals.md");
  assert.throws(() => validateContextFile(".env"), /Not a context file/);
  assert.throws(() => validateContextFile("package.json"), /only \.md/);
  assert.throws(() => validateContextFile(".github/workflows/deploy.md"), /hidden/);
  assert.throws(() => validateContextFile("teams/.secret.md"), /hidden/);
  assert.throws(() => validateContextFile("../README.md"), /escapes/);
});

test("validateWritable: README.md and the spec's directories only", () => {
  assert.equal(validateWritable("README.md"), "README.md");
  for (const dir of CONTEXT_DIRS) assert.equal(validateWritable(`${dir}/x.md`), `${dir}/x.md`);
  assert.equal(validateWritable("teams/platform/nested.md"), "teams/platform/nested.md");
  // Agent-instruction files and anything outside the structure are refused.
  for (const bad of ["AGENTS.md", "CLAUDE.md", "docs/x.md", ".github/copilot-instructions.md", "readme.md", "organisation.md"]) {
    assert.throws(() => validateWritable(bad), Error, bad);
  }
});

test("isRepoName: GitHub owner/repo, no dot segments, nothing else", () => {
  for (const ok of ["acme/org-context", "Acme-Inc/ctx_2.0", "a/b", "org.name/repo.name"]) assert.equal(isRepoName(ok), true, ok);
  for (const bad of ["acme", "acme/", "/repo", "a/b/c", "../x", "./x", "a/..", "a/b?x=1", "a/b c", "a/b%2F", "a/b\n"]) {
    assert.equal(isRepoName(bad), false, JSON.stringify(bad));
  }
});

test("proposalBranchName: namespaced, slugged, bounded", () => {
  const name = proposalBranchName("Add Platform Team: goals & members!!");
  assert.match(name, /^context\/add-platform-team-goals-members-[0-9a-z]+$/);
  assert.match(proposalBranchName("???"), /^context\/change-[0-9a-z]+$/);
  assert.ok(proposalBranchName("x".repeat(200)).length < 70);
});
