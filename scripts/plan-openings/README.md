# Reading windows and doors from a Designs Unlimited plan sheet

Used on 2026-10-04 with the as-built Level 2 sheet (A2, issue 7.2.26). The sheet PDF holds a clean 300 ppi wall drawing at 1/4" = 1' (6.25 px per inch); `pdfimages -j -png sheet.pdf img` extracts it as `img-005.jpg`.

1. `npx tsx build_l2.ts -3.1 l2.json` rebuilds the level's walls from `scripts/fixtures/geo_A2.json` (sheet offset dx -3.1, dy -126), identical to the imported model.
2. `classify.py` samples the drawing across every wall each half inch: two face lines = solid, extra lines in the core = window, nothing = opening, a line straight across = jamb.
3. `rebuild.py` finds the building outline (white connected to the sheet edge), keeps windows only on exterior walls (tub and shower outlines inside interior walls read like windows), turns gaps into doors and draws `proposal.png` for checking.
4. `apply.py` writes the corrected walls (window widths to the nearest even inch, doors to the clear gap, existing door styles kept).

Checked by eye before writing: four 3'-0" windows on the primary bedroom back wall, two on its side wall, three on the guest bedroom 3 / bath 3 wall, windows (not a door) on the primary bath outside wall, no windows on the far-left wall, a missing closet wall with a 2'-0" door by the guest bath. Window sills and heights are not on the plan (defaults 36" / 48").
