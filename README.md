# Velda Studio

Browser app for remodel design: one measured, editable 3D model of a home, edited by chat and by hand, shared with clients. It runs as a [Toolbelt](https://apexti.com) app page.

Built on the MIT-licensed [Pascal editor](https://github.com/pascalorg/editor) (`@pascal-app/*` 1.0.3), bundled as plain static files with Vite. No server.

## How it is deployed

Toolbelt storage holds one small file, `toolbelt/index.html`. It loads the built code (`dist/`) and the static assets (`assets/`) from this repository through jsDelivr, pinned to commit SHAs so every release is immutable:

    https://cdn.jsdelivr.net/gh/dataPhysicist/velda-studio@<commit>/dist/studio.js

Inside Toolbelt the scene is saved to the workspace DuckDB file `velda_studio.duckdb` (table `projects`) through the dashboard bridge. Outside Toolbelt the editor falls back to browser storage.

## Release

1. `npm install`
2. `STUDIO_ASSET_REF=<sha of a commit that contains the current assets/> npm run build:cdn`
3. Commit `dist/` and push. Note the new commit SHA.
4. Put that SHA in the two jsDelivr URLs in `toolbelt/index.html`, commit, and copy the file to `apps/velda-studio/index.html` in Toolbelt storage.

`assets/` only needs a new ref when its contents change.

## Local development

    npm install
    npm run dev

## Layout

- `src/main.tsx`: app entry, sidebar tabs, persistence wiring
- `src/toolbelt.ts`: Toolbelt postMessage bridge and DuckDB scene storage
- `src/host/`: sidebar and toolbar components adapted from Pascal's open-source host app (v1.0.3)
- `shims/`: stand-ins for `next/image` and `next/link`, Pascal's only Next.js dependencies
- `assets/`: Pascal's models, materials, icons and sounds (v1.0.3)
- `toolbelt/index.html`: the page stored in Toolbelt

## Known gaps

- One wood floor texture (`material/wood/woodplank_48` base color) is missing from the bundled assets.
- Pascal's 3D-print export worker cannot start when code is served cross-origin; that feature is unused here.

## Licenses

App code: MIT. Pascal editor code and assets: MIT, see `THIRD_PARTY_LICENSE_PASCAL`.
