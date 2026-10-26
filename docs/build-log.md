# Velda Studio 1.0 build log

The working record for the 1.0 rebuild. The spec is in the Project under `claude/velda-studio-2/` (00 to 10 plus the A2 ground truth). This file is copied to the Project as `claude/velda-studio-2/build-log.md` at every phase end and whenever a session stops mid-phase. A new session starts by reading the newest entry and its "Next" line.

## How to check the build

`npm run check` runs, in order, and stops at the first failure:

| Step | Command | What it covers |
|---|---|---|
| Type-check | `tsc --noEmit && tsc --noEmit -p tsconfig.node.json` | the app (`src`, `shims`) and the tests and configs (`tests`, `*.config.ts`, `scripts/**/*.ts`) |
| Unit tests | `vitest run` | everything in `tests/**/*.test.ts` except `tests/e2e` and `tests/perf` (node, no browser) |
| Timing budgets | `PERF=1 vitest run tests/perf` | 03 section 7, alone so nothing else shares the CPU |
| Browser tests | `playwright test` | `tests/e2e`, Chromium with WebGL through SwiftShader, against `vite` on port 5199 started by Playwright |

Also: `npm run test:import` is `vitest run tests/import` (the A2 import gate), `npm run test:perf` the timing budgets, `npm run test:e2e` is `playwright test`, and `npm run schema` writes `schema/model-v2.schema.json` from `src/model/types.ts`. The export tests read their files back with Python (`ezdxf`, `pymupdf`, `jsonschema`). CI (`.github/workflows/check.yml`) runs `npm ci`, installs those three, `npx playwright install --with-deps chromium`, `npm run check` on every push to main.

Where Playwright's Chromium download is blocked (this build sandbox), set `PW_CHROMIUM_PATH` to another Chromium. Here: `npm i @sparticuz/chromium@153` in a scratch folder, `executablePath()` unpacks it to `/tmp/chromium`, then `PW_CHROMIUM_PATH=/tmp/chromium npm run check`.

## How to release

