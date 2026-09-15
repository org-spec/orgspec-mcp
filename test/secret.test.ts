import { test } from "node:test";
import assert from "node:assert/strict";
import { equalSecrets } from "../src/secret.js";

test("equalSecrets: equal strings match", () => {
  assert.equal(equalSecrets("abc", "abc"), true);
  assert.equal(equalSecrets("", ""), true);
});

test("equalSecrets: any difference fails, including length and prefix", () => {
  assert.equal(equalSecrets("abc", "abd"), false);
  assert.equal(equalSecrets("abc", "ab"), false);
  assert.equal(equalSecrets("abc", "abcd"), false);
  assert.equal(equalSecrets("", "a"), false);
  assert.equal(equalSecrets("Bearer x", "Bearer X"), false);
});
