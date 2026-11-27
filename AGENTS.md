# widget-overlay development instructions

## Working agreements

The organization maintains these agreements in the IronFlock `.github` repository at `.ai/working-agreements.md`.

- Check the branch and working tree before editing. On main/master, create a
  topic branch; otherwise keep the current branch. If another session owns
  the branch or has uncommitted edits, ask where this work belongs before editing.
  Do not create a worktree without explicit consent.
- Preserve other sessions' changes. Re-read a file immediately before changing
  it; do not overwrite a file that appeared after inspection.
- Commit or push only when Marko explicitly requests it for this piece of work.
  Do not amend, merge, rebase, tag, stash, or change remote settings implicitly.
  Never add attribution trailers or generated-by notices to Git messages or PRs.
- Production changes, releases, and registry pushes require explicit authorization
  for the exact action. Do not hide production mutations in validation recipes.
- Never print secret-file contents or copy credentials into project knowledge.
  Do not describe private signing-key whereabouts in public documentation.
- For code changes, add user-visible release notes for the version that will
  actually ship them, preserving existing entries. Documentation-only setup,
  tests, and invisible refactoring need no invented release-note entry.

## Shared knowledge

Store durable, verified project facts in the repository documentation; store task status and
remaining work in `docs/handoff.md`. Include evidence paths and distinguish
observations from assumptions. Shared files are reviewed repository content,
not an automatic mirror of either agent's private memory or chat history.

Skills live in `.agents/skills/`; `.claude/skills/` contains relative links to
those same folders. Edit the canonical skill, not a duplicate. Tool permissions,
credentials, hooks, and agent-specific runtime settings remain separate.

Read the relevant repository documentation when starting work. When resuming work, read the relevant
handoff and verify it against the current branch and files. Record checks
and remaining work there when handing a task to another developer or agent.

## Commands

- `npm start` - Vite dev server on port 8000, opens `/demo/` and rebuilds in watch mode in parallel.
- `npm run build` - Vite library build (ES module) emitting `dist/widget-overlay.js`.
- `npm run watch` - `vite build --watch` only.
- `just lint` — what the CI gate checks besides the build: regenerating the committed generated files (`npm run types`) changes nothing. `just build` = `npm run build`.
- `just merge` / `just release-patch` (`release-minor`, `release-major`) — pull requests into `main` from a feature branch with everything committed: a no-release one, or a release one whose merge publishes to npm in CI (`.github/workflows/build-publish.yml`), then the release GitHub App tags the bare version and creates the GitHub release. Never `npm publish`, tag or edit the version by hand.
- `npm run link` / `npm run unlink` — Build and `npm link` this package into the studio checkout at `../../studio` (the host app, `~/git/ironflock/studio`), or put the published package back there. Only studio's appliance build (`build:appliance`) reads the widget from `node_modules`: its dev server (`npm run dev`) already aliases `widget-overlay` to this checkout's `dist/` and serves its `src/*.json`, so `npm run watch` here is enough for dev. Studio tracks both `package-lock.json` and `bun.lock` (its Dockerfile runs `bun install --frozen-lockfile`), and `unlink` reinstalls with npm only: run `bun install` in studio as well if that moved the version.
- `npm test` - unit tests of `src/image-source.ts` (`test/*.test.mjs`, `node --test`; Node 24 loads the TypeScript source directly, so there is no test dependency). The CI gate skips unit tests (`skip: unit` in `.github/workflows/ci.yml`), so run them locally. No linter is configured.

Node `>=24.9.0` and npm `>=10.0.2` are required (see `engines`).

## Architecture

This repo produces a single Lit web component published as `@ironflock/widget-overlay`, consumed by IronFlock Studio, the board UI. It renders a background image (raster, SVG file, inline SVG, data URL, or base64) and overlays positioned data pins on top.

### Versioned custom element tag

The element is registered as `widget-overlay-versionplaceholder` (see `src/widget-overlay.ts` bottom). At build time, `@rollup/plugin-replace` (configured in `vite.config.ts`) substitutes the literal string `versionplaceholder` with `pkg.version`, producing a unique tag per release (e.g. `widget-overlay-1.0.10`). This lets the host platform load multiple versions side-by-side. The demo (`demo/index.html`) reproduces this by reading `package.json` and using `unsafeStatic` to construct the tag.

### Platform contract

The platform interacts with the widget via two Lit `@property` inputs only:

- `inputData: ImageOverlayConfiguration` - shape defined by `src/definition-schema.json` (the source of truth) and mirrored in `src/definition-schema.d.ts`. The JSON Schema is consumed by the IronFlock UI to render the widget configuration form; descriptions in it are written for AI agent readability and platform users alike.
- `theme: { theme_name, theme_object }` - the title colours are `var(--re-text-color, <theme value>)` chains (see `registerTheme()`), so the host property wins and a change to it repaints the tile live without the widget being told. The widget paints no background of its own: Studio's `widget-item` already paints `--re-tile-background-color` on the tile, and painting it again here composited a translucent tile colour twice (up to 1.0.14).

