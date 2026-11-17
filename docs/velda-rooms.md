# Rooms: the photo-first page

Written 2026-11-17. Rooms is for working from a photo of a room: pick the room, add a photo, say what to change. It sits beside Velda Studio on the same floor plans.

## The decision

Not more panels in Velda Studio, and not a separate product. A second, light page in the same repo and the same database.

- The Studio is a desktop plan editor with 3D. The photo loop (photo, ask, compare, keep) is three steps and has to work on a phone.
- What makes it "combined" is shared data, not a shared screen: Rooms reads the Studio's rooms, real sizes, fixtures, style directions (the Designs Unlimited color plan directions), saved designs and plan checks, live. Nothing is copied.
- Same repo (`github.com/dataPhysicist/velda-studio`, folder `src/rooms/`), so it uses the Studio's model, checker and Toolbelt bridge code as they are.

## Where it is

- Published 2026-11-17 at N8's word: https://velda-rooms.tryapexti.ai. Anyone with the link can add photos, make changes (each one is billed to the Replicate account) and see what is there; N8 accepted that. It works only with the Velda Dairy plans.
- Toolbelt page "Rooms" on the Velda assistant, slug `velda-rooms`. In Toolbelt: `/workspaces/588111b7-7e4c-4631-8b88-a59998f719eb/home?page=velda-rooms`.
- Code on branch `rooms`, pull request 1. The page loads the branch build through `rooms-release.json`; the live Studio is untouched.
- Data: tables `rp_photos`, `rp_versions`, `rp_saved` in `velda_studio.duckdb`; pictures in Velda storage under `velda-rooms/`.

## What it does

1. Rooms from the floor plan, each with its real size. Add a photo from a phone or computer.
2. Ask for a change in words. The image model redraws the whole picture every time (in the test, 99.9 percent of pixels differed); Rooms compares the result with the photo, keeps the area that was asked for and puts every other pixel back. Things the model changed unasked are marked "Put back" and can be kept with a tap.
3. Mark a spot: paint over a part, and only that part can change.
4. Every kept change is a version. Any version can be the start of the next change. Hold to compare with the real photo.
5. Ideas: Velda looks at the photo with the room's plan facts and style direction and offers six ideas, one tap each. Saved designs that change the room can be shown in the photo.
6. The designer's eye: plan checks for the room, what Velda noticed in the photo, and 46 remodel notes that come up as things are asked for (a walk-in shower raises waterproofing, the floor recess and tempered glass), each with who to ask. Save any to a questions list; ask Velda about the room.

## How it was checked

- A real picture, a real change ("paint the wooden vanity cabinet a deep navy blue") in the Toolbelt page on the test copy: one area kept, the rest put back, 26 seconds. A marked spot: 40 seconds through the slower fallback path. Velda's look at the photo: 31 seconds, with notes specific to the photo.
- 21 unit tests and a browser test of the whole flow at desktop and phone size.
- The live build opens on the real plans: 21 rooms on two levels (30 with closets and small rooms) and the four saved designs.
- On the published page: a photo added, Velda's look (33 seconds) and the navy vanity change (48 seconds, slower because it ran while Velda was looking) both worked from the public link. The test photo was removed afterward.

## Not checked yet

- A real phone (camera, an iPhone HEIC file) and the signed-in page inside Toolbelt (the signed preview and the published page were checked).
- Costs per change (Replicate bills them; no figures were read).
- Nano Banana as the image model and Claude as the model that looks at photos: both were refused by Replicate's own connections on 2026-11-17. FLUX.2 pro and Gemini 3 Flash did the work and are what the page falls to.

## Open decisions

- Merging pull request 1 and releasing from main.

The full record, with the platform findings, is the 2026-11-17 entry in `docs/build-log.md` in the repo (the Project's copy of the build log does not have that entry yet).
