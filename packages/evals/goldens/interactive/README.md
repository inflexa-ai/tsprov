# Interactive HTML goldens

Committed output for `@inflexa-ai/tsprov-render-interactive` over the 13 curated fixtures
in `../../fixtures/curated/`, rendered under the per-fixture options in
`../../fixtures/curated/render-options.json`. Two kinds of golden, split so a template
change touches ONE file, not thirteen:

- **`<name>.json`** (×13) — the embedded **positioned scene payload** (`buildScenePayload`
  pretty-printed): the JSON the client reads from `#prov-scene`. This is where
  document-specific behavior lives — the dagre geometry, the projected theme, the
  precomputed disclosure set. A template edit does NOT touch these.
- **`primer-triangle.html`** (×1) — the **entire emitted HTML document**, byte-compared, so
  the template envelope (shell + inline style + inline app + the `<`-escaped payload embed)
  is covered exactly once.

The eval (`../../interactive.test.ts`) byte-compares current output against these files, so
any change — a dagre coordinate shift, a theme tweak, a template edit — turns a golden red
and forces a **reviewed** regeneration:

```sh
TSPROV_EVAL_REGEN=1 bun test packages/evals/interactive.test.ts
```

## These are snapshots, not a Python oracle

The interactive renderer is a **novel** artifact — `prov` ships no HTML viewer — so these
goldens are OUR own output, reviewed once at introduction. Validity is enforced
**structurally**, not by a foreign oracle:

- the corpus sweep in `../../interactive.test.ts` renders every one of the 401 documents and
  checks each for no-throw, **double-render determinism**, **self-containment** (the chrome
  — shell + style + app, with the JSON data payload removed — contains no `src=`, `<link>`,
  `@import`, remote `url(…)`, `fetch`/XHR/WebSocket/EventSource/`import()` — the formalized
  interpretation: anchor `href`s to entity URIs are DATA, not resource loads, and stay), and
  a full **payload round-trip** (the embedded JSON parses, carries no un-escaped `</script>`,
  is canonical, and equals the payload the emitter built); and
- the layout geometry itself is the render-svg seam, already cross-checked against the SVG
  goldens and the theme.

## Self-containment interpretation

A page is "self-contained" when it loads **no external resource**: no script/style/font/image
fetched over the network, no `fetch`/XHR/WebSocket. Anchor `href`s pointing at entity URIs
(the PROV identifiers) are optional navigation *data* — the file is fully functional offline
without them — so they are explicitly allowed. The eval forbids the resource-load tokens and
ignores `href`.

## Payload highlights confirmed by review (one-time, at introduction)

- `primer-triangle.json` — the three reference glyphs baked as data: `entity/ellipse/#FFFC87`,
  `activity/rect/#9FB1FC`, `agent/house/#FED37F`; edges `prov:Generation` / `prov:Association`
  / `prov:Attribution`; two arrowhead marker colors (`darkgreen`, `#FED37F`); `wholeGraph:true`
  disclosure (3 ≤ 50) with all three ids initially visible. `theme.relations["prov:Usage"]`
  carries `color:"#8B0000"` — the Graphviz-only `red4` projected to hex, exactly as the SVG
  emitter projects it.
- `start1.json` — the D15 all-skipped case: `nodes: 0`, `width/height: 0`, empty initial
  visible set, `focusId: null` — an honest empty scene.
- `annotated-*` / `nary-derivation` — the folded-corner note rows and the join-circle segments
  (D18) carry `gates` naming the endpoints that must be visible for them to show.
- `bundle1` / `bundle2` — bundle rects carry their id/label and the enclosing `rect`.
- `uselabels` — two-line `labelLines` (`prov:label` over the identifier).

## Payload carries only client-read fields, and every link URI is scheme-safe

The payload is intentionally lean: it embeds only the fields `template/app.js` actually reads.
The edge's own `relation`/`label` and each n-ary leg's `role` are omitted (the drawn label lives
on the segment; the client walks edges purely for adjacency), as are `bundle.uri`, `meta.title`,
and `meta.options` (unread by the client) — so an edge is `{id, source, target, naryLegs:[{target}]}`,
a bundle is `{id, label, rect}`, and `meta` is `{counts, disclosure}`.

Every URI a golden carries in a `uri`/`valueUri` field is one that passed render-core's
`safeLinkUri` allowlist (`http`/`https`/`mailto`, or scheme-less): a hostile-scheme identifier
(`javascript:`/`data:`) never reaches the payload, so it can never become a live `href` in the
shipped page (see D21 and `../../link-scheme.test.ts`). No golden contains a non-allowlisted
scheme, so a reviewed regeneration cannot silently introduce one.

**Do not hand-edit a golden.** If output changes, fix the emitter/template (never the golden),
regenerate under `render-options.json`, and re-review the diff.

## Browser gate (one-time behavioral pass)

The renderer's *animated* behavior is proven once, at introduction, by a scripted browser
pass over the generated **prov-inflexa.2** page (151 nodes / 487 edges). The Playwright MCP blocks
`file://`, and the page is provably self-contained (zero network requests — the corpus eval
enforces it), so it was served byte-for-byte over `http://localhost` — a behaviorally
equivalent load of the exact same bytes. Screenshots are archived with the session. Result:

| Check | Expected | Observed |
| --- | --- | --- |
| DOM built from payload | 151 node groups | **151** |
| Initial disclosure (rule, NOT all 151) | focus + 2-hop < 151 | **145 visible / 6 hidden**; focus `inflexa:agent-system` (n102) |
| Hidden-neighbor badges present | ≥ 1 | **1** ("+4 hidden neighbors of inflexa:analysis-…") |
| Expand a badge reveals neighbors | +4 revealed | click → **145 → 149 visible**, hidden 6 → 2, badges recomputed 1 → 3 |
| Click a node opens the panel | qName, kind, URI, attrs, degree, expand/collapse | panel shows `inflexa:analysis-…`, chip **entity**, URI link, **Degree: 100**, **3 attribute rows** (`prov:type = inflexa:Analysis`, `inflexa:name = GSE78220`, `inflexa:slug = gse78220`), Expand/Collapse buttons |
| Search highlights matches / dims others | matches highlighted, rest dimmed | query `agent` → **3 `is-match`, 148 `is-dimmed`** (3 + 148 = 151) |
| Enter focuses first match | first match selected | **`inflexa:agent-anonymous`** selected, panel updated (chip **agent**) |
| Console errors | 0 | **0** (fresh load; the browser's automatic `/favicon.ico` probe — absent under `file://` — was answered 204 by the static server so it never reached the console) |

**Note on prov-inflexa.2's disclosure:** the highest-degree node (`inflexa:agent-system`) is a
**141-degree super-hub** — directly connected to 141 of the 151 nodes — so the faithful
"focus + 2-hop" rule reveals 145/151 for THIS document. That is the rule working as
specified on a hub-shaped graph, not a defect: the synthetic 60-node chain in the in-package
tests discloses a small local neighborhood exactly as intended. The rule was implemented
verbatim (highest-degree default, 2 hops, ≤ 50 whole-graph), not tuned to the fixture. A
`focus` option or a lower-degree center yields a tighter initial set.
