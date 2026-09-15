import { createHash } from "node:crypto";

/**
 * Mermaid is the one third-party script the app host loads, and only on
 * pages that contain a diagram. It is pinned to an exact version of the
 * single-file IIFE build with Subresource Integrity, so the CDN cannot
 * serve anything but the reviewed bytes. Bump by updating VERSION and
 * INTEGRITY together:
 *
 *   curl -sSfo m.js https://cdn.jsdelivr.net/npm/mermaid@<v>/dist/mermaid.min.js
 *   echo "sha384-$(openssl dgst -sha384 -binary m.js | openssl base64 -A)"
 */
export const MERMAID_VERSION = "11.17.2";
export const MERMAID_INTEGRITY = "sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2";
export const MERMAID_ORIGIN = "https://cdn.jsdelivr.net";
export const MERMAID_SRC = `${MERMAID_ORIGIN}/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`;

/**
 * The init call is inline (so self-hosted deployments need no static file)
 * and constant, so the CSP allows exactly this script by hash. Keep the two
 * in step: the hash below is computed from this string at module load.
 */
export const MERMAID_INIT = `mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "strict" });`;
export const MERMAID_INIT_HASH = `sha256-${createHash("sha256").update(MERMAID_INIT).digest("base64")}`;

/** Markup appended to pages that contain a diagram. */
export const MERMAID_TAIL =
  `<script src="${MERMAID_SRC}" integrity="${MERMAID_INTEGRITY}" crossorigin="anonymous"></script>\n` +
  `<script>${MERMAID_INIT}</script>`;
