# Releasing tsprov

How tsprov gets from a merged PR to an installable package. Releases are cut **from `main`
only**, by CI. There is no manual `npm publish`, no manual tagging, and no long-lived npm
token anywhere in the repo — after the one-time setup below, a release is just a PR that
bumps the version.

## The model

[`.github/workflows/release.yml`](./.github/workflows/release.yml) runs on every push to
`main` and is **version-gated**: it compares `package.json`'s `version` against the npm
registry. If that version is already published, the run is a no-op (so doc-only merges cost
nothing). If it is new, the workflow:

1. builds (`bun run build`) and smoke-tests the artifacts under Node (`bun run smoke`),
2. publishes to npmjs.org via **trusted publishing** (OIDC) with **provenance attestations**,
3. creates the `vX.Y.Z` tag and a **GitHub Release** whose notes are the matching
   `CHANGELOG.md` section.

Each mutating step has its own existence check, so a partially-failed run can be re-run
(also manually, via *Actions → Release → Run workflow*): whatever already happened is
skipped, whatever is missing executes.

**Why this shape.** Trusted publishing means there is no `NPM_TOKEN` secret to leak, rotate,
or exfiltrate — npmjs.com trusts this exact repo + workflow file and mints a short-lived
credential per run; provenance comes with it for free, so consumers can verify every version
was built here by CI. The version-gate (rather than tag-triggered releases or a release bot)
keeps the process inside the normal PR flow with zero extra dependencies —
[release-please](https://github.com/googleapis/release-please) and
[changesets](https://github.com/changesets/changesets) were considered and set aside as
process overhead for a single-package repo; either can be adopted later without changing the
package itself.

---

## One-time setup (do these in order)

### 1. Make the repository public

Provenance attestations require a public repository (the attestation links to the source
commit and workflow on the public transparency log). Do this first; the pre-publication
checklist is short since the community files (LICENSE, NOTICE, SECURITY.md, CONTRIBUTING.md,
CODE_OF_CONDUCT.md, GOVERNANCE.md, CITATION.cff) already exist:

- [ ] Scan history for secrets before flipping the switch (e.g. `gh secret list` is not it —
      history is: `git log -p | grep -iE 'token|apikey|password'` or a proper scanner like
      `gitleaks`). History becomes public along with the tree.
- [ ] GitHub → repo → *Settings → General → Danger Zone → Change visibility → Public*.
- [ ] Enable *Settings → Code security*: secret scanning, push protection, and Dependabot
      alerts (all free for public repos).

### 2. Protect `main`

The release workflow trusts `main`; make `main` worth trusting. GitHub → *Settings → Rules →
Rulesets → New branch ruleset* targeting `main`:

- [ ] Require a pull request before merging (no direct pushes).
- [ ] Require status checks: **`test`** (from `test.yml`) and **`DCO`** (from `dco.yml`).
- [ ] Block force pushes and deletions (on by default in rulesets).
- [ ] Optionally add a tag ruleset restricting `v*` tag creation to maintainers — the
      workflow creates tags with the repo-scoped `GITHUB_TOKEN`, which rulesets can exempt
      via bypass for the Actions role if needed.

### 3. Create the npm scope and the package

- [ ] Create an npmjs.com account (or use an existing one) with **2FA enabled**.
- [ ] Create the **`inflexa-ai` organization** on npmjs.com (*Add Organization*, free plan —
      public packages only). The org name must match the `@inflexa-ai/` scope exactly.
- [ ] Preferred path: the org's *Packages* page offers **+ Add Package**, which pre-registers
      the trusted-publisher connection for a package that does not exist yet (fill it as in
      step 4). If that completes, CI performs the very first publish too — skip the local
      publish below and go to step 4's access settings.
- [ ] Fallback (only if pre-registration is unavailable): publish once manually so the
      package exists, then configure the trusted publisher on it.
- [ ] Check that no `.npmrc` reroutes the scope: `npm config get @inflexa-ai:registry` must
      print `undefined`. A leftover `@inflexa-ai:registry=https://npm.pkg.github.com` line
      (project or `~/.npmrc`, from the GitHub-Packages era) silently wins over
      `publishConfig.registry` and sends the publish to the wrong registry.
- [ ] From a clean checkout of `main`:

  ```bash
  npm login                 # authenticates the browser flow
  bun install --frozen-lockfile
  cd packages/tsprov && npm publish   # prepublishOnly runs the build + smoke test for you
  ```

  The publish runs from `packages/tsprov` because the repo root is a private workspace
  root and only that member is publishable. `publishConfig` in
  `packages/tsprov/package.json` already pins the public registry and `--access public`
  (scoped packages default to private, which the free org plan would reject).
- [ ] Verify: `npm view @inflexa-ai/tsprov` shows the version, and
      `npm install @inflexa-ai/tsprov` works in a scratch directory with **no** `.npmrc`.

### 4. Configure trusted publishing on npmjs.com

npmjs.com → package page → *Settings → Trusted Publisher → GitHub Actions*:

- [ ] **Organization or user**: `inflexa-ai`
- [ ] **Repository**: `tsprov`
- [ ] **Workflow filename**: `release.yml` — this must match the file name in
      `.github/workflows/` exactly; renaming the workflow later breaks publishing until
      this field is updated.
- [ ] **Environment**: leave empty (see [Hardening](#optional-hardening) for when to set it).
      Setting a name here while the workflow job has no matching `environment:` key makes
      npm reject every CI publish.
- [ ] **Allowed actions**: check *Allow `npm publish`* only — the workflow runs plain
      `npm publish`; the staged-publish flow is unused, and an unchecked box is one less
      thing this trust grant can do.

While in package settings, also:

- [ ] Set *Publishing access* to **Require two-factor authentication or an automation or
      granular access token** — or, stricter, disallow tokens entirely so trusted publishing
      is the *only* path.

### 5. Merge this change and watch the first automated release

- [ ] Merge the PR that adds `release.yml` (with a version bump, e.g. `0.6.0`, and its
      CHANGELOG section — see the recipe below).
- [ ] Watch *Actions → Release*: it should publish, then create tag + GitHub Release.
- [ ] Verify the npm package page shows the green **provenance** checkmark, and the GitHub
      *Releases* sidebar shows `v0.6.0` with the changelog notes.

### 6. Retire the GitHub Packages copies (optional cleanup)

Old versions published to `npm.pkg.github.com` remain visible on the repo sidebar. Either
delete them (repo → *Packages* → package → *Package settings* → delete versions) or leave
them — nothing references that registry anymore. Deleting avoids "which registry?" confusion
for new users.

---

## Publishing the rendering packages

The five `@inflexa-ai/tsprov-render-*` packages under `rendering/` are **not** wired into
`release.yml` (which publishes only `packages/tsprov`) — publish them manually, the same way as
the core's first publish in step 3 above. Each one carries a `prepack` script, so both
`npm publish` and `bun pm pack` **build `dist/` automatically** from a clean checkout (verified:
`bun pm pack` runs `prepack` in bun 1.3.14) — there is no separate build step to remember, and a
stale or gitignored `dist/` can never ship.

Publish **in dependency (topological) order** — each package's sibling dependency must already
be on the registry when the next one goes up:

1. **`tsprov-render-core`** — the foundation; depends on nothing but the `tsprov` peer.
2. **`tsprov-render-dot`**, **`tsprov-render-mermaid`**, **`tsprov-render-svg`** — each takes
   `render-core` as a regular dependency (any order among the three).
3. **`tsprov-render-interactive`** — **last**, because it depends on `render-svg` (the layout
   seam) in addition to `render-core`.

```bash
for pkg in tsprov-render-core \
           tsprov-render-dot tsprov-render-mermaid tsprov-render-svg \
           tsprov-render-interactive; do
  ( cd "rendering/$pkg" && npm publish )   # prepack builds dist/ for you; enter the OTP per package
done
```

Each rendering `package.json` already pins `publishConfig` (public registry, `--access public`)
and ships its own `LICENSE` + `NOTICE`. As with the core, wire up a per-package trusted publisher
afterward if you want CI to cut their subsequent releases.

---

## Cutting a release (the recurring part)

1. **Branch** from `main`.
2. **Bump `version`** in `packages/tsprov/package.json` — [semver](https://semver.org/): breaking API change
   → major (pre-1.0: minor), new feature → minor, fix → patch.
3. **Sync the citation metadata**: run `.github/citation/sync.sh` and commit the rewritten
   `CITATION.cff` in the same commit as the bump. The `test` check fails any PR where
   `CITATION.cff`'s `version` is out of step with `packages/tsprov/package.json`, and same-commit placement
   is what keeps the tagged tree correct — Zenodo archives `CITATION.cff` at the tag's ref,
   and `release.yml` deliberately does not sync it (the workflow operates at the released
   commit; syncing there would either tag a stale file or push an unreviewed commit to
   protected `main`).
4. **Update `CHANGELOG.md`**: move the relevant `[Unreleased]` content into a new
   `## [X.Y.Z] — YYYY-MM-DD` section. The release workflow lifts this exact section into the
   GitHub Release notes, so write it for consumers.
5. **PR → review → merge.** Sign off your commits (`git commit -s`); the DCO check requires it.
6. **CI does the rest.** Nothing to run, nothing to tag. Verify the release as in step 5
   above.

### If something goes wrong

- **The run failed before `npm publish`** (build, smoke): fix forward with a normal PR; the
  next push to `main` picks the same version up again.
- **The run failed between publish and the release step**: re-run the workflow (or wait for
  the next push) — the npm step skips, the tag/release step completes. This is why the two
  gates are independent.
- **A bad version reached npm**: npm versions are immutable — you cannot re-publish
  `X.Y.Z`. `npm deprecate @inflexa-ai/tsprov@X.Y.Z "reason"` it, then release a fixed
  `X.Y.Z+1`. (`npm unpublish` is only allowed within 72h and breaks downstreams; prefer
  deprecate.)
- **Nothing happened on merge**: almost always "the version on `main` is already published"
  — the run's *Check whether this version is already on npm* step says so explicitly.
- **"You cannot publish over the previously published versions" but npmjs doesn't have that
  version**: the publish was routed to a different registry by an `@inflexa-ai:registry`
  scope mapping in some `.npmrc` — scope mappings beat `publishConfig.registry`. Diagnose
  with `npm config get @inflexa-ai:registry` (must be `undefined`) and check the `PUT`/`GET`
  URL in the npm debug log it points you to.

## Optional hardening

Worth doing once releases are routine:

- **GitHub environment gate.** Create an environment named `release` with required
  reviewers, set `environment: release` on the job in `release.yml`, and put `release` in
  the npm trusted-publisher *Environment* field. Publishing then requires a human approval
  click per release, and npm rejects OIDC tokens minted outside that environment.
- **`npm audit signatures`** in `test.yml` to verify the integrity of installed
  dependencies' registry signatures.
