# Personal site and 3D print history

This repository publishes https://andeplane.github.io/personal/ via GitHub Pages.
Preserve concurrent changes. Use an isolated branch/worktree from current origin/main.

## Log every print

For every printer job we prepare/start, create one durable record in
`printing/records/<run-id>.json` and images in `printing/assets/<run-id>/`.
Read `printing/README.md` before logging. Update that same run during printing
and after completion, failure or cancellation. Every retry gets a NEW run ID;
never overwrite an earlier attempt or infer that every SD-card file was printed.
Do not delay a required printer safety action because logging is unavailable.

Capture the exact plate's real slicer preview and top view from its 3MF,
at least one camera image during printing and one at completion when available.
Preserve capture timestamps and describe what each actually shows. Never label
an empty-bed image as a finished-part image. Missing historical evidence stays
explicitly missing; do not fabricate screenshots, times, dates or usage.

Store source filename/hash, project, printer MODEL (no private identifiers),
plate, part inventory, material/color, nozzle/layer settings and outcome.
Keep slicer estimates separate from actual elapsed time and measured usage.
Printer FINISH proves reported completion, not physical quality or fit.

Run `python3 printing/build.py` and `node --check printing/printing.js`.
Commit the individual record, images and generated `printing/records.json` together.
Publish through a reviewed PR, check Pages deployment, and verify the live record.
A local record or passing agent process is not evidence of publication.
Never commit credentials, printer IP/serial/access code, or raw telemetry dumps.

Before publishing a human-supplied photo, inspect its metadata without logging
private values. Remove location/device metadata from the public copy while
preserving image pixels and orientation; keep the original privately and record
the sanitization. Never invent a missing capture timestamp.

When changing `printing/printing.js`, update its content-hash query in
`printing/index.html`; the regression check must bind the renderer bytes so
a cached script cannot hide a newly recorded outcome.
