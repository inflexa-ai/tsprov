#!/usr/bin/env python3
"""Generate reference DOT goldens from the vendored Python ``prov`` library.

This is a ONE-TIME, run-by-hand generator: it reads every PROV-JSON fixture in
``packages/evals/fixtures/curated/`` and writes the ``prov.dot.prov_to_dot``
output for each to ``packages/evals/goldens/python-dot/<name>.gv``. The goldens
are committed; the eval suite never runs Python — it compares the committed
goldens structurally against ``DotRenderer`` output.

Run it from the repository root with ``uv`` (Python is not otherwise required to
work in this repo). The vendored ``prov`` checkout is pip-installable, but its
serializer registry eagerly imports the XML and RDF serializers, so ``lxml`` and
``rdflib`` must be present even though we only deserialize JSON::

    uv run \
        --with pydot --with lxml --with rdflib \
        --with ./reference/prov \
        python packages/evals/scripts/generate-python-goldens.py

Versions used when the committed goldens were generated: prov (vendored checkout
at reference/prov, == 2.1.1.dev), pydot 4.0.1, Python 3.12. If the vendored
checkout ever stops installing, ``--with prov==2.1.1`` from PyPI produces the
same DOT (the ``prov.dot`` module is unchanged across 2.0.0–2.1.1); note which
route you used in the run log.

Regenerating goldens is a deliberate, reviewable act: the structural comparator
tolerates quoting / attribute-order / whitespace noise, so a pydot formatting
change does not require regeneration — only a genuine ``prov.dot`` behavior change
does.
"""

from __future__ import annotations

import json
from pathlib import Path

from prov.dot import prov_to_dot
from prov.model import ProvDocument

# ``prov_to_dot`` boolean parameter names keyed by the option keys used in
# fixtures/curated/render-options.json (the same keys DotRenderer's SceneOptions
# use, minus the camelCase→snake_case rename). ``direction`` maps straight through.
_BOOL_PARAM = {
    "useLabels": "use_labels",
    "showNary": "show_nary",
    "includeElementAttributes": "show_element_attributes",
    "includeRelationAttributes": "show_relation_attributes",
}

_REPO_ROOT = Path(__file__).resolve().parents[3]
_CURATED_DIR = _REPO_ROOT / "rendering" / "evals" / "fixtures" / "curated"
_GOLDEN_DIR = _REPO_ROOT / "rendering" / "evals" / "goldens" / "python-dot"
_OPTIONS_FILE = _CURATED_DIR / "render-options.json"


def _load_options() -> dict[str, dict[str, object]]:
    data = json.loads(_OPTIONS_FILE.read_text())
    # Drop the leading ``_comment`` documentation key; the rest are fixture entries.
    return {name: opts for name, opts in data.items() if not name.startswith("_")}


def _to_prov_kwargs(opts: dict[str, object]) -> dict[str, object]:
    kwargs: dict[str, object] = {}
    for key, value in opts.items():
        if key == "direction":
            kwargs["direction"] = value
        elif key in _BOOL_PARAM:
            kwargs[_BOOL_PARAM[key]] = value
        else:
            raise ValueError(f"unknown render option {key!r}")
    return kwargs


def main() -> None:
    options = _load_options()
    _GOLDEN_DIR.mkdir(parents=True, exist_ok=True)

    fixtures = sorted(_CURATED_DIR.glob("*.json"))
    # render-options.json is config, not a fixture.
    fixtures = [f for f in fixtures if f.name != "render-options.json"]
    if not fixtures:
        raise SystemExit(f"no curated fixtures found in {_CURATED_DIR}")

    for fixture in fixtures:
        name = fixture.stem
        doc = ProvDocument.deserialize(content=fixture.read_text(), format="json")
        dot = prov_to_dot(doc, **_to_prov_kwargs(options.get(name, {})))
        out = _GOLDEN_DIR / f"{name}.gv"
        # ``to_string`` already ends with a newline; write verbatim so re-runs are
        # byte-stable and diffs are minimal.
        out.write_text(dot.to_string())
        print(f"wrote {out.relative_to(_REPO_ROOT)}")


if __name__ == "__main__":
    main()