The widget dispatches no events.

### Definition schema is load-bearing

`src/definition-schema.json` drives the UI form on the platform side AND defines the TypeScript types via `json-schema-to-typescript`. `npm run types` regenerates `definition-schema.d.ts`. When changing data shape, edit the JSON Schema first, then regenerate the `.d.ts`. Properties use `order`, `condition` (relative-path conditional fields), and `dataDrivenDisabled` extensions understood by the platform's form renderer.

### Rendering pipeline

1. `transform()` turns `inputData.image` into an `ImageSource` with `imageSource()` (`src/image-source.ts`): inline `<svg>...</svg>`, `data:` URL, bare base64, absolute URL, or relative path. Every background is drawn by one `<img>`. Inline SVG markup is parsed by `DOMParser` (as HTML, so markup without `xmlns` or with unquoted attributes still works), serialised to standalone SVG XML and loaded as a `data:image/svg+xml` address; it is never inserted into the widget's DOM. An SVG drawn as an image runs no script and loads nothing from elsewhere, and its `<style>` stays inside the image. It also inherits nothing from the page: the root gets `font-family="sans-serif"` (the font it inherited from `:host` before) unless it sets one, while `currentColor` and `var(--…)` inside the SVG no longer pick up the tile's colours, and links and hover styles inside it don't react.
2. A `ResizeObserver` (observing in `connectedCallback()`, released in `disconnectedCallback()`, because Studio moves a tile by detaching and re-attaching it) plus image `@load` triggers `getModifier()`, which computes the visible image rect inside the container (`object-fit: contain` letterboxing). The intrinsic size is the inline SVG's viewBox when it has one (what the overlays were scaled against when it was drawn in place, and independent of the size each browser reports for an SVG image without width and height), otherwise the image's natural size. The result is a `Modifier` `{ scaler, xOffset, yOffset, visibleWidth, visibleHeight }`.
3. Each overlay layer is positioned absolutely using the modifier; pins use relative coords (`relXPos`, `relYPos` in 0-1) multiplied by `visibleWidth/Height` so pin positions remain anchored to image content as the widget resizes.
4. `sections.sectionLimits` + `sections.colors` drive threshold-based coloring for both text and progress overlays (`sectionColor()`). Progress percentage is normalized against `min(sectionLimits)`-`max(sectionLimits)`; without two different limits the bar stays empty.
5. Every part of a layer is optional: a layer without `sections` or `textStyle`, null list slots and pins without coordinates render (or are skipped) instead of throwing, which used to blank the tile. Layers are keyed by index and name, because two layers may share a name and duplicate `repeat()` keys corrupt Lit's DOM bookkeeping.

The internal progress element (`src/linear-progress.ts`) is a separate Lit element used only by progress layers; styling is driven via CSS custom properties (`--progress-color`, `--progress-width`, etc.). It is registered as `widget-overlay-progress-versionplaceholder`, versioned like the widget, because two versions of widget-overlay can be on one page and a second `define()` of the same name throws: up to 1.0.14 it was the unversioned `<linear-progress>`, which stopped a second version's bundle from loading.

### Build output

`vite.config.ts` builds a single ES module library entry (`src/widget-overlay.ts` -> `dist/widget-overlay.js`) with sourcemaps and a license banner. `lit` is external: studio's import map provides one copy for all widgets. The published package (`files` in `package.json`) ships `dist/`, `src/`, and `thumbnail.png` (used by the platform's widget gallery).

## `aiSelection` in `src/definition-schema.json`

The schema root carries an `aiSelection` block next to `title` and `description`. It is **not** JSON Schema and describes no config field — it exists so the IronFlock AI's Widget Builder can pick the right widget for a given shape of data, using knowledge only the widget author has:

```jsonc
"aiSelection": {
  "dataShape": "…what columns this widget consumes and what each one means…",
  "useWhen":   ["…a situation, naming the properties that express it…"],
  "notFor":    ["…a situation this widget is wrong for, naming the widget to use instead…"]
}
```

It is inert everywhere else, and must stay that way: `json2ts` ignores it (the generated `.d.ts` is byte-identical with and without it), the dashboard config editor renders only `schema.properties`, and the AI service's `validate_widget` validates *configs* against the schema, skipping unknown Draft-7 keywords.

When maintaining it:

- `notFor` is the high-value half and the part plain descriptions always omit. Every entry must name the widget that *should* be used, or it rejects without routing.
- Write for an LLM with no other documentation: describe the visible result and the user's intent, not the implementation.
- Prefer entries that discriminate against a *neighbouring* widget. Generic rejections are cheap; the ones that pay are those an author could plausibly get wrong.
- The `notFor` lists are a set across all `widget-*` repos and are meant to be reciprocal — if this widget routes to another for some case, that widget should usually route back for the converse. Changing one side is a cue to check the other.
- Update it whenever a property changes what this widget can *do*, not just how it looks.
