import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/version.js";

test("src/version.ts matches package.json (run scripts/sync-version.mjs after a bump)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});
