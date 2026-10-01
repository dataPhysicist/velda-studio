# Velda Studio

Remodel design by conversation. One measured 3D model of the house that you change by describing what you want and by adding photos you like. Every change is a version you can step back to. It runs as a [Toolbelt](https://apexti.com) app page on the Velda assistant.

Built on the MIT-licensed [Pascal editor](https://github.com/pascalorg/editor) packages (`@pascal-app/*` 1.0.3): Pascal's 3D viewer and node renderers draw the house. Pascal's editing interface is not used.

## How it works

- **The Studio model** (`src/lib/model.ts`) is the source of truth: levels, walls with doors and windows, rooms, fixtures and cabinet runs, and the themes the scheme uses, all in inches in the plan frame (x right, y down the sheet). It is small (about 20 KB) and every version stores a full copy.
- **Compile** (`src/lib/compile.ts`) turns the model into a Pascal scene in meters. Cabinet runs become Pascal modular cabinets, and a sink, range, cooktop or dishwasher inside a run's footprint becomes a module of that run. Theme roles (walls, trim, cabinets, island, counters, floors, accent, metal) become Pascal materials, per room where a room has its own theme.
- **Velda** (`src/lib/agent.ts`): each message goes to a Velda sub-chat on Claude (Sonnet 4.6 for edits, Opus 5.5 for design questions and photos) with a compact description of the model. Velda answers with a short reply plus JSON operations (`src/lib/ops.ts`), which are applied to the model and saved as a new version. Photos are uploaded to `velda-studio/uploads/` and Velda opens them itself.
- **Storage** (`src/repo.ts`): workspace DuckDB `velda_studio.duckdb`, tables `schemes`, `versions` (model JSON), `messages`, `themes` (saved for reuse), `settings`. Queries run one at a time with retries.
- **First run** (`src/lib/import.ts`): each Velda 3D scheme is imported with its plan walls (`apps/velda-3d/data/geo_*.json`, merged into clean wall lines by `src/lib/plan-walls.ts`, which also finds room outlines from the room labels), fixtures and themes. The Designs Unlimited color plan direction (7.6.26) is seeded as two themes, with its inspiration images in `assets/themes/`.
- **Textures**: Pascal 1.0.3's material library points at `*_512.ktx2` files, but many bundled textures are JPG or WebP. `scripts/material-remap.json` (built by `scripts/material-remap.mjs`) points each missing file at the one that exists; `src/main.tsx` applies it at startup.

Outside Toolbelt the page opens a local preview from `scripts/fixtures/` in memory.

## Deployment

Toolbelt storage holds one small file, `apps/velda-studio/index.html` (copy of `toolbelt/index.html`). It loads the built code from this repository through jsDelivr, pinned to commit SHAs:

    https://cdn.jsdelivr.net/gh/dataPhysicist/velda-studio@<commit>/dist/studio.js

## Release

1. `npm install`
2. If `assets/` changed, commit and push it first and note that commit's SHA.
3. `rm -rf dist && STUDIO_ASSET_REF=<sha of a commit that contains the current assets/> npm run build:cdn`
4. Commit `dist/` and push. Note the new commit SHA.
5. Put that SHA in the two jsDelivr URLs in `toolbelt/index.html`, commit, and copy the file to `apps/velda-studio/index.html` in Toolbelt storage.
6. Open both jsDelivr URLs once so the CDN caches them before anyone loads the page.

## Local development

    npm install
    npm run dev

## Licenses

App code: MIT. Pascal editor code and assets: MIT, see `THIRD_PARTY_LICENSE_PASCAL`.
