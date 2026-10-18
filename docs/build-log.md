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
