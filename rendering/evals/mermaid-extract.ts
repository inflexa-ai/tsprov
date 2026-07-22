// A hand-rolled, dependency-free line parser for `MermaidRenderer` output.
//
// Mermaid has no Python reference and its real renderer is browser-only (Puppeteer
// is banned from the critical path), so the eval cannot re-render to check validity.
// Instead this parser encodes exactly the statement forms `MermaidRenderer` emits and
// throws on anything else — so a syntactically dead line (an emitter bug) fails the
// corpus sweep loudly rather than silently shipping a diagram that will not render.
// It is deliberately scoped to OUR emitted grammar, not all of Mermaid.
//
// A Mermaid grammar dependency is not on the approved list, so this is written by
// hand. The parser asserts it recognized every non-empty line.

/** A flowchart layout direction. */
export type MermaidDirection = "BT" | "TB" | "LR" | "RL";

/** The Mermaid node shapes this renderer emits, each a best-fit for a PROV kind. */
export type MermaidShape =
  | "stadium" // entity / unknown (oval)
  | "rect" // activity
  | "hexagon" // agent (house)
  | "subroutine" // bundle (folder)
  | "circle" // n-ary / annotation blank node (point)
  | "annotation-rect"; // annotation note

/** A parsed node statement: its id, shape, quoted label body, and attached classDef name. */
export type MermaidNode = {
  readonly id: string;
  readonly shape: MermaidShape;
  /** The label text WITHOUT the surrounding quotes. */
  readonly label: string;
  readonly className: string;
};

/** The three link arrows this renderer emits: solid arrow, arrowless open, dotted open. */
export type MermaidArrow = "-->" | "---" | "-.-";

/**
 * A parsed link statement with its 0-based emission index — the space Mermaid's
 * `linkStyle <index>` addresses. `label` is `null` for an arrowless second segment
 * and for a dotted annotation link.
 */
export type MermaidLink = {
  readonly index: number;
  readonly source: string;
  readonly target: string;
  readonly arrow: MermaidArrow;
  readonly label: string | null;
};

/** The fully parsed model of a Mermaid flowchart. */
export type MermaidModel = {
  readonly direction: MermaidDirection;
  /** Named/blank/annotation nodes by id. */
  readonly nodes: ReadonlyMap<string, MermaidNode>;
  /** Links in emission order (index === array position). */
  readonly links: readonly MermaidLink[];
  /** `linkStyle <index>` declarations by index (the tint body after the index). */
  readonly linkStyles: ReadonlyMap<number, string>;
  /** `classDef <name>` declarations by class name (the body after the name). */
  readonly classDefs: ReadonlyMap<string, string>;
  /** Subgraph headers: id → the title WITHOUT quotes. */
  readonly subgraphs: ReadonlyMap<string, string>;
  /** `click <id>` targets: node id → the href WITHOUT quotes. */
  readonly clicks: ReadonlyMap<string, string>;
};

// Node statement patterns, tried most-specific-first (a stadium `([` must not be read
// as a rect `[`). Each captures (id, quoted-label, className).
const NODE_PATTERNS: ReadonlyArray<{ readonly shape: MermaidShape; readonly re: RegExp }> = [
  { shape: "circle", re: /^(b\d+)\(\("(.*)"\)\):::(\w+)$/ },
  { shape: "subroutine", re: /^(n\d+)\[\["(.*)"\]\]:::(\w+)$/ },
  { shape: "stadium", re: /^(n\d+)\(\["(.*)"\]\):::(\w+)$/ },
  { shape: "hexagon", re: /^(n\d+)\{\{"(.*)"\}\}:::(\w+)$/ },
  { shape: "annotation-rect", re: /^(ann\d+)\["(.*)"\]:::(\w+)$/ },
  { shape: "rect", re: /^(n\d+)\["(.*)"\]:::(\w+)$/ },
];

