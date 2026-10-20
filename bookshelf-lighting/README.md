# Bookshelf lighting guide

Published at <https://andeplane.github.io/personal/bookshelf-lighting/>.

Static Norwegian build guide for five miniature lanterns: a shared two-wire trunk, parallel resistor-limited branches and an external always-on USB power bank. Includes actual prototype STL/STEP files, editable CadQuery source, assembly reference, validation report and a complete shopping list including tools.

`components.json` holds the purchase data, exact links, quantities, source limitations and 20 October 2026 check date. After updating it, run:

```sh
python3 bookshelf-lighting/build-page.py
```

This refreshes the static product rows inside `index.html`, the UTF-8 CSV, the downloadable README and ZIP. It does not regenerate CAD. The page remains readable without JavaScript. `app.js` adds search, origin filters, local-only purchase checkboxes and an optional three.js STL viewer. three.js 0.158.0 loads from jsDelivr on demand; the CAD image and downloads remain available if the viewer cannot load.

The CAD was created in the `rekkehus/bookshelf-lighting` project. Source and pinned CAD dependencies are included under `downloads/`. The page explicitly distinguishes mesh/geometry verification from the pending physical, lamp-current and thermal tests. No lamp disassembly, print, electrical build, order or checkout was completed by publishing this guide.

Preview from the repository root using a static HTTP server. No dependency installation or frontend build is required. The parent repository's existing garage build still runs in Pages CI.
