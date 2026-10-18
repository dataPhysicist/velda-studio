# Velda Studio 1.0 build log

The working record for the 1.0 rebuild. The spec is in the Project under `claude/velda-studio-2/` (00 to 10 plus the A2 ground truth). This file is copied to the Project as `claude/velda-studio-2/build-log.md` at every phase end and whenever a session stops mid-phase. A new session starts by reading the newest entry and its "Next" line.

## How to check the build

`npm run check` runs, in order, and stops at the first failure:

| Step | Command | What it covers |
|---|---|---|
| Type-check | `tsc --noEmit && tsc --noEmit -p tsconfig.node.json` | the app (`src`, `shims`) and the tests and configs (`tests`, `*.config.ts`, `scripts/**/*.ts`) |
| Unit tests | `vitest run` | everything in `tests/**/*.test.ts` except `tests/e2e` (node, no browser) |
| Browser tests | `playwright test` | `tests/e2e`, Chromium with WebGL through SwiftShader, against `vite` on port 5199 started by Playwright |

Also: `npm run test:import` is `vitest run tests/import` (the A2 import gate) and `npm run test:e2e` is `playwright test`. CI (`.github/workflows/check.yml`) runs `npm ci`, `npx playwright install --with-deps chromium`, `npm run check` on every push to main.

Where Playwright's Chromium download is blocked (this build sandbox), set `PW_CHROMIUM_PATH` to another Chromium. Here: `npm i @sparticuz/chromium@153` in a scratch folder, `executablePath()` unpacks it to `/tmp/chromium`, then `PW_CHROMIUM_PATH=/tmp/chromium npm run check`.

## How to release

`RELEASE_TRAILER="<attribution lines>" scripts/release.sh <commit with current assets/> "<message>"`. It runs `npm run check` and refuses to release on failure, commits `src scripts tests schema docs .github toolbelt` and the configs, builds for jsDelivr, pushes, and points `release.json` and `toolbelt/index.html` at the new commit. Builds save to `velda_studio_dev.duckdb` unless `STUDIO_DB=velda_studio.duckdb` is set, which only the 1.0 release does (Phase 9, after N8 confirms). A page URL can override with `?db=<name>.duckdb`. The Toolbelt loader in Velda storage (`apps/velda-studio/index.html`) reads `release.json` from main, so every release is what the Velda Studio page runs next; dev builds say "Test copy: your real schemes are not changed" in the title row.

## Decisions and corrections (running list)

