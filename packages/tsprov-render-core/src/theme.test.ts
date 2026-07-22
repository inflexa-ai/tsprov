import { test, expect } from "bun:test";

import { PROV_THEME } from "./theme.js";
import type { RelationKind, EdgeStyle } from "./theme.js";

// The exact reference values, transcribed from `DOT_PROV_STYLE` (dot.py:102-153).
// This table IS the spec: the theme must reproduce it byte-for-byte.

test("colored element styles match DOT_PROV_STYLE", () => {
  expect(PROV_THEME.nodes.entity).toEqual({
    shape: "oval",
    style: "filled",
    fillcolor: "#FFFC87",
    color: "#808080",
  });
  expect(PROV_THEME.nodes.activity).toEqual({
    shape: "box",
    style: "filled",
    fillcolor: "#9FB1FC",
    color: "#0000FF",
  });
  // Agent and bundle carry no border color in the reference.
  expect(PROV_THEME.nodes.agent).toEqual({
    shape: "house",
    style: "filled",
    fillcolor: "#FED37F",
  });
  expect(PROV_THEME.nodes.bundle).toEqual({
    shape: "folder",
    style: "filled",
    fillcolor: "aliceblue",
  });
});

test("generic (inferred) node styles match GENERIC_NODE_STYLE", () => {
  // Every generic kind is gray-filled; shape follows the inferred type; `unknown`
  // is the reference's DOT_PROV_STYLE[0] (oval, lightgray, dimgray).
  const gray = { style: "filled", fillcolor: "lightgray", color: "dimgray" };
  expect(PROV_THEME.generic.entity).toEqual({ shape: "oval", ...gray });
  expect(PROV_THEME.generic.activity).toEqual({ shape: "box", ...gray });
  expect(PROV_THEME.generic.agent).toEqual({ shape: "house", ...gray });
  expect(PROV_THEME.generic.bundle).toEqual({ shape: "folder", ...gray });
  expect(PROV_THEME.generic.unknown).toEqual({ shape: "oval", ...gray });
});

test("all 15 relation styles match DOT_PROV_STYLE", () => {
  const expected: Record<RelationKind, EdgeStyle> = {
    "prov:Generation": {
      label: "wasGeneratedBy",
      fontsize: "10.0",
      color: "darkgreen",
      fontcolor: "darkgreen",
    },
    "prov:Usage": {
      label: "used",
      fontsize: "10.0",
      color: "red4",
      fontcolor: "red",
    },
    "prov:Communication": { label: "wasInformedBy", fontsize: "10.0" },
    "prov:Start": { label: "wasStartedBy", fontsize: "10.0" },
    "prov:End": { label: "wasEndedBy", fontsize: "10.0" },
    "prov:Invalidation": { label: "wasInvalidatedBy", fontsize: "10.0" },
    "prov:Derivation": { label: "wasDerivedFrom", fontsize: "10.0" },
    "prov:Attribution": {
      label: "wasAttributedTo",
      fontsize: "10.0",
      color: "#FED37F",
    },
    "prov:Association": {
      label: "wasAssociatedWith",
      fontsize: "10.0",
      color: "#FED37F",
    },
    "prov:Delegation": {
      label: "actedOnBehalfOf",
      fontsize: "10.0",
      color: "#FED37F",
    },
    "prov:Influence": {
      label: "wasInfluencedBy",
      fontsize: "10.0",
      color: "grey",
    },
    "prov:Alternate": { label: "alternateOf", fontsize: "10.0" },
    "prov:Specialization": { label: "specializationOf", fontsize: "10.0" },
    "prov:Mention": { label: "mentionOf", fontsize: "10.0" },
    "prov:Membership": { label: "hadMember", fontsize: "10.0" },
  };

  const kinds = Object.keys(expected) as RelationKind[];
  expect(kinds.length).toBe(15);
  for (const kind of kinds) {
    expect(PROV_THEME.relations[kind]).toEqual(expected[kind]);
  }
});

test("annotation, link, and direction match the reference", () => {
  expect(PROV_THEME.annotation).toEqual({
    shape: "note",
    color: "gray",
    fontcolor: "black",
    fontsize: "10",
  });
  expect(PROV_THEME.annotationLink).toEqual({
    arrowhead: "none",
    style: "dashed",
    color: "gray",
  });
  expect(PROV_THEME.direction).toBe("BT");
});
