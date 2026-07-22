// Text-metric estimation for node/label sizing — the substrate dagre lays out on.
//
// SVG output has no DOM and no font engine, so there is no way to MEASURE a rendered
// string; every box dagre positions must be sized from an estimate. The estimate is
// deliberately biased to OVER-approximate a proportional sans-serif's advance widths:
// a too-large box shows up as harmless padding around the glyph, whereas a too-small
// box would let text spill past its shape's outline. That trade — accept slack, never
// clip — is the whole reason the constants below lean generous.
//
// Rejected alternative: a real measurement path (a headless canvas, an embedded font +
// `opentype.js`). Both need a dependency or a DOM the package refuses to carry
// (CLAUDE.md hard rule 6 / the "works on a server, no browser" pitch), so estimation
// is the only option consistent with the package's contract.

/**
 * The font stack every text element declares. A generic sans-serif family so the SVG
 * needs NO embedded or externally-referenced font (the "no external references"
 * conformance rule); the estimator's width factor is tuned for this class of font.
 */
export const FONT_FAMILY = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Font size (px) for a node's own label — the identifier or `prov:label`. */
export const NODE_FONT_SIZE = 14;

/** Font size (px) for the secondary text: edge labels, annotation rows, bundle titles. */
export const LABEL_FONT_SIZE = 10;

// Estimated advance width of one character as a fraction of the font size. Mixed-case
// Latin text in Helvetica/Arial averages ≈0.5em; 0.62 adds ≈25% headroom so the box is
// never too tight for Latin/digit/punctuation runs. It intentionally does NOT try to be
// correct for full-width scripts (CJK ≈1em, wide emoji ≈1em+): those can exceed the
// estimate, which the design accepts as an eyeball-only limitation (layout quality is
// reviewed by eye on the goldens; the machine contract is well-formed, theme-correct,
// deterministic output — not pixel-perfect fit).
const CHAR_WIDTH_EM = 0.62;

/** Line-box height as a multiple of the font size (leading included). */
const LINE_HEIGHT_EM = 1.3;

/** Horizontal padding (px) between the text block and a node's outline, each side. */
export const NODE_PAD_X = 12;

/** Vertical padding (px) between the text block and a node's outline, top and bottom. */
export const NODE_PAD_Y = 8;

/**
 * A rectangle inscribed in an ellipse needs the ellipse's bounding box scaled by √2
 * over the rectangle (corners touch at exactly √2); this sits just above √2 so the
 * text rect clears the ellipse outline with a sliver to spare.
 */
export const ELLIPSE_FACTOR = 1.45;

/** Height (px) of an agent house's triangular roof above its (text-bearing) body. */
export const HOUSE_ROOF = 16;

/** Height (px) of a bundle folder's tab above its (text-bearing) body. */
export const FOLDER_TAB = 10;

/** Size (px) of a note glyph's folded top-right corner. */
export const NOTE_FOLD = 12;

/** Diameter (px) of a blank join node's small circle (dagre needs a real box for it). */
export const BLANK_DIAMETER = 9;

/** The pixel line height for a given font size. */
export function lineHeightPx(fontSize: number): number {
  return fontSize * LINE_HEIGHT_EM;
}

/**
 * Estimated pixel width of `text` at `fontSize`. Counts UTF-16 code units, which
 * over-counts a surrogate-pair emoji as two — an over-approximation, consistent with
 * the bias, so it is left as-is.
 */
export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_EM;
}

/** The pixel dimensions of a stacked block of text `lines` at `fontSize`. */
export function textBlockSize(
  lines: readonly string[],
  fontSize: number,
): { readonly width: number; readonly height: number } {
  const width = lines.reduce((max, line) => Math.max(max, textWidth(line, fontSize)), 0);
  const height = Math.max(1, lines.length) * lineHeightPx(fontSize);
  return { width, height };
}

/** A dagre node box: total width/height a shape needs to enclose its text. */
export type NodeBox = { readonly width: number; readonly height: number };

/**
 * The dagre box for an element/inferred node of a given shape holding `lines` of
 * label text. Each shape expands the padded text rect the amount its outline needs:
 * an `ellipse` by {@link ELLIPSE_FACTOR} (the text rect must sit inside the curve), a
 * `house` by a fixed roof band on top, a plain `rect`/`note` by the padding alone.
 * `blank` ignores the text and returns the fixed circle box.
 */
export function nodeBox(
  shape: "ellipse" | "rect" | "house" | "folder" | "note" | "blank",
  lines: readonly string[],
  fontSize: number,
): NodeBox {
  if (shape === "blank") {
    return { width: BLANK_DIAMETER, height: BLANK_DIAMETER };
  }
  const text = textBlockSize(lines, fontSize);
  const paddedW = text.width + 2 * NODE_PAD_X;
  const paddedH = text.height + 2 * NODE_PAD_Y;
  switch (shape) {
    case "rect":
      return { width: paddedW, height: paddedH };
    case "note":
      // The fold eats into the top-right; widen so the rows still clear it.
      return { width: paddedW + NOTE_FOLD, height: paddedH };
    case "ellipse":
      return { width: paddedW * ELLIPSE_FACTOR, height: paddedH * ELLIPSE_FACTOR };
    case "house":
      return { width: paddedW, height: paddedH + HOUSE_ROOF };
    case "folder":
      return { width: paddedW, height: paddedH + FOLDER_TAB };
    default: {
      const exhaustive: never = shape;
      return exhaustive;
    }
  }
}
