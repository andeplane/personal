# Print history

Live: https://andeplane.github.io/personal/printing/

A public, read-only print ledger. No printer credentials, LAN endpoints or controls.
The canonical data is one JSON file per run under `records/`; `build.py` validates
records and local image references and generates `records.json` for the page.
The browser searches and filters this data, with expandable image galleries.

## Logging workflow for printing agents

1. Fetch `andeplane/personal` main and create an isolated worktree. Copy an existing
   record into `records/<date>-<project>-<attempt>.json`, with a new unique ID.
2. Before starting: record `planned`, source 3MF SHA-256, plate and exact parts,
   slicer duration/grams/meters, material, color, nozzle and layer height.
   Read `Metadata/slice_info.config` and the selected plate's G-code; estimates
   are not measured usage. Extract the exact plate's thumbnail and top view into
   the run's assets folder. Do not alter a print's authorization or safety gates.
3. When the printer starts, update to `printing` and record the observed start.
   Save a fresh camera snapshot during printing, with UTC ISO capture time and caption.
   Use the configured Bambu MCP read-only camera tools. In the home setup, if the
   snapshot tool returns an unusable localhost:0 URL, the existing read-only
   `capture_camera.py` helper in the home-mini Bambu installation can capture a
   frame using stored pairing; copy the image immediately because it is overwritten.
   Never expose pairing values or open an HTTP listener to work around the URL.
4. At terminal state, save another frame and record `completed`, `failed` or
   `cancelled`. Store actual start/end and duration only when observed reliably.
   `actualGrams` is null unless separately measured or reliably reported.
   A reset elapsed counter is missing data, not zero duration. Say when parts
   were already removed or the view cannot confirm the print's physical outcome.
5. Use null for missing timestamps/measurements. Planned records may also have null preview and layout until an exact slice exists; the page displays that evidence as pending. Keep estimates numeric when
   available. `recordedAt` is the registration time, never an invented print date.
   Include brief evidence and notes; do not put private identifiers in records.
6. Run `python3 printing/build.py` and `node --check printing/printing.js`.
   Commit record + images + generated index; open/merge a PR once checks pass,
   preserve parallel work, and verify the matching Pages deployment and live JSON.

Use the seeded record as the current schema. Image paths must start with `assets/`
and be relative to `printing/`. `source.sha256` identifies the exact sliced file; use null when historical bytes cannot be recovered. Every run must have a project; the page derives the project filter from records.
Retries and reprints must always have distinct IDs, even with the same file hash.
Two photos from the same stage are allowed only with honest stage captions;
collect during-print and completion images for future runs whenever possible.

Historical entry `enigma-five-9f68de72` was recovered from the printer's last-job
state. Its print dates and actual duration/usage are unknown; the two camera
captures show the empty plate after parts were removed. It is not a full backfill
of earlier print history.

Optional `evidenceImages` holds derived slicer/toolpath images and human-supplied
photos with an unknown capture time separately from timestamped camera `snapshots`.
Label an actual human photo explicitly and state that its capture time is unknown;
never substitute its receipt time or label it as a derived image. Each entry has `src`, `kind`, a caption explaining its proof
boundary and SHA-256. The builder verifies exact bytes. Do not invent camera
capture timestamps or put a derived rendering in the camera collection.
