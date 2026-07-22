// The W3C PROV visual convention as plain, overridable data.
//
// This is a faithful transcription of `reference/prov/src/prov/dot.py:61-168`:
// `GENERIC_NODE_STYLE` (the gray styles applied to inferred/undeclared endpoints,
// dot.py:61-92), `DOT_PROV_STYLE` (the colored element styles + every relation's
// label/color, dot.py:93-154), and the annotation note + link styles
// (dot.py:156-162). Keeping it as data — rather than baking it into a DOT emitter —
// lets every renderer in the ladder present the same convention its own way and
// deep-merge partial overrides.

/**
 * A graph layout direction, matching `prov_to_dot`'s `direction` values
 * (`dot.py:196`). `"BT"` (bottom-to-top) is the PROV convention default.
 */
export type Direction = "BT" | "TB" | "LR" | "RL";

/**
 * The four element kinds that carry a colored style. Declared PROV elements are
 * only ever entity/activity/agent; `bundle` styles an inferred `prov:bundle`
 * endpoint (from `mentionOf`) and is present so the theme mirrors `DOT_PROV_STYLE`
 * completely.
 */
export type DeclaredNodeKind = "entity" | "activity" | "agent" | "bundle";

/**
 * Every node kind a {@link RenderNode} can carry. `"unknown"` is the fallback for
 * an inferred endpoint whose formal attribute has no PROV-DM domain (mirroring
 * `dot.py`'s generic node, `DOT_PROV_STYLE[0]`).
 */
export type NodeKind = DeclaredNodeKind | "unknown";

/**
 * The 15 PROV relation kinds, keyed by their canonical `prov:`-prefixed display
 * form (`String(record.getType())`) — the exact keys of `DOT_PROV_STYLE`'s
 * relation entries (`dot.py:117-153`).
 */
export type RelationKind =
  | "prov:Generation"
  | "prov:Usage"
  | "prov:Communication"
  | "prov:Start"
  | "prov:End"
  | "prov:Invalidation"
  | "prov:Derivation"
  | "prov:Attribution"
  | "prov:Association"
  | "prov:Delegation"
  | "prov:Influence"
  | "prov:Alternate"
  | "prov:Specialization"
  | "prov:Mention"
  | "prov:Membership";

/**
 * Graphviz node styling for one kind of element (`dot.py`'s per-type dicts). Field
 * names are the Graphviz attribute names so a DOT renderer can emit them directly;
 * other renderers read the same shape/colors semantically. `color` (the border) is
 * optional because `DOT_PROV_STYLE` omits it for agent and bundle (`dot.py:114-115`).
 */
export type NodeStyle = {
  /** Graphviz node shape (`oval`, `box`, `house`, `folder`). */
  readonly shape: string;
  /** Graphviz fill style (always `"filled"` in the reference). */
  readonly style: string;
  /** Fill color (hex or Graphviz color name). */
  readonly fillcolor: string;
  /** Border color; omitted where the reference leaves it defaulted. */
  readonly color?: string;
};

/**
 * Graphviz edge styling for one relation kind (`DOT_PROV_STYLE`'s relation
 * entries). `label` is the PROV-N name shown on the edge; `color`/`fontcolor` are
 * present only for the relations the reference tints (`dot.py:117-153`).
 */
export type EdgeStyle = {
  /** The PROV-N relation name displayed on the edge (e.g. `"wasGeneratedBy"`). */
  readonly label: string;
  /** Graphviz font size for the edge label (a stringified float, e.g. `"10.0"`). */
  readonly fontsize: string;
  /** Edge/line color; omitted for the reference's uncolored (black) relations. */
  readonly color?: string;
  /** Edge label font color; omitted where the reference leaves it defaulted. */
  readonly fontcolor?: string;
};

/**
 * Styling for an attribute annotation note box (`ANNOTATION_STYLE`, `dot.py:156`).
 * A renderer that materializes annotation boxes reads this; the scene itself keeps
 * annotations as {@link RenderNode}/{@link RenderEdge} `attributes` data.
 */
export type AnnotationStyle = {
  /** Graphviz shape for the note box (`"note"`). */
  readonly shape: string;
  /** Note box border color. */
  readonly color: string;
  /** Note box text color. */
  readonly fontcolor: string;
  /** Note box font size. */
  readonly fontsize: string;
};

/**
 * Styling for the dashed link from an annotation note to its element/relation
 * (`ANNOTATION_LINK_STYLE`, `dot.py:162`).
 */
export type AnnotationLinkStyle = {
  /** Graphviz arrowhead (`"none"` — the link is undirected). */
  readonly arrowhead: string;
  /** Line style (`"dashed"`). */
  readonly style: string;
  /** Line color. */
  readonly color: string;
};

