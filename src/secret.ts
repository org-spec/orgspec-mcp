import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of two secrets (keys, MACs, cookies). Hashing
 * first makes the compare length-independent, so neither the length nor the
 * position of the first differing byte leaks through timing. Use this for
 * every secret the server checks — never `===`.
 */
export function equalSecrets(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
