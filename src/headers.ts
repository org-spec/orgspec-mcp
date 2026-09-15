import { MERMAID_INIT_HASH, MERMAID_ORIGIN } from "./mermaid.js";

/**
 * Security headers for every page and API response the app host serves.
 * Netlify's `[[headers]]` rules (netlify.toml) cover the static landing page
 * only — they do not apply to function responses — so the same policy is
 * applied here by every adapter (Netlify Functions and the Node HTTP server).
 *
 * Content Security Policy, HTML pages:
 *   - scripts: same origin, the pinned Mermaid bundle (SRI-protected) and
 *     its constant init line by hash. No inline scripts otherwise.
 *   - styles: same origin plus inline — the page shell carries its CSS inline
 *     and Mermaid styles the SVG it renders. Content cannot inject markup
 *     (everything is escaped), so inline CSS is not an injection vector here.
 *   - form-action allows any https: target: the OAuth consent form redirects
 *     the browser back to the client's redirect_uri, and browsers apply
 *     form-action to that redirect. javascript:/data: stay blocked.
 *   - no framing, no <base>, no plugins.
 *
 * Everything else (JSON, plain text, redirects) gets a deny-all policy.
 */
const CSP_HTML = [
  "default-src 'self'",
  `script-src 'self' ${MERMAID_ORIGIN} '${MERMAID_INIT_HASH}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self' https:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

const CSP_OTHER = "default-src 'none'; frame-ancestors 'none'";

const COMMON: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // The web view is a capability URL: never leak it in Referer to linked sites.
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

/** Headers to merge into a response with the given Content-Type. */
export function securityHeaders(contentType: string): Record<string, string> {
  return { ...COMMON, "Content-Security-Policy": contentType.startsWith("text/html") ? CSP_HTML : CSP_OTHER };
}