const HEADER_RE = /^flowchart (BT|TB|LR|RL)$/;
const SUBGRAPH_RE = /^subgraph (c\d+)\["(.*)"\]$/;
const CLICK_RE = /^click (n\d+) href "(.*)" _blank$/;
const CLASSDEF_RE = /^classDef (\w+) (.+)$/;
const LINKSTYLE_RE = /^linkStyle (\d+) (.+)$/;
// Link forms: labeled solid/open (`-->|L|`, `---|L|`) and unlabeled solid/dotted.
const LINK_LABELED_RE = /^(\w+) (-->|---)\|(.*)\| (\w+)$/;
const LINK_SOLID_RE = /^(\w+) --> (\w+)$/;
const LINK_DOTTED_RE = /^(\w+) -\.- (\w+)$/;

/**
 * Parses `MermaidRenderer` output into a {@link MermaidModel}, throwing on any line
 * that does not match a known statement form (the line-grammar guard). The first line
 * must be the flowchart header; `end` closes a subgraph and carries no data.
 */
export function parseMermaid(text: string): MermaidModel {
  const rawLines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const first = rawLines[0];
  if (first === undefined) throw new Error("empty Mermaid output (no flowchart header)");
  const header = HEADER_RE.exec(first);
  if (header === null || header[1] === undefined) {
    throw new Error(`unrecognized Mermaid header: ${JSON.stringify(first)}`);
  }
  const direction = header[1] as MermaidDirection;

  const nodes = new Map<string, MermaidNode>();
  const links: MermaidLink[] = [];
  const linkStyles = new Map<number, string>();
  const classDefs = new Map<string, string>();
  const subgraphs = new Map<string, string>();
  const clicks = new Map<string, string>();
  let linkCount = 0;

  for (const line of rawLines.slice(1)) {
    if (line === "end") continue;

    const node = matchNode(line);
    if (node !== null) {
      nodes.set(node.id, node);
      continue;
    }

    const subgraph = SUBGRAPH_RE.exec(line);
    if (subgraph !== null && subgraph[1] !== undefined && subgraph[2] !== undefined) {
      subgraphs.set(subgraph[1], subgraph[2]);
      continue;
    }

    const click = CLICK_RE.exec(line);
    if (click !== null && click[1] !== undefined && click[2] !== undefined) {
      clicks.set(click[1], click[2]);
      continue;
    }

    const classDef = CLASSDEF_RE.exec(line);
    if (classDef !== null && classDef[1] !== undefined && classDef[2] !== undefined) {
      classDefs.set(classDef[1], classDef[2]);
      continue;
    }

    const linkStyle = LINKSTYLE_RE.exec(line);
    if (linkStyle !== null && linkStyle[1] !== undefined && linkStyle[2] !== undefined) {
      linkStyles.set(Number(linkStyle[1]), linkStyle[2]);
      continue;
    }

    const link = matchLink(line, linkCount);
    if (link !== null) {
      links.push(link);
      linkCount += 1;
      continue;
    }

    throw new Error(`unrecognized Mermaid statement: ${JSON.stringify(line)}`);
  }

  return { direction, nodes, links, linkStyles, classDefs, subgraphs, clicks };
}

/** Matches a node statement against every shape pattern; returns `null` when none fits. */
function matchNode(line: string): MermaidNode | null {
  for (const { shape, re } of NODE_PATTERNS) {
    const m = re.exec(line);
    if (m !== null && m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
      return { id: m[1], shape, label: m[2], className: m[3] };
    }
  }
  return null;
}

/** Matches a link statement (labeled, solid, or dotted); returns `null` when none fits. */
function matchLink(line: string, index: number): MermaidLink | null {
  const labeled = LINK_LABELED_RE.exec(line);
  if (labeled !== null && labeled[1] !== undefined && labeled[3] !== undefined && labeled[4] !== undefined) {
    return { index, source: labeled[1], target: labeled[4], arrow: labeled[2] as MermaidArrow, label: labeled[3] };
  }
  const solid = LINK_SOLID_RE.exec(line);
  if (solid !== null && solid[1] !== undefined && solid[2] !== undefined) {
    return { index, source: solid[1], target: solid[2], arrow: "-->", label: null };
  }
  const dotted = LINK_DOTTED_RE.exec(line);
  if (dotted !== null && dotted[1] !== undefined && dotted[2] !== undefined) {
    return { index, source: dotted[1], target: dotted[2], arrow: "-.-", label: null };
  }
  return null;
}
