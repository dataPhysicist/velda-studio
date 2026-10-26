# Velda Studio

Your house, measured from its plans, to remodel by talking and by hand. Drop the floor plan PDFs; the studio reads the drawing's own dimension strings, asks a few questions the plan cannot answer (ceiling height, which side faces the street), and builds an editable 2D plan and 3D model where every number says where it came from. Then change it by telling Velda what you want, by dragging walls, or by adding pictures you like, and hand the result to a designer or architect as sheets, CAD, 3D and schedules, or a read-only link. It runs as a [Toolbelt](https://apexti.com) app page on the Velda assistant.

Built on the MIT-licensed [Pascal editor](https://github.com/pascalorg/editor) packages (`@pascal-app/*` 1.0.3): Pascal's 3D viewer and node renderers draw the house. Pascal's editing interface is not used.

## What a person does

1. **Bring in the plan.** Drop the PDF set (or try the sample, the second floor of a real house). The Confirm screen shows what was read over the drawing (walls, doors, windows, rooms, the stair), what did not match, what could not be placed, and asks the few questions it needs. "Looks right" builds the house as the **as-built**, the record of the house as it is.
2. **Change it.** Say it to Velda ("move the sink to the island"), or use the plan's five tools (Select, Wall, Opening, Measure, Comment). Each change is a version; Undo and Redo step through them. Velda never changes the as-built; it makes a new scheme. A wall that may carry load keeps the engineer note.
3. **Check it.** The Checks tab reads every version against clearances and code (toilet, shower, aisles, door swings, bedroom escape windows, stairs, tempered glass) in plain sentences, with a Fix where one change clears it.
4. **Make it look like something.** Paste a Pinterest pin or board or drop pictures; Velda tags them and the page measures their colors. A theme comes from the pictures, a mood board shows it, and a render paints the room (labeled "Mood, not dimensions").
5. **Hand it off.** Export builds a zip (PDF sheet set, R12 DXF, model data, GLB, CSV schedules, change log against the as-built, inspiration, and a checklist of what is still open). Share makes a read-only link anyone can open without an account.

## How it works

- **The model** (`src/model/`, v2) is the source of truth: levels, sheets, walls, doors and windows, rooms, fixtures, stairs, the drawing's dimension strings, inspiration and themes, all in inches in the plan frame (x right, y down the sheet). Every number carries its provenance (measured, traced, assumed, set by Velda). Every change goes through `src/model/ops.ts`, which keeps walls connected, openings in their walls, rooms worked out from the walls, and dimension strings checked against the walls. v0.3 schemes are migrated on first open (`src/model/migrate.ts`). Every version stores a full copy.
- **Import** (`src/import/`): pdf.js reads the sheet in a worker; dimension strings are parsed and paired with their lines, the scale is read, the plan image is traced into walls, openings, labels, legend tints and stairs are found, and a least-squares solver moves walls so the drawn dimensions hold ("strings govern, pixels locate"). `src/import/intake.ts` holds the questions.
- **Plan** (`src/plan2d/`) and **3D** (`src/view3d/compile.ts`, Pascal's viewer) show the same model; selection is shared. Walk through (`src/app/Walk.tsx`) puts you in the room at eye height.
- **Velda** (`src/lib/agent.ts`, `src/ai/`): each message goes to a Velda sub-chat (Sonnet 4.6 for edits, Opus 5.5 for design questions, photos and links) with a compact description of the model; Velda answers in a short reply plus operations the page applies and saves as a version.
- **Checks** (`src/analysis/`), numbers in `src/library/standards.json`.
- **Inspiration** (`src/inspiration/`): pins and boards by URL, pictures measured for color in the page.
- **Renders and 3D products** run on Replicate through a Velda sub-chat (`src/lib/replicate.ts`).
- **Exports** (`src/export/`) are pure functions of the model; the share page is one self-contained HTML file built around `dist/viewer.js` (`src/viewer/`).
- **Storage** (`src/repo.ts`): workspace DuckDB, tables `schemes`, `versions`, `messages`, `comments`, `comment_replies`, `themes`, `settings` (with `schema_version`), `blobs` and `blob_parts`. Queries run one at a time with retries.

Outside Toolbelt the page opens a local preview from `scripts/fixtures/` in memory.

## Databases

Release builds save to `velda_studio.duckdb`, the live schemes. A build made with `STUDIO_DB=velda_studio_dev.duckdb` saves to the test copy instead and says "Test copy" in the title row. A page URL can override either with `?db=<name>.duckdb`. A page refuses to open a database written by a newer schema. The v0.3 tables as they were before 1.0 are kept in the live file as `backup_20261026_*`.

## Deployment

Toolbelt storage holds one small file, `apps/velda-studio/index.html` (a copy of `toolbelt/index.html`). It reads `release.json` from this repository's `main` branch to learn the current build commit, then loads that commit's `dist/` through jsDelivr:

    https://cdn.jsdelivr.net/gh/dataPhysicist/velda-studio@<commit>/dist/studio.js

If GitHub cannot be reached within 2.5 s it loads the `FALLBACK` commit written into the page. So a release is a push; the Toolbelt file only needs updating to move the fallback.

## Release

`RELEASE_TRAILER="<attribution lines>" scripts/release.sh <commit with the current assets/> "<message>"` runs `npm run check` and refuses to release on failure, commits the source, builds for jsDelivr, pushes, and points `release.json` and `toolbelt/index.html` at the new build. Then open both jsDelivr URLs once so the CDN caches them, and copy `toolbelt/index.html` to `apps/velda-studio/index.html` in Toolbelt storage when the fallback should move.

## Local development

    npm install
    npm run dev
    npm run check   # types, unit tests, timing budgets, browser tests

`npm run test:import` runs the A2 acceptance test alone. The browser tests need Chromium (set `PW_CHROMIUM_PATH` where Playwright's own download is blocked) and Python with `ezdxf`, `pymupdf` and `jsonschema` for the export checks. The build is tracked in `docs/build-log.md`.

## Licenses

App code: MIT. Pascal editor code and assets: MIT, see `THIRD_PARTY_LICENSE_PASCAL`.
