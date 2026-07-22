/*
 * The embedded interactive PROV viewer — dependency-free vanilla JS.
 *
 * This is OUR code (it happens to run in a browser rather than Node), so the same
 * commenting discipline applies: comment the WHY. It reads the dagre-positioned scene
 * baked into `#prov-scene` at generate time and builds the SVG DOM ONCE, then explores it
 * by toggling classes and animating the viewBox — never re-laying-out. Positions are
 * fixed at bake time, which is why revealing a hidden node is a class flip (spatial
 * memory is preserved; nothing jumps).
 *
 * Layout of the file:
 *   1. Payload + geometry constants (must mirror the svg package's measure.ts).
 *   2. Small DOM/SVG helpers.
 *   3. Graph model: adjacency + degree derived from the logical edges.
 *   4. Scene build: create every primitive as SVG DOM, indexed for fast toggling.
 *   5. Visibility: disclosure gating + search dim/highlight, applied as classes.
 *   6. Disclosure engine: initial set, badges, expand/collapse, show-all/reset.
 *   7. viewBox: rAF-eased animation (viewBox is not CSS-transitionable), fit-to-visible.
 *   8. Interactions: pan/drag, cursor-anchored wheel zoom, node select, keyboard.
 *   9. Panel, search/filter, control wiring, init.
 */