/**
 * The complete PROV visual theme as data. `nodes` are the colored styles for
 * declared elements (`DOT_PROV_STYLE`, `dot.py:278`); `generic` are the gray styles
 * a renderer applies to inferred endpoints keyed by kind (`GENERIC_NODE_STYLE`,
 * `dot.py:295`). Renderers deep-merge a `Partial<ProvTheme>` over {@link PROV_THEME}.
 */
export type ProvTheme = {
  /** Default layout direction (`"BT"` per the PROV convention). */
  readonly direction: Direction;
  /** Colored styles for declared elements, by kind. */
  readonly nodes: Readonly<Record<DeclaredNodeKind, NodeStyle>>;
  /** Gray styles for inferred/undeclared endpoints, by kind (incl. `unknown`). */
  readonly generic: Readonly<Record<NodeKind, NodeStyle>>;
  /** Per-relation edge styles, keyed by the relation's `prov:` display form. */
  readonly relations: Readonly<Record<RelationKind, EdgeStyle>>;
  /** Attribute annotation note styling. */
  readonly annotation: AnnotationStyle;
  /** Annotation-to-target link styling. */
  readonly annotationLink: AnnotationLinkStyle;
};

/**
 * The W3C PROV visual theme, transcribed verbatim from `prov.dot`
 * (`dot.py:61-168`). The single source of visual truth every renderer starts from.
 */
export const PROV_THEME: ProvTheme = {
  direction: "BT",
  // Colored element styles — `DOT_PROV_STYLE` (dot.py:102-115). Applied to declared
  // elements (dot.py:278). Agent and bundle intentionally carry no border `color`,
  // matching the reference exactly.
  nodes: {
    entity: { shape: "oval", style: "filled", fillcolor: "#FFFC87", color: "#808080" },
    activity: { shape: "box", style: "filled", fillcolor: "#9FB1FC", color: "#0000FF" },
    agent: { shape: "house", style: "filled", fillcolor: "#FED37F" },
    bundle: { shape: "folder", style: "filled", fillcolor: "aliceblue" },
  },
  // Gray endpoint styles — `GENERIC_NODE_STYLE` (dot.py:61-92) keyed by inferred
  // kind, plus `unknown` = the reference's generic node `DOT_PROV_STYLE[0]`
  // (dot.py:95-100, identical to `GENERIC_NODE_STYLE[None]`). Applied to inferred
  // endpoints (dot.py:295).
  generic: {
    entity: { shape: "oval", style: "filled", fillcolor: "lightgray", color: "dimgray" },
    activity: { shape: "box", style: "filled", fillcolor: "lightgray", color: "dimgray" },
    agent: { shape: "house", style: "filled", fillcolor: "lightgray", color: "dimgray" },
    bundle: { shape: "folder", style: "filled", fillcolor: "lightgray", color: "dimgray" },
    unknown: { shape: "oval", style: "filled", fillcolor: "lightgray", color: "dimgray" },
  },
  // Relation styles — `DOT_PROV_STYLE` relation entries (dot.py:117-153).
  relations: {
    "prov:Generation": { label: "wasGeneratedBy", fontsize: "10.0", color: "darkgreen", fontcolor: "darkgreen" },
    "prov:Usage": { label: "used", fontsize: "10.0", color: "red4", fontcolor: "red" },
    "prov:Communication": { label: "wasInformedBy", fontsize: "10.0" },
    "prov:Start": { label: "wasStartedBy", fontsize: "10.0" },
    "prov:End": { label: "wasEndedBy", fontsize: "10.0" },
    "prov:Invalidation": { label: "wasInvalidatedBy", fontsize: "10.0" },
    "prov:Derivation": { label: "wasDerivedFrom", fontsize: "10.0" },
    "prov:Attribution": { label: "wasAttributedTo", fontsize: "10.0", color: "#FED37F" },
    "prov:Association": { label: "wasAssociatedWith", fontsize: "10.0", color: "#FED37F" },
    "prov:Delegation": { label: "actedOnBehalfOf", fontsize: "10.0", color: "#FED37F" },
    "prov:Influence": { label: "wasInfluencedBy", fontsize: "10.0", color: "grey" },
    "prov:Alternate": { label: "alternateOf", fontsize: "10.0" },
    "prov:Specialization": { label: "specializationOf", fontsize: "10.0" },
    "prov:Mention": { label: "mentionOf", fontsize: "10.0" },
    "prov:Membership": { label: "hadMember", fontsize: "10.0" },
  },
  annotation: { shape: "note", color: "gray", fontcolor: "black", fontsize: "10" },
  annotationLink: { arrowhead: "none", style: "dashed", color: "gray" },
};
