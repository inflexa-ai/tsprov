// Link-scheme allowlisting for every renderer that emits a clickable URI.
//
// THREAT MODEL. A PROV identifier's URI is `namespace.uri + localpart`
// (`packages/tsprov/src/identifier.ts`) — both halves come from the *document being
// rendered*, which is attacker-influenceable input, not trusted authoring. Every renderer
// turns that URI into a live link sink: the SVG node `<a href>`, Mermaid's `click … href`,
// DOT's `URL=`/HTML-`TABLE` `href` (live once Graphviz rasterizes to SVG), and the
// interactive page's panel/attribute anchors. The intended sharing workflow is a single
// self-contained file opened straight from disk, so a `javascript:` or `data:` URI in an
// `href` would execute script in the `file://` origin the moment the reader clicks it.
//
// This gate lets renderers keep every legitimate link (real PROV URIs are absolute http(s))
// while refusing hostile schemes. It is deliberately in render-core so all four renderers
// share ONE implementation and one test surface (the workspace reuse rule); the interactive
// client re-implements the same check in vanilla JS as defense-in-depth against a
// hand-edited payload.

/**
 * The link schemes a renderer may emit into a live `href`/`URL`. `http`/`https` cover real
 * PROV identifier URIs; `mailto` is the one non-navigational scheme worth keeping clickable.
 * Everything script-capable (`javascript:`, `data:`, `vbscript:`, `file:`, …) is refused.
 */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto"]);

/**
 * A leading scheme (`scheme:`) per the URL grammar: an ASCII letter followed by letters,
 * digits, `+`, `-`, or `.`, up to the first colon. Anchored to the start so a colon later in
 * the string (a path segment, a `prefix:local` fragment) is never mistaken for a scheme.
 */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * The characters a browser's URL parser discards before it navigates: every ASCII control
 * (U+0000–U+001F), space (U+0020), and DEL (U+007F). Stripping these before scheme detection
 * is what defeats obfuscation like `java\nscript:` — a browser collapses that to `javascript:`
 * and would run it, so we must classify the collapsed form rather than the raw bytes.
 */
const URL_IGNORED_CHARS = /[\u0000-\u0020\u007f]/g;

/**
 * Returns `uri` verbatim when it is safe to place in a clickable link, else `undefined`.
 *
 * A URI is safe when it carries **no scheme at all** (a relative reference, a `#fragment`, a
 * query, or a protocol-relative `//host/…` URL — none of which can execute script) OR its
 * scheme is in the {@link ALLOWED_SCHEMES} allowlist (`http`, `https`, `mailto`). Any other
 * scheme — `javascript:`, `data:`, `vbscript:`, `file:`, and anything unrecognized — returns
 * `undefined` so the caller omits the link and shows the URI as inert text instead.
 *
 * Scheme detection first **normalizes** the input the way a browser's URL parser does before
 * it decides how to navigate: ASCII whitespace and control characters are stripped (see
 * {@link URL_IGNORED_CHARS}), so an obfuscated `java\nscript:` — which a browser collapses to
 * `javascript:` and *would* run — cannot slip past a naive parser that sees `java` followed
 * by a non-scheme byte and wrongly concludes "no scheme". The scheme is matched
 * case-insensitively (`JavaScript:` is blocked). Normalization is used only to CLASSIFY; the
 * original `uri` is what gets returned, so a legitimate link is emitted byte-for-byte unchanged.
 *
 * @param uri The candidate link target — an attacker-influenceable PROV identifier URI.
 * @returns `uri` unchanged when safe to link; `undefined` when its scheme is disallowed.
 */
export function safeLinkUri(uri: string): string | undefined {
  // Classify the collapsed form (over-stripping can only expose a hidden scheme → more
  // blocking, never a bypass), but return the original `uri` so allowed links are unchanged.
  const normalized = uri.replace(URL_IGNORED_CHARS, "");
  const match = SCHEME_RE.exec(normalized);
  // No scheme → relative/fragment/protocol-relative: inert, cannot execute — always allowed.
  if (match === null) return uri;
  const scheme = match[1]?.toLowerCase();
  return scheme !== undefined && ALLOWED_SCHEMES.has(scheme) ? uri : undefined;
}