(function () {
  "use strict";

  // ── 1. Payload + constants ─────────────────────────────────────────────────

  var payloadEl = document.getElementById("prov-scene");
  // The payload is trusted JSON we emitted; a corrupt embed is a generation bug, so a
  // parse failure should surface loudly rather than silently produce a blank page.
  var scene = JSON.parse(payloadEl.textContent);

  var SVG_NS = "http://www.w3.org/2000/svg";

  // These MUST match rendering/tsprov-render-svg/src/measure.ts: the payload carries dagre
  // BOX sizes, and the client re-derives each glyph's silhouette from the box exactly as
  // the SVG emitter does, so the interactive picture matches the static one.
  var NODE_FONT_SIZE = 14;
  var LABEL_FONT_SIZE = 10;
  var LINE_HEIGHT_EM = 1.3;
  var NODE_PAD_X = 12;
  var HOUSE_ROOF = 16;
  var FOLDER_TAB = 10;
  var NOTE_FOLD = 12;

  var meta = scene.meta;
  var theme = scene.theme;
  var disclosure = meta.disclosure;

  // Mirrors EXPAND_CAP in src/interactive.ts: one badge/expand action reveals at most this
  // many of a node's still-hidden neighbors (nearest hop, in scene order), then the badge
  // recomputes to the remaining hidden count. The value lives in two runtimes (the generator
  // precomputes the initial set; the client caps each expansion), so a drift test asserts the
  // two declarations agree. Keeps a 141-neighbor hub explorable in steps, not one dump.
  var EXPAND_CAP = 20;

  // ── 2. Helpers ─────────────────────────────────────────────────────────────

  /** Creates an SVG element with attributes; children are strings (text) or nodes. */
  function svg(tag, attrs, children) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, String(attrs[k]));
      }
    }
    appendAll(el, children);
    return el;
  }

  /**
   * Creates an HTML element with attributes/props; `class` and `text` are conveniences.
   * There is deliberately NO `innerHTML` path: every dynamic string (qualified names,
   * attribute values, URIs) reaches the DOM through `textContent`/`setAttribute` only, so
   * a hostile corpus literal can never inject markup into the chrome.
   */
  function h(tag, opts, children) {
    var el = document.createElement(tag);
    if (opts) {
      for (var k in opts) {
        if (k === "class") el.className = opts[k];
        else if (k === "text") el.textContent = opts[k];
        else if (opts[k] !== undefined && opts[k] !== null) el.setAttribute(k, String(opts[k]));
      }
    }
    appendAll(el, children);
    return el;
  }

  function appendAll(el, children) {
    if (children === undefined || children === null) return;
    var list = Array.isArray(children) ? children : [children];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c === undefined || c === null || c === false) continue;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
  }

  /** dagre-safe id sanitizer for arrowhead marker ids — mirrors svg.ts's markerId. */
  function markerId(color) {
    return "arrow-" + color.replace(/[^A-Za-z0-9]/g, "");
  }

  /**
   * Mirror of render-core's safeLinkUri: returns the URI only when its scheme is link-safe
   * (http/https/mailto, or scheme-less), else undefined. The embedded payload is ALREADY
   * scheme-filtered at generation (interactive.ts), so this is defense in depth — a
   * hand-edited payload could smuggle a javascript:/data: URI, and this is the last gate
   * before it becomes a live href. Whitespace/control chars are stripped first so an
   * obfuscated "java\nscript:" (which a browser collapses and runs) cannot slip through.
   */
  function safeLinkUri(uri) {
    var normalized = String(uri).replace(/[\u0000-\u0020\u007f]/g, "");
    var m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized);
    if (m === null) return uri;
    var scheme = m[1].toLowerCase();
    return scheme === "http" || scheme === "https" || scheme === "mailto" ? uri : undefined;
  }

  function lineHeight(fontSize) {
    return fontSize * LINE_HEIGHT_EM;
  }

  /** A multi-line <text> whose vertical centre sits on cy — mirrors svg.ts's textElement. */
  function textBlock(lines, x, cy, fontSize, anchor, inlineFill) {
    var attrs = {
      x: x,
      y: cy,
      "text-anchor": anchor,
      "dominant-baseline": "central",
      "font-size": fontSize,
    };
    // Edge labels carry a themed (relation-tint) fill inline so the visual language holds;
    // node/note/bundle labels get no inline fill so CSS can keep them legible in dark mode.
    if (inlineFill) attrs.fill = inlineFill;
    var text = svg("text", attrs);
    var lh = lineHeight(fontSize);
    var startDy = (-(lines.length - 1) / 2) * lh;
    for (var i = 0; i < lines.length; i++) {
      text.appendChild(svg("tspan", { x: x, dy: i === 0 ? startDy : lh }, lines[i]));
    }
    return text;
  }

  // ── 3. Graph model ─────────────────────────────────────────────────────────

  var nodeById = {};
  scene.nodes.forEach(function (n) {
    nodeById[n.id] = n;
  });

  // Undirected adjacency over the LOGICAL edges (source/target plus every n-ary leg's
  // endpoint) — the substrate for neighbourhoods, badges, and degree. Edge participants
  // are treated as mutually adjacent so an n-ary relation's legs count as neighbours of
  // both endpoints.
  var adjacency = {};
  var incidentEdges = {};
  scene.nodes.forEach(function (n) {
    adjacency[n.id] = new Set();
    incidentEdges[n.id] = new Set();
  });
  function link(a, b, edgeId) {
    if (a === b || !adjacency[a] || !adjacency[b]) return;
    adjacency[a].add(b);
    adjacency[b].add(a);
    incidentEdges[a].add(edgeId);
    incidentEdges[b].add(edgeId);
  }
  scene.edges.forEach(function (e) {
    var participants = [e.source, e.target];
    e.naryLegs.forEach(function (leg) {
      participants.push(leg.target);
    });
    for (var i = 0; i < participants.length; i++) {
      for (var j = i + 1; j < participants.length; j++) {
        link(participants[i], participants[j], e.id);
      }
    }
  });

  /** A node's degree = number of distinct logical edges incident to it. */
  function degreeOf(id) {
    return incidentEdges[id] ? incidentEdges[id].size : 0;
  }

  // ── 4. Scene build (DOM once) ──────────────────────────────────────────────

  var canvas = document.getElementById("prov-canvas");
  var svgRoot = svg("svg", {
    class: "prov-scene",
    xmlns: SVG_NS,
    "font-family": "'Helvetica Neue', Helvetica, Arial, sans-serif",
  });

  // Paint order (behind → front) mirrors the static SVG: bundles, edges, join circles,
  // notes, element glyphs, then the badge overlay on top.
  var defsLayer = svg("defs");
  var bundleLayer = svg("g", { class: "layer-bundles" });
  var edgeLayer = svg("g", { class: "layer-edges" });
  var blankLayer = svg("g", { class: "layer-blanks" });
  var noteLayer = svg("g", { class: "layer-notes" });
  var nodeLayer = svg("g", { class: "layer-nodes" });
  var badgeLayer = svg("g", { class: "layer-badges" });
  appendAll(svgRoot, [defsLayer, bundleLayer, edgeLayer, blankLayer, noteLayer, nodeLayer, badgeLayer]);

  // Arrowhead markers, one per distinct stroke colour (pre-deduped + sorted in the payload).
  scene.markerColors.forEach(function (color) {
    var marker = svg(
      "marker",
      {
        id: markerId(color),
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 8,
        markerHeight: 8,
        markerUnits: "userSpaceOnUse",
        orient: "auto",
      },
      svg("path", { d: "M0,0 L10,5 L0,10 z", fill: color }),
    );
    defsLayer.appendChild(marker);
  });

  // Bundle rects (behind their members). Indexed with the member-node ids that gate them.
  var bundleEntries = [];
  scene.bundles.forEach(function (b) {
    if (!b.rect) return;
    var r = b.rect;
    var g = svg("g", { class: "prov-bundle", "data-bundle": b.id });
    g.appendChild(
      svg("rect", {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        rx: 8,
        ry: 8,
        fill: theme.decor.bundleFill,
        stroke: theme.decor.bundleStroke,
      }),
    );
    if (b.label) {
      g.appendChild(
        svg(
          "text",
          { x: r.x + 6, y: r.y + LABEL_FONT_SIZE + 2, "font-size": LABEL_FONT_SIZE, fill: theme.decor.bundleLabelFill },
          b.label,
        ),
      );
    }
    bundleLayer.appendChild(g);
    var members = scene.nodes.filter(function (n) {
      return n.bundleId === b.id;
    }).map(function (n) { return n.id; });
    bundleEntries.push({ el: g, members: members });
  });

  // Edge segments.
  var segmentEntries = [];
  scene.segments.forEach(function (seg) {
    var g = svg("g", { class: "prov-edge" });
    var d = seg.points.length === 0 ? "" : seg.points.map(function (p, i) {
      return (i === 0 ? "M" : "L") + " " + p.x + " " + p.y;
    }).join(" ");
    var pathAttrs = {
      d: d,
      fill: "none",
      stroke: seg.stroke,
      "stroke-width": 1.5,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    };
    if (seg.dashed) pathAttrs["stroke-dasharray"] = "4 3";
    if (seg.arrow) pathAttrs["marker-end"] = "url(#" + markerId(seg.stroke) + ")";
    g.appendChild(svg("path", pathAttrs));
    if (seg.label !== undefined && seg.labelPos) {
      g.appendChild(textBlock([seg.label], seg.labelPos.x, seg.labelPos.y, LABEL_FONT_SIZE, "middle", seg.labelFill));
    }
    edgeLayer.appendChild(g);
    segmentEntries.push({ el: g, gates: seg.gates });
  });

  // Join circles (D18 blank nodes).
  var blankEntries = [];
  scene.blanks.forEach(function (bl) {
    var g = svg("g", { class: "prov-blank" });
    g.appendChild(
      svg("circle", {
        cx: bl.box.x,
        cy: bl.box.y,
        r: bl.box.width / 2,
        fill: "gray",
        stroke: theme.annotationLink.color,
      }),
    );
    blankLayer.appendChild(g);
    blankEntries.push({ el: g, gates: bl.gates });
  });

  // Folded-corner notes.
  var noteEntries = [];
  scene.notes.forEach(function (note) {
    var box = note.box;
    var left = box.x - box.width / 2;
    var right = box.x + box.width / 2;
    var top = box.y - box.height / 2;
    var bottom = box.y + box.height / 2;
    var outline =
      "M " + left + " " + top + " L " + (right - NOTE_FOLD) + " " + top + " " +
      "L " + right + " " + (top + NOTE_FOLD) + " L " + right + " " + bottom + " " +
      "L " + left + " " + bottom + " Z";
    var fold =
      "M " + (right - NOTE_FOLD) + " " + top + " L " + (right - NOTE_FOLD) + " " + (top + NOTE_FOLD) + " " +
      "L " + right + " " + (top + NOTE_FOLD);
    var g = svg("g", { class: "prov-annotation" });
    g.appendChild(svg("path", { d: outline + " " + fold, fill: "#ffffff", stroke: theme.annotation.color }));
    g.appendChild(textBlock(note.rows, left + NODE_PAD_X, box.y, LABEL_FONT_SIZE, "start", null));
    noteLayer.appendChild(g);
    noteEntries.push({ el: g, gates: note.gates });
  });

  // Element glyphs (on top). Each is focusable and behaves as a button.
  var nodeEntries = {};
  scene.nodes.forEach(function (n) {
    var kindClass = "prov-node prov-" + n.kind + (n.inferred ? " prov-inferred" : "");
    var g = svg("g", {
      class: kindClass,
      "data-id": n.id,
      tabindex: "0",
      role: "button",
      "aria-label": n.qualifiedName + " (" + n.kind + ")",
    });
    // Native tooltip: qualified name + attribute rows, matching the static SVG's <title>.
    var titleLines = [n.qualifiedName].concat(
      n.attributes.map(function (a) {
        return a.name + " = " + a.value;
      }),
    );
    g.appendChild(svg("title", null, titleLines.join("\n")));
    g.appendChild(glyphEl(n));
    var textCy = glyphTextCy(n);
    g.appendChild(textBlock(n.labelLines, n.box.x, textCy, NODE_FONT_SIZE, "middle", null));
    nodeLayer.appendChild(g);
    nodeEntries[n.id] = { el: g, node: n };
  });

  canvas.appendChild(svgRoot);

  /** The themed glyph element (with class "glyph" so CSS selection glow can target it). */
  function glyphEl(n) {
    var box = n.box;
    var fill = n.fill;
    var stroke = n.stroke;
    var left = box.x - box.width / 2;
    var right = box.x + box.width / 2;
    var top = box.y - box.height / 2;
    var bottom = box.y + box.height / 2;
    var common = { class: "glyph", fill: fill };
    if (stroke !== undefined) common.stroke = stroke;
    if (n.glyph === "ellipse") {
      return svg("ellipse", assign({ cx: box.x, cy: box.y, rx: box.width / 2, ry: box.height / 2 }, common));
    }
    if (n.glyph === "rect") {
      return svg("rect", assign({ x: left, y: top, width: box.width, height: box.height }, common));
    }
    if (n.glyph === "house") {
      var shoulder = top + HOUSE_ROOF;
      var pts = [
        left + "," + bottom,
        right + "," + bottom,
        right + "," + shoulder,
        box.x + "," + top,
        left + "," + shoulder,
      ].join(" ");
      return svg("polygon", assign({ points: pts }, common));
    }
    // folder
    var tab = top + FOLDER_TAB;
    var tabRight = left + box.width * 0.4;
    var d =
      "M " + left + " " + top + " L " + tabRight + " " + top + " " +
      "L " + (tabRight + 6) + " " + tab + " L " + right + " " + tab + " " +
      "L " + right + " " + bottom + " L " + left + " " + bottom + " Z";
    return svg("path", assign({ d: d }, common));
  }

  /** House/folder labels sit below the roof/tab; other shapes centre on the box — svg.ts. */
  function glyphTextCy(n) {
    var box = n.box;
    var top = box.y - box.height / 2;
    var bottom = box.y + box.height / 2;
    if (n.glyph === "house") return (top + HOUSE_ROOF + bottom) / 2;
    if (n.glyph === "folder") return (top + FOLDER_TAB + bottom) / 2;
    return box.y;
  }

  function assign(a, b) {
    for (var k in b) a[k] = b[k];
    return a;
  }

  // ── 5. Visibility (disclosure gating + search overlay) ─────────────────────

  var state = {
    visible: new Set(disclosure.initialVisibleIds),
    selected: null,
    query: "",
    kindEnabled: null, // filled after we know which kinds are present
  };

  /** Applies the current visible set to every primitive; then the search overlay + badges. */
  function applyVisibility() {
    for (var id in nodeEntries) {
      var entry = nodeEntries[id];
      var vis = state.visible.has(id);
      toggle(entry.el, "is-hidden", !vis);
      // Hidden nodes leave the tab order; visible ones are reachable by keyboard.
      entry.el.setAttribute("tabindex", vis ? "0" : "-1");
    }
    segmentEntries.forEach(function (s) {
      toggle(s.el, "is-hidden", !allVisible(s.gates));
    });
    blankEntries.forEach(function (b) {
      toggle(b.el, "is-hidden", !allVisible(b.gates));
    });
    noteEntries.forEach(function (nt) {
      toggle(nt.el, "is-hidden", !allVisible(nt.gates));
    });
    bundleEntries.forEach(function (bd) {
      // A bundle rect shows behind ANY visible member.
      var anyVisible = bd.members.some(function (m) {
        return state.visible.has(m);
      });
      toggle(bd.el, "is-hidden", !anyVisible);
    });
    applySearch();
    computeBadges();
  }

  function allVisible(gates) {
    for (var i = 0; i < gates.length; i++) {
      if (!state.visible.has(gates[i])) return false;
    }
    return true;
  }

  function toggle(el, cls, on) {
    if (on) el.classList.add(cls);
    else el.classList.remove(cls);
  }

  // ── 6. Disclosure engine ───────────────────────────────────────────────────

  var badgeEls = {};

  /** Rebuilds the hidden-neighbour count badges over every visible node that has some. */
  function computeBadges() {
    badgeLayer.textContent = "";
    badgeEls = {};
    state.visible.forEach(function (id) {
      var neighbors = adjacency[id];
      if (!neighbors) return;
      var hidden = 0;
      neighbors.forEach(function (nb) {
        if (!state.visible.has(nb)) hidden++;
      });
      if (hidden === 0) return;
      var node = nodeById[id];
      var bx = node.box.x + node.box.width / 2;
      var by = node.box.y - node.box.height / 2;
      var badge = svg("g", { class: "prov-badge", "data-node": id, tabindex: "0", role: "button", "aria-label": hidden + " hidden neighbors of " + node.qualifiedName });
      badge.appendChild(svg("circle", { cx: bx, cy: by, r: 9 }));
      badge.appendChild(svg("text", { x: bx, y: by }, "+" + hidden));
      badge.addEventListener("click", function (ev) {
        ev.stopPropagation();
        expand(id);
      });
      badge.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          expand(id);
        }
      });
      badgeLayer.appendChild(badge);
      badgeEls[id] = badge;
    });
  }

  /**
   * Reveals up to EXPAND_CAP of a node's still-hidden neighbours — nearest hop, taken in
   * scene order — then re-fits the view. The cap is what keeps a super-hub explorable: one
   * click adds at most EXPAND_CAP nodes and computeBadges then recomputes the badge to the
   * remaining hidden count, so a 141-neighbour hub is opened in steps rather than at once.
   */
  function expand(id) {
    var neighbors = adjacency[id];
    if (neighbors) {
      var added = 0;
      // Iterate scene.nodes (not the adjacency Set) so the admitted neighbours are the FIRST
      // EXPAND_CAP in deterministic scene order, matching the generator's initial-set rule.
      for (var i = 0; i < scene.nodes.length && added < EXPAND_CAP; i++) {
        var nb = scene.nodes[i].id;
        if (nb !== id && neighbors.has(nb) && !state.visible.has(nb)) {
          state.visible.add(nb);
          added++;
        }
      }
    }
    state.visible.add(id);
    applyVisibility();
    fitToVisible(true);
  }

  /**
   * Collapses a node's expansion: re-hides its EXCLUSIVE frontier — neighbours that are
   * only reachable through this node (their sole visible connection is `id`). The node
   * itself stays visible. Neighbours that another visible node also holds open remain.
   */
  function collapse(id) {
    var neighbors = adjacency[id];
    if (!neighbors) return;
    var toHide = [];
    neighbors.forEach(function (nb) {
      if (nb === id || !state.visible.has(nb)) return;
      var exclusive = true;
      adjacency[nb].forEach(function (m) {
        if (m !== id && state.visible.has(m)) exclusive = false;
      });
      if (exclusive) toHide.push(nb);
    });
    toHide.forEach(function (nb) {
      state.visible.delete(nb);
    });
    applyVisibility();
    dropSelectionIfHidden();
    fitToVisible(true);
  }

  /**
   * Invariant: the panel only ever describes a VISIBLE node. When a collapse or reset hides
   * nodes, the current selection may vanish from the canvas — if it did, clear it and close the
   * panel so the panel never lingers describing a node the reader can no longer see.
   */
  function dropSelectionIfHidden() {
    if (state.selected !== null && !state.visible.has(state.selected)) clearSelection();
  }

  function showAll() {
    scene.nodes.forEach(function (n) {
      state.visible.add(n.id);
    });
    applyVisibility();
    fitToVisible(true);
  }

  function reset() {
    state.visible = new Set(disclosure.initialVisibleIds);
    applyVisibility();
    dropSelectionIfHidden();
    fitToVisible(true);
  }

  // ── 7. viewBox (rAF easing + fit) ──────────────────────────────────────────

  var view = { x: 0, y: 0, w: 1, h: 1 };
  var anim = null;

  function setViewBox(x, y, w, h) {
    view.x = x;
    view.y = y;
    view.w = w;
    view.h = h;
    svgRoot.setAttribute("viewBox", x + " " + y + " " + w + " " + h);
  }

  function cancelAnim() {
    if (anim !== null) {
      cancelAnimationFrame(anim);
      anim = null;
    }
  }

  /** Eases the viewBox from its current value to a target — viewBox can't be CSS-transitioned. */
  function animateViewBox(tx, ty, tw, th, duration) {
    cancelAnim();
    var sx = view.x, sy = view.y, sw = view.w, sh = view.h;
    var start = null;
    var dur = duration || 380;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / dur);
      // easeInOutCubic — calm, no overshoot.
      var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setViewBox(sx + (tx - sx) * e, sy + (ty - sy) * e, sw + (tw - sw) * e, sh + (th - sh) * e);
      if (t < 1) anim = requestAnimationFrame(step);
      else anim = null;
    }
    anim = requestAnimationFrame(step);
  }

  /** The bounding box of the currently visible nodes (their glyph boxes), or the whole scene. */
  function visibleBounds() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    state.visible.forEach(function (id) {
      var n = nodeById[id];
      if (!n) return;
      any = true;
      minX = Math.min(minX, n.box.x - n.box.width / 2);
      minY = Math.min(minY, n.box.y - n.box.height / 2);
      maxX = Math.max(maxX, n.box.x + n.box.width / 2);
      maxY = Math.max(maxY, n.box.y + n.box.height / 2);
    });
    if (!any) {
      return { x: 0, y: 0, w: Math.max(1, scene.width), h: Math.max(1, scene.height) };
    }
    var padX = Math.max(24, (maxX - minX) * 0.08);
    var padY = Math.max(24, (maxY - minY) * 0.08);
    return { x: minX - padX, y: minY - padY, w: maxX - minX + 2 * padX, h: maxY - minY + 2 * padY };
  }

  function fitToVisible(animate) {
    var b = visibleBounds();
    if (animate) animateViewBox(b.x, b.y, b.w, b.h);
    else setViewBox(b.x, b.y, b.w, b.h);
  }

  /** Centres the view on one node at the current zoom level (used by search + selection). */
  function focusNode(id, animate) {
    var n = nodeById[id];
    if (!n) return;
    var w = view.w, hh = view.h;
    var tx = n.box.x - w / 2;
    var ty = n.box.y - hh / 2;
    if (animate) animateViewBox(tx, ty, w, hh);
    else setViewBox(tx, ty, w, hh);
  }

  // ── 8. Interactions: pan, zoom, select, keyboard ───────────────────────────

  var pan = null;

  canvas.addEventListener("pointerdown", function (ev) {
    // Node/badge interactions own their target; only a drag on empty canvas pans.
    if (ev.target.closest && (ev.target.closest(".prov-node") || ev.target.closest(".prov-badge"))) return;
    cancelAnim();
    pan = {
      startX: ev.clientX,
      startY: ev.clientY,
      vbX: view.x,
      vbY: view.y,
      moved: false,
      pointerId: ev.pointerId,
    };
    svgRoot.classList.add("is-panning");
    canvas.setPointerCapture(ev.pointerId);
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (pan === null) return;
    var rect = canvas.getBoundingClientRect();
    // Convert the pixel drag into scene units so the point under the cursor tracks it 1:1.
    var scaleX = view.w / rect.width;
    var scaleY = view.h / rect.height;
    var dx = (ev.clientX - pan.startX) * scaleX;
    var dy = (ev.clientY - pan.startY) * scaleY;
    if (Math.abs(ev.clientX - pan.startX) + Math.abs(ev.clientY - pan.startY) > 3) pan.moved = true;
    setViewBox(pan.vbX - dx, pan.vbY - dy, view.w, view.h);
  });

  function endPan(ev) {
    if (pan === null) return;
    var wasClick = !pan.moved;
    try {
      canvas.releasePointerCapture(pan.pointerId);
    } catch (e) {
      // Capture may already be gone (pointercancel); ignore.
    }
    pan = null;
    svgRoot.classList.remove("is-panning");
    // A click (no drag) on empty canvas deselects.
    if (wasClick && ev && ev.target && !(ev.target.closest && ev.target.closest(".prov-node"))) {
      clearSelection();
    }
  }
  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);

  canvas.addEventListener(
    "wheel",
    function (ev) {
      ev.preventDefault();
      cancelAnim();
      var rect = canvas.getBoundingClientRect();
      // The scene point under the cursor must stay fixed as we scale — cursor-anchored zoom.
      var cx = view.x + ((ev.clientX - rect.left) / rect.width) * view.w;
      var cy = view.y + ((ev.clientY - rect.top) / rect.height) * view.h;
      var factor = ev.deltaY > 0 ? 1.12 : 1 / 1.12;
      var newW = clamp(view.w * factor, scene.width ? scene.width / 5000 : 1, Math.max(scene.width, scene.height, 1) * 12);
      var newH = view.h * (newW / view.w);
      var nx = cx - ((ev.clientX - rect.left) / rect.width) * newW;
      var ny = cy - ((ev.clientY - rect.top) / rect.height) * newH;
      setViewBox(nx, ny, newW, newH);
    },
    { passive: false },
  );

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Node selection: click or Enter opens the panel.
  nodeLayer.addEventListener("click", function (ev) {
    var g = ev.target.closest(".prov-node");
    if (!g) return;
    select(g.getAttribute("data-id"));
  });
  nodeLayer.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    var g = ev.target.closest(".prov-node");
    if (!g) return;
    ev.preventDefault();
    select(g.getAttribute("data-id"));
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") clearSelection();
  });

  function select(id) {
    if (!nodeById[id]) return;
    state.selected = id;
    for (var nid in nodeEntries) {
      toggle(nodeEntries[nid].el, "is-selected", nid === id);
    }
    showPanel(id);
  }

  function clearSelection() {
    state.selected = null;
    for (var nid in nodeEntries) {
      toggle(nodeEntries[nid].el, "is-selected", false);
    }
    hidePanel();
  }

  // ── 9. Panel, search, controls, init ───────────────────────────────────────

  var panel = document.getElementById("prov-panel");

  function showPanel(id) {
    var n = nodeById[id];
    panel.textContent = "";

    var head = h("div", { class: "panel-head" }, [
      h("h2", { class: "panel-title", text: n.qualifiedName }),
      h("button", { class: "panel-close", type: "button", "aria-label": "Close details", text: "×" }),
    ]);
    head.querySelector(".panel-close").addEventListener("click", clearSelection);
    panel.appendChild(head);

    // Kind chip, coloured with the node's OWN themed fill/stroke (the visual language),
    // not a chrome colour.
    var chip = h("span", { class: "kind-chip", text: n.inferred ? n.kind + " (inferred)" : n.kind });
    chip.style.background = n.fill;
    if (n.stroke) chip.style.borderColor = n.stroke;
    panel.appendChild(chip);

    if (n.uri) {
      // Defense in depth: the payload is scheme-filtered at generation, but re-check before
      // making a live link. A filtered URI is shown as plain text so the reader still sees it.
      var safeUri = safeLinkUri(n.uri);
      panel.appendChild(
        safeUri
          ? h("a", { class: "panel-uri", href: safeUri, text: n.uri, target: "_blank", rel: "noopener noreferrer" })
          : h("span", { class: "panel-uri", text: n.uri }),
      );
    }

    panel.appendChild(h("p", { class: "panel-degree", text: "Degree: " + degreeOf(id) + " · " + adjacency[id].size + " neighbors" }));

    // Expand / collapse disclosure actions.
    var actions = h("div", { class: "panel-actions" }, [
      h("button", { type: "button", "data-act": "expand", text: "Expand neighbors" }),
      h("button", { type: "button", "data-act": "collapse", text: "Collapse" }),
    ]);
    actions.querySelector('[data-act="expand"]').addEventListener("click", function () {
      expand(id);
    });
    actions.querySelector('[data-act="collapse"]').addEventListener("click", function () {
      collapse(id);
    });
    panel.appendChild(actions);

    // Attribute table.
    if (n.attributes.length === 0) {
      panel.appendChild(h("p", { class: "attr-empty", text: "No attributes." }));
    } else {
      var rows = n.attributes.map(function (a) {
        // Defense in depth (see safeLinkUri): link the value only when its URI scheme is
        // allowlisted; otherwise the value renders as plain text, never a hostile-scheme link.
        var safeValueUri = a.valueUri ? safeLinkUri(a.valueUri) : undefined;
        var valueCell = safeValueUri
          ? h("td", null, h("a", { href: safeValueUri, text: a.value, target: "_blank", rel: "noopener noreferrer" }))
          : h("td", { text: a.value });
        return h("tr", null, [h("th", { scope: "row", text: a.name }), valueCell]);
      });
      var table = h("table", { class: "attr-table" }, [
        h("caption", { text: "Attributes" }),
        h("tbody", null, rows),
      ]);
      panel.appendChild(table);
    }

    panel.hidden = false;
  }

  function hidePanel() {
    panel.hidden = true;
    panel.textContent = "";
  }

  // Search + kind filter.
  var searchInput = document.getElementById("prov-search");
  var kindFiltersBox = document.getElementById("prov-kind-filters");

  // Only offer filters for kinds actually present, in a stable order.
  var KIND_ORDER = ["entity", "activity", "agent", "bundle", "unknown"];
  var presentKinds = KIND_ORDER.filter(function (k) {
    return scene.nodes.some(function (n) {
      return n.kind === k;
    });
  });
  state.kindEnabled = new Set(presentKinds);

  presentKinds.forEach(function (k) {
    var style = theme.nodes[k] || theme.generic[k];
    var swatch = h("span", { class: "swatch" });
    swatch.style.background = style ? style.fill : "#cccccc";
    var cb = h("input", { type: "checkbox", checked: "checked", "data-kind": k });
    cb.checked = true;
    cb.addEventListener("change", function () {
      if (cb.checked) state.kindEnabled.add(k);
      else state.kindEnabled.delete(k);
      applySearch();
    });
    var label = h("label", { class: "kind-filter" }, [cb, swatch, h("span", { text: k })]);
    kindFiltersBox.appendChild(label);
  });

  function matchesQuery(n) {
    if (state.query === "") return true;
    var q = state.query;
    return n.qualifiedName.toLowerCase().indexOf(q) !== -1 || n.label.toLowerCase().indexOf(q) !== -1;
  }
  function passesKind(n) {
    return state.kindEnabled.has(n.kind);
  }

  /** Highlights hits and dims the rest whenever a query or a kind filter is active. */
  function applySearch() {
    var activeQuery = state.query !== "";
    var activeFilter = state.kindEnabled.size < presentKinds.length;
    var active = activeQuery || activeFilter;
    scene.nodes.forEach(function (n) {
      var el = nodeEntries[n.id].el;
      if (!active) {
        el.classList.remove("is-match");
        el.classList.remove("is-dimmed");
        return;
      }
      var hit = matchesQuery(n) && passesKind(n);
      // Only a real query earns the highlight glow; a kind-only filter merely dims.
      toggle(el, "is-match", hit && activeQuery);
      toggle(el, "is-dimmed", !hit);
    });
  }

  searchInput.addEventListener("input", function () {
    state.query = searchInput.value.trim().toLowerCase();
    applySearch();
  });
  searchInput.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    // Enter jumps to the first hit in document order, revealing it if disclosure hid it.
    var first = scene.nodes.find(function (n) {
      return matchesQuery(n) && passesKind(n);
    });
    if (!first) return;
    if (!state.visible.has(first.id)) {
      state.visible.add(first.id);
      applyVisibility();
    }
    select(first.id);
    focusNode(first.id, true);
  });

  document.getElementById("prov-show-all").addEventListener("click", showAll);
  document.getElementById("prov-reset").addEventListener("click", reset);

  // Counts line.
  var c = meta.counts;
  document.getElementById("prov-counts").textContent =
    c.nodes + " nodes · " + c.edges + " edges" +
    (c.bundles ? " · " + c.bundles + " bundles" : "") +
    (c.skipped ? " · " + c.skipped + " skipped" : "");

  // ── Init ───────────────────────────────────────────────────────────────────

  applyVisibility();
  fitToVisible(false);
})();