- 2026-10-18 Fixture corrections, all recorded in the fixture's `corrections` array: JPEG header density is 72:72 without units (not 96 dpi); each JPEG is painted through a soft mask; unpaired strings are 2 diagonal plus 3 short (not 1 plus 4); five room checks named strings from other rooms and now name the right string with its line on the sheet (13 checks, was 11).
- 2026-10-18 The v0.3 reference wall list misses at least one drawn wall (the Jack and Jill shower to Guest Bathroom 2 wall at y about 608 with its 2'-4" door). Listed in the fixture under `reference_walls_v0_3.known_gaps`; the import report will list every unmatched wall instead of assuming the reference is complete.
- 2026-10-18 String pairing rule: rank candidate lines by length error, then by distance to the text center (two strings on A2 have an equal-length parallel line a few points away). Orientation from text direction with a 3 degree tolerance (one A2 string is rotated 0.8 degrees).
- 2026-10-18 Room checks are measured along each string's own line between the faces it binds to, so L-shaped rooms (Guest Bathroom 2 with its vanity alcove) are checked where the architect measured them.
- 2026-10-18 Architects here often dimension face to same-side face (I.T. closet 7'-10" runs from the left face of one wall to the left face of the next). The solver binds each extension line to the nearest face, whichever side; no special case needed, but such strings are not clear spans.
- 2026-10-18 pdf.js pinned at 6.4.299 (spec said verify before pinning; v6 is current). Its worker and ours are bundled with Vite `?worker&inline`, so nothing loads a worker from jsDelivr.
- 2026-10-18 pdf.js reports four image paints on A2, not two: each JPEG is drawn through a luminosity soft mask whose own image is painted too. The adapter takes the DCTDecode image painted in page content (the plan is the 5063 x 5760 JPEG, xref 42) and decodes its bytes directly.
- 2026-10-18 `npm run dev` was broken at the start (howler, a CommonJS sound library inside Pascal's editor, was not pre-bundled). Fixed with `optimizeDeps.include`.
- 2026-10-18 Pascal's catalog items (toilet, bathtub GLBs) load from a Supabase storage host, not from this repo. Blocked in the build sandbox; works in the live page as far as is known. Noted as an outside dependency; Phase 4 checks whether to vendor the few we use.
- 2026-10-18 Design direction for Phases 2 and 3 (frontend-design skill loaded, kept consistent with 06 section 10): keep the existing plaster, graphite and verdigris chrome; verdigris stays the one action and selection color, so it never collides with the provenance colors (measured ink, traced amber, assumed grey, set by Velda blue, conflict red). Instrument Sans for the interface with tabular figures; dimension strings in a condensed face at 11 px or more. No gradients on new panels, 1 px borders, words not icons outside the five-tool strip.
- 2026-10-18 Model v2 additions beyond 04: `Wall.demolish` and `Item.demolish` (marked to be demolished on the sheet), `Opening.prov.swing`, `Note.locked` (structural cautions a person can acknowledge but not remove), room flags `needs_name` (an unnamed face) and `open_outline` (an explicit room the walls no longer close).
- 2026-10-18 Moving a wall: corner neighbors keep their direction and stretch to the new line; walls tee'd into it follow; its own tee'd ends slide on their hosts. A straight continuation with nothing else at the joint gets a short connecting wall so the plan stays closed. The along-the-wall part of a `move` with dx and dy is not applied (walls move sideways only) and the reply says so.
- 2026-10-18 Engineer notes: on delete of any wall that is not marked no-load, on moves over 6 in of such walls, and on new openings in exterior or load-bearing walls (not in walls of unknown bearing, so ordinary edits are not buried in notes).
- 2026-10-18 Rooms: faces of the wall network (kind wall only; glass, half walls and rails do not split rooms), inset by half each wall's thickness. Faces joined only by a wall with a cased opening are one room when at most one side has a name (the guest bath 2 vanity alcove). Several names in one face: split by perpendicular bisectors. No name: "Room N" flagged for naming.
- 2026-10-18 Healing before rooms and on migration: near-collinear pieces within 1.5 in put on one line; near-miss corners and tees within half the other wall plus 1.5 in closed; an already-joined end may be extended (never trimmed) so its partners tee into it.
- 2026-10-18 Migration frame: both levels move by (3.1, 126) so v0.3 level 1 and level 2 stay aligned in the A2 sheet frame (the spec sentence about "the matching sheet offset for level 1" read as the same house translation; A1 was the v0.3 house frame with offset 0, 0).
- 2026-10-18 Migration rooms: where the v0.3 walls close a room it is derived (primary bedroom 235.7 x 220.8 in against 19'-8" by 18'-5 1/2"; laundry 89.6 x 116.9 against 7'-6 3/4" by 9'-9 1/4"); where traced gaps merge rooms, the v0.3 outline is kept as an explicit room flagged open_outline until the sheet is imported (13 of 25 on the As-built). Exterior walls are marked load-bearing ('yes'), per 07 and 10; everything else 'unknown'.
- 2026-10-18 Migrated ceilings (9'-6") are marked assumed, not measured, so the intake asks again (N8 now says 9 ft for A2).
- 2026-10-18 Window `h` from Velda: values less than 24 in above the sill are read as glass height (the v0.3 meaning) and converted to head height, with a note in the result.
- 2026-10-18 As-built guardrail implemented now (07 section 9), not in Phase 5, because it is an accuracy rule: Velda's design ops on the as-built scheme branch to a new scheme first; notes and field dimensions may land on as-built. Schemes gained a `role` column (asbuilt or proposed).
- 2026-10-18 Room capture: kept compiling on v2, removed from the welcome text and from Velda's prompt; the code stays for the Experimental switch.
- 2026-10-18 The test copy (`velda_studio_dev.duckdb`) was seeded from the live database's schemes, versions, themes and settings (read only on the live file; 5 schemes, 8 versions), so the dev page shows N8's real schemes and their migration runs on the copy. Live counts for later comparison: As-built head 108 walls, 51 openings, 25 rooms.
- 2026-10-18 Phase 2: pdf.js reads each page with images over 4 MP skipped (`maxImageSize`). Its JavaScript decode of the 29 MP plan took 81 s in the build sandbox; the plan is decoded natively in the trace worker instead (about 1 s). The skipped picture's placement still shows in the operator list (a transform onto a large rectangle with nothing drawn); its pixel size and bytes come from the file's own JPEG stream.
- 2026-10-18 Wall tracing: a wall core must be clean (at most one dark pixel across it), not 85 percent white as 05 suggests; closet rods and window sashes are thin lines along the core and pass an 85 percent test. Window bands count only as runs of 12 in or more with one or two thin lines in the middle of the core. Dashed lines (three or more short dashes on one line) are never wall faces.
- 2026-10-18 Joining wall pieces: clusters are seeded by the longest pieces; a gap of 20 in or more is not bridged when both ends meet walls that run on past it on both sides (a corridor, which would otherwise get a header across the hall); each direction is bridged against the other's finished walls. A door at the very end of a wall (an arc, then the next wall across 16 to 48 in on) extends the wall so the door is an opening in it.
- 2026-10-18 What is not a wall: of two bands sharing a face line, the shorter (a door leaf, a furring line, a fixture edge); short walls under 24 in and thin ones under 3 1/4 in with a free end (cabinet sides, a tub rim); four or more bands 9 to 12.5 in deep stacked face to face (stair treads, which become the stair).
- 2026-10-18 Stair direction: on an upper floor the visible run comes up from below, so up points away from the break line; on the lowest floor toward it.
- 2026-10-18 The solver: one unknown per line of joined walls and one per bound opening; a string across a single opening sets that opening's width and position directly; strings with one end on no wall are kept on the plan as "fixture strings" (28 on A2: tub, vanity, cabinet sizes), listed apart from the items that need the person; every wall held by a resolved string is marked as set by the drawing (`sheet_dim`), not only the ones it moved.
- 2026-10-18 Walls stay as drawn lines in the model (a long wall is one wall, as on the sheet); the Confirm screen and the import check count walls as segments between tees, the same rule applied to the reference (the v0.3 list split some walls at junctions and not others).
- 2026-10-18 Ground truth corrected with evidence from the sheet's own strings and lines: four walls and openings v0.3 missed (the known Jack and Jill wall and door, the 32 in door at y 467.4, the 32 in passage at y 559.7, the wall over the primary shower), the 66 in walk-in closet opening, and the 79 in "sliding door" that the drawing shows as an open passage. Door and cased-opening counts recounted from the corrected list (15 and 5).
- 2026-10-18 Approving the Confirm screen answers the intake questions: those values become the person's (`user`, "on the import screen"); "I don't know" and "they vary" keep the default and say so. Ceiling default 9 ft.
- 2026-10-18 While the import screens are open the 3D view is taken down, so the trace has the machine to itself (halved the in-page import time in the sandbox).
- 2026-10-18 Dimension text uses Instrument Sans narrowed on its width axis; the font link with that axis is added by the app at start. The Toolbelt loader file is unchanged.

## 2026-10-18  Phase 0  commit eaa8f33 (dev release, build 5f119ff)

Done:
- Read 00 to 10, the ground truth, the spike notes and the 3D Studio plan. Cloned main (199db74, package.json 0.2.0); read the files listed in the prompt. The docs match the repo with these differences: the current "Plan" button is a top-down camera on the 3D view, not a 2D editor; v1 keeps one `ceiling` on the model and a `height` per level (both 114, 9'-6"); `DB` was a fixed constant (now switchable); the sub-chat is called through the bare name `create_sub_chat`, resolved against the tool list; `release.json` points at c2fffca.
- Copied `2nd_floor.pdf` to `scripts/fixtures/A2-asbuilt-level2.pdf`, extracted the plan JPEG to `scripts/fixtures/A2-asbuilt-level2.plan.jpg` (783,147 bytes, the exact DCT stream), and wrote the ground truth to `scripts/fixtures/A2-asbuilt-level2.ground-truth.json` with the corrections above.
- Checked the PDF independently (PyMuPDF 1.28.2, Pillow, numpy): one page, 2592 x 1728 pt; JPEGs at xref 40 (800 x 800 logo) and 42 (5063 x 5760 plan at rect 588.147, 93.228, 1803.492, 1475.628 pt, 299.94 x 300.0 ppi); 147 text spans; 909 line items and 23 curves; 98 dimension strings, 93 paired at a median of exactly 1.5000 pt per inch, all 93 within 1 percent; 96 of 98 items equal the ground truth to 0.01, the other 2 differ only by an equal-length tie that the fixture resolves correctly; 22 tints in the plan (7 + 11 demolish at alpha 0.15, 4 confirm at alpha 0.08) plus the 2 legend swatches, all matching; 14 room labels within 0.01 in; every one of the 13 room-check strings ends on a drawn raster line within 0.1 in.
- Test suites: vitest 5.0.5, Playwright 1.64.1, `npm run check`, `test:import`, `test:e2e`, CI on GitHub Actions.
- Dev database switch and release script changes (above). Created `velda_studio_dev.duckdb` in Velda storage (empty).

Evidence:
- `npm run check` green locally: unit `tests/model/ops.test.ts` (4), `tests/model/database.test.ts` (2), `tests/import/dims.test.ts` (5, all 98 A2 strings); browser `tests/e2e/smoke.spec.ts` (local preview opens, 2 levels, 3D canvas) and `tests/e2e/pdf-worker.spec.ts` (both inline workers start; pdf.js reads A2: 1 page, 2592 x 1728, 147 text items, 4 image paints).
- CI run 39129827135 on 3112297: success in 1m21s. CI run 39130735611 on eaa8f33 (the release): success in 2m9s.
- Dev release with `scripts/release.sh`: `npm run check` passed inside the script (11 unit, 2 browser), build 5f119ff for `velda_studio_dev.duckdb`, `release.json` on main points at it.
- Screenshot of the local preview before any change: `docs/buildlog/phase0-local-preview-baseline.jpg` in the repo; the signed-in page copies it to `velda-studio/buildlog/` on its next open (settings `buildlog_sync` is set in the test database).

Open:
- Platform re-test in the signed-in page: unverified in Toolbelt. The built-in browser is not signed in to toolbelt.apexti.com (it lands on /login). The check is armed (settings `platform_check` = run in `velda_studio_dev.duckdb`); it runs the first time the Velda Studio page opens signed in and writes one row per item to `platform_checks`: database, tool list, inline worker, pdf.js on its worker reading A2, 783 KB image through 512 KB parts, sub-chat round trip. Locally the worker and pdf.js items already pass in a page (`tests/e2e/pdf-worker.spec.ts`).
- jsDelivr is blocked from the build sandbox, so the CDN cache for 5f119ff is warmed by the first page load, not by the script.

Decisions N8 needs: none. Needs from N8: sign in to Toolbelt once in the Claude app's built-in browser.

Next: Phase 1 (model v2 and migration) in parallel; when N8 has signed in, open the Velda Studio page, read `platform_checks`, record pass or fail per item here, and finish the manual checklist items that need the page.

## 2026-10-18  Phase 1  commit f5fc9dc (dev release, build 9c4d3cc)

Done:
- `src/model/`: model v2 types with provenance on every number (`types.ts`), units, geometry, joints and rooms from walls (`derive.ts`), the ops validator and apply (`ops.ts`), version compare (`diff.ts`) and the v0.3 migration (`migrate.ts`). The 3D compiler moved to `src/view3d/compile.ts` and reads openings, per-level ceilings and head heights from v2.
- Repo: versions gained `parent_id`, `author`, `ops_json`, `label`; schemes gained `role`; `comments` and `comment_replies` tables; `schema_version` = 2 in settings, and a page refuses to open a database written by a newer schema.
- First open of a v0.3 scheme migrates it once and saves a new version by "migration" ("Updated to the new model (every wall and opening kept)"); the v0.3 version stays in the history. Schemes whose name starts with "As-built" get role asbuilt, so Velda's design changes there branch to a new scheme.
- Room capture: still compiles on v2 and stays behind the Experimental switch; removed from the welcome text and from Velda's prompt.

Evidence:
- `npm run check` green: 35 unit tests in 5 files, 3 browser tests. The named ones for this phase: `tests/model/v2.test.ts` (16: joints, gap healing, rooms with clear sizes and stable ids, moving the dividing wall 12 in changes one room by +12 and the other by -12 with the door kept in place, corner and tee neighbors stretch, the 6 in engineer note rule, only a person can mark a wall no-load, Velda edits carry their version label, dimension conflict, compare), `tests/model/ops.test.ts` (4, the v0.3 op rules on v2), `tests/model/migrate.test.ts` (8: the live As-built head keeps all 108 walls and 51 openings; window glass heights become head heights; 9'-6" ceilings come over as assumed; exterior walls load-bearing; every near-miss joint healed; level 2 rooms derived with the primary bedroom at 235.7 x 220.8 in against 19'-8" by 18'-5 1/2" and the laundry at 89.6 x 116.9 against 7'-6 3/4" by 9'-9 1/4"; the kitchen scheme and its items in the same frame), `tests/e2e/migration.spec.ts` (a v0.3 scheme opened in the page migrates once, keeps its old version, keeps every wall and opening), `tests/e2e/smoke.spec.ts` (the local preview runs on the migrated v2 model and draws the 3D view).
- CI run 39133105771 on f5fc9dc: success in 2m41s. CI run 39133825505 on 52bca0e (release pointer): success in 1m57s.
- Dev release with `scripts/release.sh`: check passed inside the script, build 9c4d3cc for `velda_studio_dev.duckdb`, `release.json` on main points at it.
- Screenshot: `docs/buildlog/phase1-local-preview-migrated.jpg`, the current UI on the migrated model (same view as the Phase 0 baseline; 116 wall pieces, 45 doors and windows and 29 room floors in the 3D scene). Queued for copying to `velda-studio/buildlog/` on the next signed-in open.

Open:
- Migration of N8's real schemes on the test copy: unverified in Toolbelt. It runs the first time the page opens signed in; then `versions` in `velda_studio_dev.duckdb` should show one "migration" version per scheme and the As-built head should still have 108 walls and 51 openings.
- 13 of the 25 As-built rooms keep their v0.3 outlines (flagged open outline) because gaps in the v0.3 trace merge them. The Phase 2 import of A2 replaces level 2 with traced, dimension-checked walls; level 1 waits for the A1 sheet.
- Phase 0 platform re-test still waits on the signed-in page (no change).

Decisions N8 needs: none. Needs from N8: sign in to Toolbelt once in the Claude app's built-in browser (still pending).

Next: Phase 2, the import pipeline.

## 2026-10-18  Phase 2  commits 07b2a79, b7db6fb, 47119c0 (dev release, build 50cfe6f)

Done:
- Adapter (`src/import/pdf-read.ts`, `pdf-images.ts`, `pdf-adapter.ts`): text spans, stroked lines, filled shapes with transparency and image placements from pdf.js 6.4.299, in page points with y down; the plan picture taken from the file's own JPEG stream (783,147 bytes on A2, the exact fixture); thumbnails for the page strip. Recorded capture: `scripts/fixtures/A2-asbuilt-level2.adapter.json` (`npx tsx scripts/capture-fixture.ts`).
- Import stages, all pure and tested in Node (`src/import/`): sheet classification (number, title, level, as-built or proposed, scale text, firm, issue, tier), dimension strings with span merging, pairing and scale, raster tracing in a worker (`raster/`: Otsu threshold, thin-line chains, face pairs with clean cores, window bands, dashed lines, stairs, bridging, door-at-wall-end, exterior by flood fill, openings with swing arcs), labels and appliance tags, legend tints by hue, the dimension solver, loose-end closing, room derivation, multi-level alignment (`align.ts`), the import report, and the intake answers (`intake.ts`).
- Screens (`src/app/Import.tsx`, `importFlow.ts`): "Bring in a plan" in the title row, or drop a PDF on the studio; the page strip; the Confirm screen (sheet with the trace over it, what we read, the intake questions, fixes in place: not a wall, door, window, open passage, nothing here; use traced or use drawn for a conflict); approving saves the PDF and the plan picture as blobs and opens the new scheme with "Imported from A2 (7.2.26)".

Evidence:
- `npm run test:import` green: `tests/import/a2.test.ts` (11 tests: scale 1.5000 from 96 of 98 strings and the title block agrees; all 14 rooms by name with W and D as washer and dryer; all 13 clear dimension checks after the solve; the 3 wall thickness checks; 76 wall segments against 78 in the corrected reference counted the same way; 14 windows, 15 doors, 6 open passages against 14, 15, 5; 18 demolish and 4 confirm tints at their measured rectangles, Guest Bathroom 3 and Guest Bedroom 2 flagged; edit cost 7 of 8 allowed, every item listed; 0 conflicts and 7 unresolved items; provenance), `tests/import/align.test.ts` (A2 lands on the migrated v0.3 level 1 with a shift of 1, 1 in; 30 percent of the level 2 exterior within 3 in of a level 1 exterior wall), `tests/import/dims.test.ts`.
- `npm run test:e2e` green: `tests/e2e/import.spec.ts` brings `A2-asbuilt-level2.pdf` in through the page's upload, pdf.js on its inline worker, the trace worker and the Confirm screen with its defaults, then runs the same checks on the saved scheme (all pass; ceiling 9 ft confirmed as the person's; plan picture saved, 783,147 bytes). 1.1 to 1.2 min in this two-core sandbox with SwiftShader.
- Edit cost 7, listed: reference walls L2w12 and L2w53 (v0.3 read the tub apron and the tub end as walls; the trace has the walls beside them), L2w58 (the walk-in closet wall: the trace takes the hall-side line, v0.3 the closet side), the L2w31 passage center 2.7 in off, its 66 in opening on the other line, and a 24 in passage where v0.3 has a gap between two walls.
- Unit tests 47 in 7 files; browser tests 4. CI run 39142679584 on 47119c0: success in 3m13s. Dev release: check passed inside the script, build 50cfe6f for `velda_studio_dev.duckdb`, `release.json` on main points at it.
- Screenshot: `docs/buildlog/phase2-confirm-A2.jpg` (the Confirm screen for A2 in the local preview), queued for `velda-studio/buildlog/`.
- Timing: Node trace of the 29 MP plan 1.3 s; whole in-page import of A2 in this sandbox about 70 s, most of it pdf.js on two cores; laptop timing unverified.

Open:
- Importing A2 in the signed-in Toolbelt page: unverified in Toolbelt (not signed in).
- Two-level check with the DU set: pending (only A2 is attached). Done instead against the migrated v0.3 level 1 (above).
- Not built yet: vector walls for fully vector PDFs (tier B), raster-only plans with the Replicate second opinion (tier C), diagonal walls, images of plans (refused with a message), dragging walls on the Confirm screen (Phase 3 brings the plan editor), and rescaling when a person says a size is wrong (the Fix answer is a note for now).
- The `4'-5"` string at the walk-in closet does not land on the trace (listed on the Confirm screen); the closet's hall wall reads 3 in off from the v0.3 trace.

Decisions N8 needs: none for Phase 2. Phase 3 starts by confirming the five-tool strip (09).