`RELEASE_TRAILER="<attribution lines>" scripts/release.sh <commit with current assets/> "<message>"`. It runs `npm run check` and refuses to release on failure, commits `src scripts tests schema docs .github toolbelt` and the configs, builds for jsDelivr, pushes, and points `release.json` and `toolbelt/index.html` at the new commit. Since 1.0, builds save to the live `velda_studio.duckdb`; `STUDIO_DB=velda_studio_dev.duckdb` makes a test-copy build (before 1.0 that was the default). A page URL can override with `?db=<name>.duckdb`. The Toolbelt loader in Velda storage (`apps/velda-studio/index.html`) reads `release.json` from main, so every release is what the Velda Studio page runs next; test-copy builds say "Test copy: your real schemes are not changed" in the title row. Try a risky change on a test-copy build first, or open the live page with `?db=velda_studio_dev.duckdb`.

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
- 2026-10-19 Correction to the 2026-10-18 engineer note entry: walls of unknown bearing count as "may carry load" for every structural change, as 10 section 9 and 06 section 2 say. A new opening, widening an opening by more than 6 in, moving a wall or a corner more than 6 in, or removing a wall that is not marked no-load now asks first (the confirm names why) and keeps the locked note. Only a person can mark a wall as carrying no load, in the Selection panel.
- 2026-10-19 Hand edits on the as-built ask once per scheme per session (07 section 9): "Make a new scheme" (Option 1, Option 2 ...), "Change the as-built", or Cancel. Measurements and notes do not ask; they record the house as it is.
- 2026-10-19 Removing a wall between two named rooms joins them: the person picks which name stays; an unnamed side ("Room 3") takes the other's name without asking. New op `merge_rooms` (the dropped room's name goes before the rooms are worked out again).
- 2026-10-19 Room outlines no longer straighten a jog in a wall a person, Velda or a field measurement placed (the 1 1/2 in jog healing is for traced pieces only). Found when a typed 4'-0" closet came back as 4'-0 3/4" after the next edit.
- 2026-10-19 Typing a size while dragging a wall sets the size of the room picked last (Velda's "here") when the wall borders it, otherwise the room on the wall's left. Sizes read as 4', 13'-2", 13' 2", 158 or 4 1/2 (bare numbers are inches); the digits do not switch views while a drag is on.
- 2026-10-19 R with several fixtures selected turns the group a quarter turn about its middle (positions and fronts together), which is how a refrigerator tower moves from one wall to another.
- 2026-10-19 Layout per 06 section 1: Conversation on the left (360 px), the plan or 3D in the middle, the Selection panel on the right (320 px, can be hidden). The large room title stays over the canvas; the plan starts below it. The Checks, Inspiration and Versions tabs come with their phases; the version strip stays along the bottom.
- 2026-10-19 The 3D view stops drawing while the plan covers it (the viewer's `renderPaused`); the scene still updates, so 3D is current when it shows again. In this sandbox the plan went from 600 ms a frame to 16 ms.
- 2026-10-19 The plan draws a room's clear dimensions for sides of 30 in or more (jogs and returns read as clutter); the Selection panel lists them with their badges. Small fixtures draw over counters so they can be picked; a room name steps off an island.
- 2026-10-19 Door swings in 3D: in a Pascal wall's own frame, x runs from the wall's start to its end and +z is the right-hand side of start to end (y down the sheet). A leaf the model swings to the left of start to end is Pascal's "outward"; the hinge end maps to hingesSide (start = left). Doors stand open about 70 degrees so the leaf shows the swing. Checked from above in the local preview and pinned by `tests/view3d/compile.test.ts`.
- 2026-10-19 Stairs compile as one straight Pascal flight from the bottom step along the plan's up arrow. When only the upper floor is in the model (an A2 import), the flight hangs below that floor with a rise of its ceiling plus floor structure.
- 2026-10-19 3D view options live in one "Walls:" button over the 3D view (walls cut away, full, see-through, off; floors: the one picked, all, spread apart; light: even, morning sun, afternoon sun). The sun presets put a light where the sun is at 10 am and 4 pm on an equinox at 30.5 degrees north, turned by the plan's north setting (top of the sheet until a person sets it), over the viewer's soft overcast light. The usual 3D view looks down at 35 degrees.
- 2026-10-19 3D clicks: one click reaches every node under the cursor, nearest first, each bubbling to its level, building and site; the first that is a wall, opening, room floor, fixture or stair is selected. The plan's selection is shown in 3D through the viewer's host highlight (`externalSelectedIds`).
- 2026-10-25 Checker numbers live in `src/library/standards.json`, labeled FBC Residential 8th edition (2023, based on the 2021 IRC). They were checked against 10-design-reference, not line by line against the FBC text: unverified against the code book.
- 2026-10-25 Checker severities: code minimums block, NKBA guidance is "should fix", everything else is a note. A bedroom window that fails egress only on assumed head and sill heights is a should-fix that asks for a tape measurement, not a code failure (nothing assumed is shown as measured). The 5.0 sf at-grade allowance applies only to the lowest floor, and not when its name says it is an upper floor (a sheet imported on its own).
- 2026-10-25 Checker readings of the code: a tub's 21 in clear has to be there along at least 2'-6" of its open side (or half a short tub), not every inch, so a toilet beside the end of the tub in a 5 by 8 bath passes, as it does in practice. Kitchen aisles are measured only between fronts that face each other, or to an island; a run ending beside a range turned the other way is a corner, not an aisle. A sink, range, cooktop or dishwasher set into a counter, island or vanity takes its host's clearances. Stair treads are judged with the fewest risers code allows when the plan gives no count (so a flag is certain), headroom against the lower floor's ceiling only (the floor opening above is not modeled), landings 3'-0" deep at both ends. Clear distances are kept to the thousandth of an inch (a toilet nudged 12 + 3 x 1 in is 15 in, not 14.99999).
- 2026-10-25 Not checked yet, because the model has nothing to check them on: island seating and knee space (no seats), shower doors swinging out (shower doors are not modeled), a shower valve on glass (valves are not modeled), the work triangle and landing areas beside appliances.
- 2026-10-25 Fix buttons only offer a fix that is checked to clear the issue: a door clash offers the hinge or swing flip that clears it (none, if neither does); the toilet slide rounds up to the next 1/8 in.
- 2026-10-25 Ops table (`src/model/table.ts`): one definition per op writes Velda's OPERATIONS lines and checks each op's shape before it runs. Added beyond 07's table: `swap`, which also takes groups (a refrigerator tower of two columns trades places with a range as one piece), and `place` with an existing item's `id` or `on` an island, counter or vanity. `inspiration_add` waits for Phase 6. `field_dimension` moves the wall that is not an outside wall (the far one if both are alike), marks it field measured, and adds no engineer note (it records the house as it is). `open_wall` makes a cased opening with its head 1 ft under the ceiling (8 ft at most), or to the ceiling with `header: false`; never in an outside wall.
- 2026-10-25 `arrange` clears the room's fixtures of that kind and places the template's items with plain ops in one version; what it could not meet goes in the reply. It does not make a second Velda call; Velda sees the new items on the next turn.
- 2026-10-25 What Velda sees: every room in one line, and full detail for at most three rooms (the focused one, rooms the message names, rooms holding fixtures the message names). The whole migrated house is under 6 KB.
- 2026-10-25 Chat: Velda's reply is replaced by a plain "I could not apply that" when none of its ops applied, and partial results say what was not done; Velda hears the skipped ops next turn. On the as-built, the branch to a new scheme happens only once the ops apply, so a failed request leaves no empty copy. Messages gained a `meta` column (option cards, research) on the test copy.
- 2026-10-25 Checks set aside (dismissed notes, acknowledged engineer cautions) are kept per scheme in the settings table (`checks_aside:<scheme id>`).
- 2026-10-25 Pinterest comes in through Pinterest's public widget endpoints, read from the page (`widgets.pinterest.com/v3/pidgets/pins/info` for a pin, `.../boards/<user>/<board>/pins/` for a board, which gives up to 50 pins), not by crawling: Velda's crawl fails on Pinterest pages, and the widget answers the page directly. A board that gives back fewer than 5 pictures says it may be private; a `pin.it` short link asks for the full link. No Pinterest sign-in.
- 2026-10-25 Colors are measured, never guessed. The page measures pictures it holds (files, chat photos) with its own quantizer (median cut, then k-means for true shares). It can show Pinterest pictures but not read their pixels, and the page preview cannot call `execute_code` itself ("Failed to execute public tool"), so the tagging request asks Velda to run the same quantizer in her sandbox (Deno with jpeg-js) on the web pictures and copy its output back. Each color Velda names snaps to the nearest measured color within an RGB distance of 40 and keeps her name; a color nothing measured comes near is dropped; with none left, the measured colors stand unnamed.
- 2026-10-25 Inspiration cards are records, like notes: adding, filing or retitling them on the as-built saves a version there without branching. A theme made from them is a design change and branches.
- 2026-10-25 Tagging runs at most 8 pictures per Velda call, in batches of even size, three calls at a time (a 9-pin board is 5 and 4 together). A picture dragged from another tab arrives as its address and is measured like a pin.
- 2026-10-25 When Velda's change on the as-built goes to a new scheme, the as-built chat gets one line naming that scheme and the new scheme's chat starts with the request. The chat shows inspiration cards by title; Velda's prompt also carries their ids.
- 2026-10-25 Render references: up to 4 of the room's inspiration pictures, those sharing the most colors with the room's theme first (the cards the theme came from), then the theme's own images, then any Velda names; 6 at most.
- 2026-10-25 Shower fit (`src/library/fit.ts`): each type in `src/library/showers.json` is tried in each corner of the room, on wall stretches clear of doors and their swings, with its depth checked to the facing wall and 2'-0" clear in front; a wet room is judged by the room's size; a steam shower needs a ceiling of 8'-0" or less. Velda's prompt lists only the types that fit, and only when the talk is about a shower, tub or bath fixture.
- 2026-10-25 A placed product takes a short name (the part of its title before a comma, dash or bracket, at most 48 characters at a word break). Check messages keep a product name's capitals.
- 2026-10-25 Corrected: `scripts/release.sh` had not been committing source since the `schema` folder went away (one missing path makes `git add` stage nothing), so builds were made from the working tree with the source committed by hand or not at all. Build 596819d's source was committed after the fact as 2c34aba and rebuilt to the same bytes; the script now stages only paths that exist.
- 2026-10-25 Render prompts (`src/ai/render.ts`) are written by the app: what image 1 is, the room and its size and ceiling, its fixtures and the walls they stand on, the camera in words, the theme's colors by role with hex values, materials, lighting and what to avoid, then N8's own words last. Velda's `render` op carries only his words (`prompt`), and the ops table tells her not to describe the design there and to use `best` only when he asks for it.
- 2026-10-25 The camera in words comes from the 3D view: inside a room, its height above the floor; from above, the room the middle of the view lands on, "with the ceiling and near walls cut away"; how far it looks down; the wall it looks toward and what is on that wall (fixtures, windows, doors); the lens angle across.
- 2026-10-25 Render sizes and costs: standard is `google/nano-banana-2` at 1K, about $0.07 an image; best is `google/nano-banana-pro` at 2K, about $0.13. These are Google's list prices for the two models (Gemini API, standard tier); Replicate reports no price in its model or prediction records and its price page could not be read from the build sandbox, so the figures are estimates, unverified against the Replicate invoice. Each render records its model, size, estimate, time, the Replicate prediction id and the prompt in the message (`meta.render`).
- 2026-10-25 Phase 6 palettes checked independently: the three pictures from the Toolbelt run were measured again with the same script in a separate sandbox run, and every color and share came out identical (for example #dad0c4 25%, #b0a598 21.8%, #584937 21% for the rustic oak vanity). A sub-chat on the faster model reported it has no `execute_code` tool, so measuring stays on the deeper model's sub-chat, which has it.
- 2026-10-25 Exports are made in the browser (`src/export/`): one plan drawing (`plan-svg.ts`) serves the PDF sheets and the share viewer; schedules and the change log are plain records; the DXF is a hand-written R12 writer; the GLB comes from the share viewer's light 3D builder with every node named by its model id, so it does not need the studio's 3D view open.
- 2026-10-25 Sheets: 17 x 11 by default (24 x 36 on request), 1/4 in = 1 ft when a level fits and 1/8 in otherwise (A2 at 58'-8" by 51'-3" goes 1/8 on 17 x 11); room names are 7 pt on paper at either scale. Mood boards are pages of the sheet set rather than a separate board.pdf.
- 2026-10-25 Web pictures (Pinterest) cannot be read by the page, so the PDF, the share page and the package show them as their measured colors with the link; stored pictures (dropped files, chat photos) are embedded. A way to keep a small copy of web pictures (the sandbox can fetch them, but a sub-chat's output files are not saved to storage) is open.
- 2026-10-25 Share links: the page is one HTML file in Velda storage (`velda-studio/shares/<id>.html`) with the schemes inside, `dist/viewer.js` and three.js from jsDelivr; the link is `manage_shared_artifacts` `create_link` (a signed storage link; 30 days or 1 year was accepted), falling back to a signed URL. It returns no share id, so "turn off" removes the file (or replaces it with a notice), and "update" re-uploads the same file so the link shows the new version. The as-built always goes with a proposed scheme.
- 2026-10-25 Which as-built a scheme compares with: of the as-built schemes, the one sharing the most wall ids with it (a scheme copied from the A2 import shares its walls).
- 2026-10-25 The plan keeps its rooms, walls, openings, stairs and room-name spots between renders and redraws only what is sized for the screen (text, handles, pins) when you pan or zoom.
- 2026-10-25 The tour's card never covers what it points at: beside the plan in the column to its left, above the chat box, and to the side of small targets. It waits behind Share, Export, Settings and the as-built question. Step 2 offers a change for the room just clicked (the tub to a shower, a second sink at a vanity, the kitchen sink to the island, else the room 1'-0" bigger), since a sample or a level with no kitchen made "Move the sink to the island" nonsense. Setting a room's size by typing also finishes the drag-a-wall step.
- 2026-10-25 A drawn dimension in conflict shows both numbers on the plan and the sheets ("5'-2" drawn, 4'-9" now"), as 06 asks. The model rule stays as 04 says (any change recomputes, more than 1/2 in off is a conflict); on a proposed scheme, the handoff checklist leaves out drawn dimensions that hold on the as-built, because the design moved them on purpose and the change log has them.
- 2026-10-25 The Confirm screen counts conflicts the way the finished model has them. The solver's own residuals had A2 at 0, but re-trimming corners after the solve leaves one string just over the line (4'-0" drawn at the I.T. closet, 4'-0 1/2" between its walls), so the plan showed a red dimension the Confirm screen had not mentioned.
- 2026-10-25 Plain words, checked by a test that reads every screen (text, tooltips, labels a screen reader speaks): no field names, ids, raw values or timestamps, metric units or em dashes, and none of node, scheme version, Replicate, prediction, JSON, SQL, API or schema. Version times read "Oct 25, 3:16 PM"; the handoff checklist names a door by its rooms ("the 4'-0" door between the Guest Bathroom 3 and the Jack & Jill Shower"), not by its id.
- 2026-10-25 The timing budgets run in `npm run test:perf`, on their own inside `npm run check`, because with every test file running at once the GitHub runner timed clear dimensions at 27 ms; alone they take 12.5 ms.
- 2026-10-25 A room's sizes find the inside of each edge from the way its outline winds, not from one point inside it (12.5 ms to 2.8 ms for the whole house, and right on the inner edges of an L-shaped room).
- 2026-10-25 A render names the room it is for in the camera words when that room is in the picture.

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

## 2026-10-19  Phase 3  commits dae9651 to ea9aa86 (dev release, build 431ecb8)

Done:
- Plan view (`src/plan2d/Plan.tsx`, `geometry.ts`, `underlay.ts`; key 1 or Plan): walls at their true thickness (outside walls darker, demolish walls hatched red), doors with leaf and swing, pairs, sliding and pocket doors, windows as three lines, open passages with dashed jambs, rooms with name and area at the pole of the outline, stairs, fixtures with their footprint and a label that fits, the selected room's clear dimensions colored by provenance (ink measured, amber traced, grey assumed, blue Velda, red conflict), the level's overall size along the top and left, the person's measurements, comment pins. The plan picture from an import sits underneath (35 percent until a wall is edited, slider in the corner). Wheel zoom, drag or Space-drag to pan, F to fit, double-click a room to frame it.
- The five tools, confirmed with N8 (Select, Wall, Opening, Measure, Comment; V W O M C). Select: drag a wall (both rooms' sizes update next to the cursor, snap 1 in and to parallel faces, type a size to set it), drag a corner, slide a door or window (distance from each end shown), resize it from its edge handles in 2 in steps, Space flips the hinge and Shift-Space the side, drag fixtures (backs snap to wall faces; several move together), R turns, arrows nudge 1 in (Shift 12, Alt 1/8), Delete, Ctrl or Cmd-Z and Shift-Z, Ctrl or Cmd-D and Alt-drag copy, Ctrl or Cmd-A selects the level, Esc. Wall: click corner to corner, Enter or double-click ends, Esc takes back a corner, thickness 3 1/2, 4 1/2 or 6 in; ends inside a wall tee into it. Opening: hover shows a ghost, click places a 32 in door (36 in window on an outside wall, Alt for a door), drag along the wall sets the width. Measure: two clicks leave a measurement on the plan (Shift keeps it straight). Comment: click, type, pin.
- Every hand edit is model ops by the person saved as a version (`src/app/editor.ts`), so the plan, 3D and Velda share one history; undo and redo step through versions. New ops: `split_wall`, `move_joint`, `dimension`, `merge_rooms`. Confirms: the as-built (once), anything structural on a wall that may carry load, and the name that stays when two rooms join.
- Selection panel (`src/app/Context.tsx`): plain fields for a room (name, size, area, ceiling, clear dimensions), a wall (length, thickness, height, kind, carries load, its openings, its engineer notes), a door or window (kind, style, width, height, sill, distance from each end, swing in words with Flip buttons), a fixture (name, width, depth, height, which way it faces), a measurement, a stair, a note. Each number says where it came from ("measured from drawing", "traced", "assumed", "you set this", "set by Velda").
- After a plan import the studio opens on that level's plan with the drawing underneath.

Evidence:
- `npm run check` green: 53 unit tests in 7 files (new: split a wall, move a corner, a measurement, joining two rooms, a small move a person made survives room derivation, typed lengths), 6 browser tests.
- `tests/e2e/editor.spec.ts` (09's editor smoke): on level 2 it clicks a room (the panel shows its name), drags the wall between IT Closet and Laundry Room 12 in with the mouse, confirms the engineer warning; IT Closet's size across the wall changes by -12 and Laundry Room's by +12, both walls at its ends change length by 12, the engineer note is on the plan, the version reads "Moved a wall 1'-0"". Then O and a click put a 32 in door in that wall (header warning confirmed), Space and Shift-Space flip it, Delete removes it, Ctrl-Z twice brings it back with the hinge flipped and the side as it was. Then Delete on the wall asks which name stays and joins the two rooms (screenshot `docs/buildlog/phase3-editor-joined-rooms.jpg`).
- `tests/e2e/kitchen.spec.ts` (the Phase 3 gate): the three kitchen changes from the design review on the level 1 kitchen of the migrated v0.3 "N8 kitchen" scheme (the local preview), every step a mouse or keyboard gesture in the plan or the Selection panel: the sink dragged onto the island and turned; a 6 ft opening dragged along the sink wall with the Opening tool (it takes the window's place), made a sliding door in the panel, the sink wall counter cut to 4'-6" in the panel and slid clear of the doors; the refrigerator and freezer columns selected together, turned three quarter turns as a group and slid onto the range wall, the range slid to where the tower was and turned. 13 hand edits, 8.7 s of machine time in this sandbox; a person needs the same gestures (about 20 clicks, drags and keys), well inside five minutes. That scheme already had the sink on the island (v0.3 made that change by chat), so one setup edit first puts it back on the sink wall counter; it is labeled "(test setup)" in the history. Screenshots: `docs/buildlog/phase3-kitchen-0-before.jpg`, `-1-sink.jpg`, `-2-patio-doors.jpg`, `-3-swap.jpg`.
- `tests/e2e/import.spec.ts` now also checks that the studio opens on the imported level's plan with the plan picture underneath (`docs/buildlog/phase3-plan-after-import.jpg`).
- Typed sizes, the Measure and Comment tools, the Wall tool, the as-built confirm with "Make a new scheme", copying and select-all were run in the local preview with a script (not kept as tests): IT Closet set to exactly 4'-0" by typing during a drag; "Measured 7'-5""; a pinned note; a drawn wall; the as-built confirm branching to "Option 1" with the edit there.
- Dev release with `scripts/release.sh`: check passed inside the script (53 unit, 6 browser tests), build 431ecb8 for `velda_studio_dev.duckdb`, `release.json` on main points at it. CI run 39261032914 on f37c298: success in 4m24s.
- Screenshots queued for `velda-studio/buildlog/` on the next signed-in open (with the earlier three).

Open:
- The signed-in Toolbelt page: unverified in Toolbelt (still not signed in in the built-in browser, and the link to N8's computer dropped during this phase). The kitchen changes on his real "N8 kitchen" scheme in the page wait for that.
- Level 1 in the local preview is the v0.3 trace: its walls have gaps, so the kitchen is an open outline and its outside walls are not marked as outside. The kitchen test runs on that data. The DU set (A1, A4) would replace it.
- Not built in this phase: "Use as the real length" on a measurement (binding it to walls and solving again is how field corrections enter; planned with the field-dimension op), snapping a wall drag to the drawing's dimension strings, Alt-drag to pull one wall off a shared corner, resizing a fixture by its corner handles (the panel fields do it), the command palette (Ctrl or Cmd-K), Compare side by side, comment threads in the Conversation panel (pins and the panel only), renaming in place on the plan (double-clicking a name opens the name field in the panel), the first-run tour.

Decisions N8 needs: none for Phase 3.

Next: Phase 4, 3D parity: compile v2 with openings, swings, stairs, wall kinds and per-room themes; cut-away modes; stacked and solo levels; selection shared between 3D and the plan; framing; lighting presets; Walk regression check. Then the gate review with N8.

## 2026-10-19  Phase 4  commits 150ecf5, b62b3f9 (dev release, build 4ff9f71)

Done:
- 3D from model v2 (`src/view3d/compile.ts`): doors stand open the way the plan swings them (hinge end and side), with sliding, pocket, barn, folding, pair and garage doors drawn as what they are; windows take their type; stairs become a straight flight; half walls (3'-6") and rails (3'-0") stop short of the ceiling; a room's own color scheme reaches its walls where every room the wall faces shares it.
- Shared selection (`src/app/Stage.tsx`): a click on a wall, door, window, fixture, stair or floor in 3D selects it in the plan and the Selection panel; Shift adds; whatever is selected in the plan lights up in 3D; double-clicking a floor frames that room.
- 3D view options over the 3D view: walls cut away (the default N8 likes), full, see-through or off; floors: the one picked (solo when a level is picked, all when "Whole house" is), all stacked, spread apart; light: even, morning sun, afternoon sun (`src/view3d/sun.ts`). The usual view looks down at 35 degrees.

Evidence:
- `npm run check` green: 60 unit tests in 8 files (new `tests/view3d/compile.test.ts`, 7: every wall, opening and room has a 3D node carrying its model id; door swings both ways; sliding, pocket, pair and cased; half walls and rails; a stair from its bottom step up the plan's arrow; a room's color on its own walls only; the sun's direction at 10 am and 4 pm turned by north), 7 browser tests.
- `tests/e2e/editor.spec.ts` now checks the 3D scene after every edit in the Phase 3 test (the moved wall and its stretched neighbors, the new door, both flips, the delete, both undos, the joined room): each one is in the 3D scene graph by the time the version is saved, the same frame the plan shows it.
- `tests/e2e/view3d.spec.ts`: with walls full in 3D it stands in the Primary Bedroom, looks at a wall and clicks it; the plan's selection is that wall, the Selection panel shows it, 3D highlights it, and the plan has it selected after pressing 1. Then Walk through in the Primary Bathroom starts inside the room and W moves you at eye height; Esc leaves.
- Screenshots (local preview, level 2, software rendering): `docs/buildlog/phase4-walls-cutaway.jpg`, `-up.jpg`, `-translucent.jpg`, `-down.jpg`, and `phase4-floors-apart-morning-sun.jpg` (whole house, floors spread apart, morning sun, with the options open).
- Dev release with `scripts/release.sh`: check passed inside the script (60 unit, 7 browser tests), build 4ff9f71 for `velda_studio_dev.duckdb`, `release.json` on main points at it. CI run 39277955902 on 1514671: success (27 minutes including the wait for a runner).
- Screenshots queued for `velda-studio/buildlog/` on the next signed-in open.

Open:
- 2026-10-25, after the gate: checked in the Toolbelt page itself (Toolbelt's signed preview of the Velda Studio page in the built-in browser on N8's Mac, real GPU, build 4ff9f71 on `velda_studio_dev.duckdb`; the built-in browser is still not signed in to Toolbelt):
  - Platform checks, run `pc_mvo3nayi`, all six pass: database, tool list (254 tools, sub-chat tools present), inline worker, pdf.js on its inline worker reading A2 (1.15 s, 147 text items, the 5063 x 5760 plan), the 783,147 byte plan picture through two 512 KB parts and back (write 3.1 s, read 1.2 s), sub-chat round trip ("pong", 4.3 s).
  - The opened scheme ("Designs Unlimited 7.2.26 (A4 + A5)") migrated once: v1 "Imported from Velda 3D", v2 "Updated to the new model (every wall and opening kept)" by migration; 125 walls, 50 openings, 35 rooms. The other four schemes migrate when first opened.
  - The build log screenshots were copied to `velda-studio/buildlog/` (14 files).
  - A2 brought in through the page: Confirm screen in 7.8 s with 76 walls, 15 doors, 14 windows, 6 open passages, 14 named rooms plus Room 1 and Room 2, 0 conflicts and 7 unplaced items, the same as the browser test; "Looks right" saved the PDF, the plan picture (783,147 bytes) and the scheme in 39 s (blob parts over the bridge), ceiling 9'-0" marked as the person's, and opened Level 2's plan with the drawing underneath. That made an "As-built" scheme on the test copy.
  - 3D on a real GPU: all 41 imported walls built in under 2 s, doors open the way the plan swings them, the stair flight is there. Screenshots: `docs/buildlog/phase4-page-confirm-A2.jpg`, `phase4-page-plan-A2.jpg`, `phase4-page-3d-A2.jpg`, `phase4-page-3d-du-scheme.jpg`.
  - Found and fixed: on first open in the page the 3D camera stayed at its default spot (the viewer sets up its GPU renderer after the first framing); it now frames again once the scene is first ready.
- In this sandbox 3D draws through SwiftShader: Pascal builds wall geometry a few walls per frame, so all 116 walls take about 70 s and Walk moves a few centimeters a second. Laptop speed unverified.
- Both faces of a wall share one finish in Pascal, so a room's own color does not reach walls it shares with a room on another scheme.
- Fixed after the gate: the usual 3D framing steps back for "spread apart" floors on the whole house.
- Stairs exist only on imported sheets (the migrated v0.3 levels have none).

Decisions N8 needs: the Phase 4 gate review (go for Phase 5, or what to fix first).

Next: wait for N8's go. Phase 5 is Velda's operations contract and the checker (07).

## 2026-10-25  Phase 5  commits 07712f0 to 1c627d6 (dev releases, builds 1301b6f and 5528ce7)

Done:
- The checker (`src/analysis/checks.ts`, numbers in `src/library/standards.json`): toilet sides and front, shower size and front, vanity front and width per sink, tub open side, kitchen aisles, dishwasher standing room, range under a window, refrigerator door into the island, island sink vent, fixtures running into each other, the way-out door, narrow doors (closets left alone; 2'-8" suggested only in rooms being remodeled), door swings into doors, fixtures and stairs, halls, bedroom egress windows worked out from window style, stair width, risers, treads, headroom and landings, tempered glass by tubs, showers and doors, windows in showers, a toilet moved more than 2'-0" or onto another wall, and every engineer caution. It runs on every version (about 30 ms for the whole migrated house). Each issue is one plain sentence in feet and inches, how serious it is, and a Fix when one change clears it.
- Checks tab next to Selection: issues grouped by room, worst first; click to select and frame it in the plan and make its room the focus; Fix applies the fix as an ordinary hand edit; notes and should-fix items can be dismissed and brought back; engineer cautions can only be acknowledged.
- Velda's operations as one table (`src/model/table.ts`) that writes the OPERATIONS part of the prompt and checks every op's shape. New ops: `place` (back on a named wall face, clear of doors and swings, or set into an island or counter), `swap` (also groups, like a refrigerator tower), `arrange` (galley, L, U, island, 5 by 8 bath, double vanity, bed wall, laundry), `move_wall` (by, to, or so a room comes out a given size), `set_dimension`, `open_wall`, `replace_opening`, `set_swing`, `join_walls`, `flag_room`, `field_dimension`; page ops `analyze` (two steps: checks run, Velda answers from them), `propose` (each option its own scheme, shown as cards with a small plan), `research`.
- What Velda sees (`src/ai/summary.ts`): every room in one line; the rooms the conversation is about in full, walls as the room sees them (top wall, outside or not, bearing), doors with the room they swing into, fixtures with the wall they stand against or the counter they sit in, open checks, engineer notes, recent versions. The prompt (`src/ai/prompt.ts`) follows 07 section 4's order; design questions and visual words go to the deeper model.
- If none of Velda's ops apply, the reply says so instead of describing a change; partly applied answers say what was not done, and Velda hears it next turn.

Evidence:
- `npm run check` green inside `scripts/release.sh`: 108 unit tests in 11 files (new: `tests/analysis/checks.test.ts` 23, a synthetic room per rule; `tests/model/chat-ops.test.ts` 18; `tests/ai/prompt.test.ts` 7 with the prompt snapshot `tests/ai/__snapshots__/prompt.txt` and the 6 KB budget), 9 browser tests (new `tests/e2e/chat.spec.ts`: the three kitchen requests through the real send path with a stand-in for Velda, a refused op, analyze, propose; `tests/e2e/checks.spec.ts`: a toilet 12" from a wall).
- In the Toolbelt page (signed preview in the built-in browser, build 1301b6f, test copy `velda_studio_dev.duckdb`), on "DU kitchen, chat test (Phase 5)", a copy of "Designs Unlimited 7.2.26 (A4 + A5)", with the real Velda (Sonnet 4.6):
  - "move the sink to the island": 6 s, one version "Sink moved to island", op `place` du-sink on du-island; the sink's front lines up with the island's front, centered on it (322 1/8, 439 1/4 against the island at 322.1, 420.2, 5'-0" deep). Velda added the plumber note for the vent. `docs/buildlog/phase5-page-1-sink-to-island.jpg`.
  - "add patio doors where the sink wall is": 13 s, one version "Patio doors on sink wall": a 6'-0" pair of French doors in the sink wall L1w4 in place of its window, and the sink wall counter cut to 7'-6" so it starts just right of the doors; engineer note for the header. Velda said plainly that the model lists that wall as interior, so it could not confirm it opens outside. `phase5-page-2-patio-doors.jpg`.
  - "swap the range and the fridge tower": 19 s, one version "Range and fridge tower swapped": Velda swapped the two refrigerator columns with the range and its counter run as two groups and ran analyze; the columns' backs sit on the range wall line (557 1/4) centered where the run was (248 1/8); the range's back is on the old tower's wall line (196 3/8), centered where the tower was (405 1/4). `phase5-page-3-range-fridge-swap.jpg`.
  - The checker: the WC toilet moved so its center is 12" from the wall showed "The toilet (WC) is 1'-0" from its center to the wall beside it; code needs 1'-3" each side" against code; clicking it selected and framed the toilet; "Slide it 6"" saved version 6 and the issue cleared. `phase5-page-4-toilet-flagged.jpg`, `phase5-page-5-toilet-fixed.jpg`.
- Found in the page and fixed (1c627d6): after the swap the range wall's 11'-1" counter reached 16" into the double oven and the checker said nothing; fixtures running into each other are now flagged. "Save as a new scheme" used a browser dialog the preview does not show; it now asks for the name in place. Clicking an issue now makes its room the focus (the title said Kitchen while showing level 2).
- Build 5528ce7 in the page: the same scheme now shows "The range wall counter runs into the double oven." (should fix, Kitchen); the name field for a new scheme opens filled with "DU kitchen, chat test (Phase 5) (copy)" and Cancel closes it without making a scheme.
- All 11 Phase 5 screenshots copied to `velda-studio/buildlog/` by the page (build 5528ce7, 18:46 UTC).
- Local browser-test screenshots: `docs/buildlog/phase5-chat-1-sink-to-island.jpg`, `-2-patio-doors.jpg`, `-3-range-fridge-swap.jpg`, `phase5-chat-propose.jpg` (two option cards with their plans), `phase5-checks-toilet-flagged.jpg`, `phase5-checks-toilet-cleared.jpg`.

Open:
- The DU scheme's sink wall (L1w4) is not marked as an outside wall: its migrated level 1 outline does not close, so the outside walls were not found. Velda flagged it rather than assume. It matters for the egress-door and header rules on that scheme.
- Velda placed the patio doors left of the old window rather than centered on it, to keep counter; a person might want them centered. That is a design choice for N8.
- Not checked yet: island seating, shower doors swinging out, shower valves on glass, the work triangle, landing areas beside appliances (nothing in the model to check them on).

Decisions N8 needs: none.

Next: Phase 6, inspiration, themes and the fixture library (images, Pinterest pins and boards, product links, the Inspiration panel, mood board, theme from a selection, the shower library, `research` through Velda).

## 2026-10-25  Phase 6  commits d086a5f to f317d10 (dev releases, builds 62bfe53 and 596819d)

Done:
- Inspiration in (`src/inspiration/`): pictures dropped or pasted in the chat box or the Inspiration tab, picture addresses, Pinterest pins and boards, and any other page (Velda reads it). Each becomes a card filed under the focused room; a board becomes a board card plus one card per picture. Velda tags them (title, style, materials, fixtures, palette, one line on what to take from it) on the deeper model; palettes are measured (decisions above).
- Inspiration tab (`src/app/InspirationPanel.tsx`): drop zone and link box, filter by room (or "Not filed yet") and by tag, cards with picture, source, swatches and tags; drag a card onto a room in the plan to file it there too; pick cards and "Make a theme from these", which asks Velda for a theme with a role for each color, materials, an avoid list, and applies it to the room.
- Mood board (`src/app/MoodBoard.tsx`): the room's theme colors with names, roles and hex values, materials, what to avoid, and its pictures with where each came from; Print shows only the board.
- Shower library and fit (`src/library/showers.json`, `fit.ts`): alcove, walk-in, curbless, neo-angle, double, steam, wet room, tub and shower. Products Velda finds through `research` come back as cards with picture, size, price and link; Place puts one where the fit found room for that type.
- Renders take the room's inspiration pictures and theme as references (07 section 8).

Evidence:
- `npm run check` green inside `scripts/release.sh`: 131 unit tests in 15 files (new: `tests/inspiration/pinterest.test.ts` on saved widget answers for one public pin and one public board, scrubbed of names, plus the quantizer; `tests/inspiration/ingest.test.ts` 8; `tests/library/fit.test.ts` 5, the A2 primary bath polygon fits every type but steam at its 9'-0" ceiling; `tests/model/units.test.ts` 2), 10 browser tests (new `tests/e2e/inspiration.spec.ts`: three pictures in the chat box and a board link in the tab become 13 tagged cards in two versions, filters, three picked cards become the room's theme in a new scheme whose chat starts with the request, the mood board, a card dragged onto the Primary Bedroom files it there).
- In the Toolbelt page (signed preview in the built-in browser, builds 62bfe53 then 596819d, test copy `velda_studio_dev.duckdb`), on the imported A2 "As-built" scheme's Primary Bathroom, with the real Velda:
  - Three Pinterest pictures dropped on the Inspiration tab by address: 57 s, three tagged cards in one version ("Inspiration for Primary Bathroom (3 pictures)"), each with five colors measured in Velda's sandbox, for example "Rustic oak vanity with matte black fixtures": #dad0c4 25%, #b0a598 22%, #584937 21%, #7b736a 16%, #292117 16%.
  - The public board "marble Shower Tray finish anti-slip" pasted in the link box: a board card and 9 pin cards in 153 s (two calls, one after the other, before the parallel change), every pin measured in the sandbox, every palette color one of its measured colors; one version.
  - Five cards picked, "Make a theme from these": 32 s. Velda made "Warm Oak and Honed Marble": 9 colors with roles, every one a measured color from the picked cards (walls #e5dfdb from the vaulted bath, cabinets #584937 from the rustic vanity, counters #e2e3e4 from the Calacatta tray, floors #d4cab9 from the curbless shower), 9 materials, an avoid list and lighting. It went to a new scheme, "Warm oak and marble bath theme"; the as-built is unchanged. `docs/buildlog/phase6-toolbelt-inspiration.jpg`, `phase6-toolbelt-mood-board.jpg`.
  - "find me the best shower for this bathroom" on the as-built: 143 s with Velda's web research. Her pick is a 6'-0" x 3'-6" curbless walk-in, with a 5'-0" x 3'-0" alcove as the cheaper choice; she pointed out that both windows sit in that corner and that a curbless floor on level 2 needs the joists confirmed. Two products for each of the three types she offered: curbless (Redi Trench 42 x 72 pan, $1,054; Schluter Kerdi-Shower-LT 36 x 72, $354.43), walk-in (Royal Bath ERASTONE 72 x 42; Schluter Kerdi-Shower-Kit 48 x 72, $820.48), alcove (Kohler Salient 60 x 36; Swanstone SS-3660, $1,031). All three types are ones the fit finds for this room; nothing on the as-built changed. `phase6-toolbelt-shower-products.jpg`.
  - Place on the Royal Bath base: the as-built question, "Make a new scheme", then the 6'-0" x 3'-6" base in the room's top left corner; the checker noted the window within 5'-0" needs tempered glass.
  - In the theme scheme, "Lay out this bath: a 6 ft double vanity, a 6 by 3 1/2 ft curbless shower with a fixed glass panel, and a toilet, kept clear of the windows": 72 s, one version, and Velda's check run found no problems. "Render the primary bath realistically from this view" from the 3D view: 77 s at best quality. The references were the four cards the theme came from (the vaulted bath, the rustic oak vanity, the Calacatta tray, the curbless shower), and the render shows them: oak double vanity, matte black faucets and globe sconces, white marble herringbone in a gray marble frame, a linear drain and a cream marble floor. `phase6-toolbelt-render.jpg`, `phase6-toolbelt-render-in-chat.jpg`.
- Found in the page and fixed in 596819d:
  - One card's palette came back empty because Velda's named colors were a little off the measured ones (now snapped).
  - The board's pictures were tagged one call after another (now three at a time, in even batches).
  - The as-built chat kept the theme request with no answer (now it says where the change went).
  - Velda's reply and the app both said "in a new scheme" (now only once).
  - The chat bubble showed card ids.
  - A placed product's name was cut mid-word ("... shower base, o") and lowercased in a check ("royal Bath").
  - "Make a new scheme" from a hand edit named it "Option 1" (now named from the change).
  - The mood board showed only the first color for each role.
- All 5 Phase 6 screenshots copied to `velda-studio/buildlog/` by the page (build 596819d, 20:11 UTC).

Open:
- Times in the page: three pictures about a minute; a 9-picture board 2 1/2 minutes before the parallel change (not yet re-timed); a theme about half a minute; a shower search with products 2 1/2 minutes.
- Place uses the first corner the fit finds. Velda had suggested the top right corner; she cannot yet say which corner when she lists products.
- Some products come without a picture (Redi Trench, Schluter LT): the card shows a blank tile.
- The render's camera is the 3D view from above (walking to a good spot inside the room takes practice). Renders are not yet labeled "mood, not dimensions"; Phase 7 does that and records cost per render.
- Test schemes made on the test copy during this run: "Warm oak and marble bath theme" and "Option 1" (the placed shower base).

Decisions N8 needs: none.

Next: Phase 7, renders: the prompt built from theme, inspiration and camera; the best quality path; labels; one before and after of the primary bath from the current 3D view; cost per render.

## 2026-10-25  Phase 7  commits 5d5c111, 055dcc9 (dev releases, builds 1b3ca76 and 0190e22)

Done:
- The render prompt is the app's (decisions above); Velda adds only N8's words.
- Every render shows "Mood, not dimensions" on the picture, and under it its quality, size, estimated cost, time and how many inspiration pictures it used (their names on hover). "Again at best quality (about $0.13)" makes it again with the Pro model at 2K from the current view.
- The Replicate run reports its prediction id and run time, kept with the render.
- Renders keep the view's shape and framing (055dcc9): the snapshot is taken in the supported ratio nearest the screen (a tall 3D view is 4:5, not 3:2) and that ratio is asked for outright. The Phase 6 render showed why: its view was snapped at 3:2 from a nearly square screen (cropped and zoomed), and with "match_input_image" the model followed a tall Pinterest reference and made a 2:3 picture with its own framing. Checked locally: the snapshot now matches the screen.

Evidence:
- `npm run check` green inside `scripts/release.sh`: 137 unit tests in 16 files (new `tests/ai/render.test.ts` 6, including the nearest ratio: the camera inside the A2 primary bath at 5'-3" looking at the vanity wall, the cut-away view from above, the prompt from room, fixtures, theme, inspiration and camera with N8's words last, a photo render, the cost line), 11 browser tests (new `tests/e2e/render.spec.ts`: "Render the primary bath realistically from this view" in the 3D view through the real send path and render action with stand-ins for Velda and Replicate; the Replicate input is `google/nano-banana-2` at 1K with the app's prompt ending in N8's words; the render shows the label and "Standard, 1K · about $0.07 · 29 s"; the best quality button runs `google/nano-banana-pro` at 2K). Screenshot `docs/buildlog/phase7-render-labeled.jpg` (local preview).
- The Phase 6 render in the Toolbelt page (before this change, Velda chose best quality on her own): 77 s from asking to the picture, `nano-banana-pro` at its default size (1696 x 2528), about $0.13.

Open:
- The before and after render of the primary bath from the current 3D view in the signed-in page with build 0190e22: unverified in Toolbelt. The link to the built-in browser on N8's computer dropped before the release finished.
- Replicate's real price per image: unverified (estimates above).
- `google/nano-banana-2.1` came out this month at about half the price of nano-banana-2 with sharper output; switching standard renders to it is a one-line change worth trying once the page check is done.

Decisions N8 needs: none.

Next: the page check for Phase 7 when the browser link is back; meanwhile Phase 8, share and handoff.

## 2026-10-25  Phase 8  commits c103490 to 9c68d30 (dev release, build 5f22235)

Done:
- Export dialog (Export in the title row): the handoff checklist first (what is missing, with Show me), then the parts: PDF sheet set, DXF per scheme, model and as-built JSON, GLB, schedules (rooms, doors, windows, fixtures), change log (sentences, markdown and CSV), inspiration (stored pictures and a list with links). Build package makes a zip named for the project, scheme and date; every file can also be downloaded on its own, with its size.
- PDF sheet set: cover (schemes, provenance legend, assumed values, open items, engineer items), every level's plan for the as-built and the scheme, demolition and new work, changes, the four schedules, a mood board page per room; title block with project, scheme, version and date, scale and "Design intent. Not for construction. Field verify all dimensions." on every sheet.
- DXF R12 on AIA layers per level (walls as solid pieces between openings, centerlines, doors with swing arcs, windows, stairs, room names and areas, clear and overall dimensions, fixtures and equipment, notes).
- Share dialog: Make a link (30 days or 1 year), links for the scheme with copy, update and turn off. The share page shows the plan with dimensions in provenance colors and room names, comment pins with their threads, 3D with an orbit and the cut-away, levels, mood boards and a scheme switcher; read-only, no account, no Toolbelt calls.

Evidence:
- `npm run check` green inside `scripts/release.sh`: 143 unit tests in 18 files, 14 browser tests (12.1 min).
- `tests/export/dxf.test.ts`: the A2 DXF passes ezdxf 1.4.5 audit with 0 errors and 0 fixes; AC1009; walls land at the model's coordinates with y flipped; drawn back with ezdxf it matches the plan.
- `tests/e2e/sheets.spec.ts`: the A2 as-built plus a proposed scheme make 9 sheets (G-0 cover, A-1 and A-2 plans, A-3 demolition, A-4 changes, S-5 to S-8 schedules), 17 x 11; read back with PyMuPDF 1.28.2 the page count matches and the level 2 sheet has "Primary Bedroom" and 19'-8".
- `tests/e2e/viewer.spec.ts`: dist/viewer.js is 38 KB (under 2 MB); the share page for two A2 schemes is well under 2 MB, loads with every request outside jsDelivr refused and none attempted; plan with 19'-8", one comment pin and its reply, scheme switcher, mood board (a stored picture as a thumbnail, a Pinterest picture as its colors and link), 3D with more than 80 meshes, cut-away and full. Screenshots `docs/buildlog/phase8-viewer-plan.jpg`, `phase8-viewer-3d.jpg`.
- `tests/e2e/handoff.spec.ts`: in the local preview with a proposed scheme, Build package gives a 155 KB zip with README.md, the sheet set, two DXF files, model.json, as-built.json, model.glb (glTF), four CSV schedules, changes.md and changes.csv, inspiration/index.md, every file non-zero; Share uploads the page with both schemes and makes a 1 year link through `manage_shared_artifacts`, lists it and turns it off. Screenshots `phase8-export.jpg`, `phase8-share.jpg`.
- `tests/export/export.test.ts`: the plan drawing, schedules, change log sentences ("Laundry Room grows from 15'-0" x 9'-9 3/4" (121 sf) to 15'-0" x 10'-9 3/4" (136 sf).") and the checklist on A2.
- Checked from the build environment: `create_link` on a test file in `velda-studio/shares/` returned a signed link for 30 days.

Open:
- In the signed-in page with build 5f22235 (Export, the zip, Share with the real storage, N8 opening the link in a private window): unverified in Toolbelt; the link to the built-in browser on N8's computer has been down since Phase 7.
- Small copies of web pictures for the PDF and share page (above).
- `schema/model-v2.schema.json` (08 section 5) does not exist in the repo yet; model.json goes without it.
- The share page's 3D is the light builder (boxes and floors), not the studio's Pascal scene with finishes.

Decisions N8 needs: none. Needs from N8: open the Claude desktop app so the built-in browser link comes back; then open the share link I send in a private window.

Next: the page checks for Phases 7 and 8 when the browser is back; Phase 9 (first run, tour, empty states, command palette, settings, performance, the 1.0 release, which needs N8's go for the live data migration).

## 2026-10-25  Phase 9  commits 36baf3c to 1f5bfef (dev release, build 1b54a6c)

Done:
- First run (`src/app/Tour.tsx`): a welcome with one drop zone and "Try the sample plan" (the A2 sheet), then a five-step tour that points at the real thing (click a room; tell Velda, with a change for that room in the chat box; drag a wall; add inspiration; Share). Each step finishes when you do it, every step can be skipped, the tour can be ended and started again from Settings.
- Command palette (Cmd or Ctrl-K: every action, room and level by name, anything else goes to Velda), keyboard shortcuts list (?), Settings (new door, window and wall sizes, saved themes, the experimental photo capture switch, the tour, the build). Empty states, suggested prompts in the chat box, and error messages in plain words (`src/app/errors.ts`).
- Performance pass: the plan keeps its fixed layers when you pan or zoom.
- Stranger walk (new scheme from the sample A2, the tour, share), with a picture at every step. Fixed what confused:
  - The tour card sat on the plan and covered the walls step 3 asks you to drag, and covered Undo while saying every change can be undone. It now sits beside what it points at.
  - The tour card stayed on top of Share, Export and the as-built question. It now waits behind them.
  - Step 2 offered "Move the sink to the island" on a level with no kitchen. It now offers a change for the room you clicked.
  - Dragging a wall on a design made the drawn dimensions it moved turn red with no explanation. They now say "5'-2" drawn, 4'-9" now".
  - The Export checklist showed a door as "A2w30d1" and called a design change a conflict.
  - Version times showed as raw timestamps.
  - The Confirm screen said every dimension agreed while the plan showed one in red.
  - The pointer's position pushed the drawing slider's label under the tools.
- Found by checking the success criteria:
  - The share page showed fixtures without their sizes. It now has a Sizes tab: rooms, doors, windows and fixtures of the level with their sizes. Fixtures on the plan also say their size on hover.
  - `schema/model-v2.schema.json` was missing. It is now generated from the model's types (`npm run schema`) and goes in the package next to model.json.
- A render describes the camera from the room it is for when that room is in the picture. The browser test caught the camera still gliding, so the middle of the view landed on the closet next door.
- README rewritten for 1.0.
- CI was failing since Phase 8 (ezdxf missing on the runner). It now installs ezdxf, PyMuPDF and jsonschema, and the timing budgets run on their own.

Evidence:
- `npm run check` green inside `scripts/release.sh`: 151 unit tests in 20 files, 2 timing tests, 17 browser tests (14.3 min). CI run 40245220397 on 1f5bfef: success in 15m 29s, the first green run since Phase 7.
- Timing (03 section 7), in this sandbox (two slow cores, software rendering, the dev build of React), so upper bounds for a laptop:

  | What | Measured | Budget |
  |---|---|---|
  | A2 trace (29.2 MP) | 465 ms | under 5 s |
  | Whole migrated house (116 walls, 29 rooms): clear dimensions | 2.8 ms (12.5 ms before 1f5bfef) | under 16 ms |
  | Whole migrated house: 3D compile | 7.4 ms | under 100 ms |
  | Whole migrated house: checks | 5.5 ms | none |
  | Whole migrated house: plan drawing | 14.6 ms | none |
  | A2: clear dimensions | 3.1 ms | under 16 ms |
  | A2: 3D compile | 2.9 ms | under 100 ms |
  | A2: an edit plus its 3D compile | 19.4 ms | under 100 ms |
  | Plan with 200 walls on a level, zoom | 16.7 ms a frame (60 fps), 6.1 ms of script a step | 60 fps |
  | Plan with 200 walls on a level, pan | 16.7 ms a frame (60 fps), 6.4 ms of script a step | 60 fps |

  Plan zoom before the change: 13 to 15 ms of script a step, 25 fps. Tests: `tests/perf/budgets.test.ts`, `tests/e2e/perf.spec.ts`.
- `tests/e2e/firstrun.spec.ts`:
  - The welcome, the sample plan through the Confirm screen, and every tour step.
  - A real wall drag on the as-built: the question comes up over the tour, then "Make a new scheme", and the as-built stays as it was.
  - The palette ("go laundry" goes to the Laundry Room; anything else offers "Ask Velda"), Settings (a 36" door width is kept), and the shortcuts list.
  - The Confirm screen, the tour and Export after the import, read for machine words.
  - Screenshots `docs/buildlog/phase9-first-run.jpg`, `phase9-tour-velda.jpg`, `phase9-palette.jpg`.
- `tests/e2e/plainwords.spec.ts`: no machine words anywhere a person goes without Velda. Covered: the welcome, plan, 3D, each panel tab, a selected room, wall, door and fixture, the version strip, Share, Export, the palette, Settings and the shortcuts. Screenshot `phase9-plain-words.jpg`.
- `tests/e2e/viewer.spec.ts`:
  - The share page's Sizes tab has the four tables, a fixture's width in feet and inches, and no machine words. Screenshot `phase9-viewer-sizes.jpg`.
  - `tests/export/schema.test.ts`: the A2 import, an edited scheme and the migrated house all fit the schema (jsonschema 4.26, Draft 7).
- Stranger walk pictures, before and after the fixes, are in the build sandbox, not committed. They were taken with a scratch test that is not part of the suite.

1.0 success criteria (02):
1. DU sheets A1, A2, A4, A5 in one go, a correct two-level house in under ten minutes, no tool palette: not verified. Only A2 is attached.
   - A2 alone: Confirm screen in 7.8 s in the Toolbelt page (Phase 4). In the local preview, welcome to the built house in under a minute (`firstrun.spec.ts`, 50 s with the tour).
   - Two levels are aligned in code (`src/import/align.ts`) and tested against the migrated v0.3 level 1.
   - Needs: the DU PDF set.
2. The A2 acceptance test passes in CI: `tests/import/a2.test.ts` and `tests/e2e/import.spec.ts`, CI run 40245220397 (success).
3. The three kitchen changes by chat only, shown right in plan and 3D with dimensions: met on the test copy in Phase 5.
   - With the real Velda in the Toolbelt page: 6 s, 13 s and 19 s, one version each, positions checked to the inch.
   - Screenshots `phase5-page-1-sink-to-island.jpg`, `-2-patio-doors.jpg`, `-3-range-fridge-swap.jpg`.
4. A designer opens the share link cold and reads every room dimension, fixture size and material:
   - Locally: plan with clear dimensions, the Sizes tab, mood boards with materials (`viewer.spec.ts`).
   - Opening a real link in a private window: unverified in Toolbelt.
5. The DXF opens in a free viewer, right layers and scale:
   - ezdxf audit 0 errors.
   - Drawn by ezdxf's own viewer (`docs/buildlog/phase9-dxf-ezdxf-view.png`): walls, doors, windows, room names and dimensions on their AIA layers.
   - Drawn full size: each of the 83 dimension texts reads its own line length within 1/2 in (`tests/export/dxf.test.ts`).
   - AutoCAD: unverified.
6. Nothing needs knowing "node", "scheme version" or "Replicate": `plainwords.spec.ts` and the reads in `firstrun.spec.ts` and `viewer.spec.ts`. Velda's own replies are not covered by the test; her prompt asks for plain words.

Open:
- In-page checks for Phases 7, 8 and 9 in the signed-in page with this build: unverified in Toolbelt. N8's computer has been offline since Phase 7.
  - A render of the primary bath and its cost.
  - Export and the zip.
  - Share with real storage, opened in a private window.
  - The tour on the real page.
- The 1.0 release itself waits for N8's go:
  - default database `velda_studio.duckdb`
  - version 1.0.0
  - the one-time upgrade of the live schemes, after a backup of the live tables
  - the fallback in `apps/velda-studio/index.html` moved to the 1.0 build
- In this sandbox the 3D view of a small room still shows the floor close up 20 s after switching. Pascal builds walls a few per frame under software rendering. Laptop speed unverified, as noted in Phase 4.

Decisions N8 needs: the go for 1.0 (the live database).

Next: on N8's go, back up the live tables, release 1.0.0 on `velda_studio.duckdb`, open the page once so the live schemes upgrade, check the As-built head still has 108 walls and 51 openings, and move the fallback. Then the in-page checks when the browser link is back.
