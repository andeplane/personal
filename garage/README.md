# Garage 3D planner

Live: https://andeplane.github.io/personal/garage/

Six flexible storage alternatives for a 2.83 × 6.10 m garage, with clickable product information, empty/equipped views, camera presets, optional car and three transverse bikes with adjustable nesting. D/E include the latest nearly full-width rear storage extensions.

Switching layouts preserves the current camera angle, pan and zoom for direct comparison. Camera presets and Reset view still reset the view explicitly.

## Develop

From the repository root:

```sh
python3 garage/build-viewer.py
python3 -m http.server 8766
```

Open http://localhost:8766/garage/. Python 3 builds the committed JavaScript; no Python dependencies are needed. The browser imports pinned Three.js 0.158.0 modules from jsDelivr and therefore needs internet access and WebGL.

Edit `design-data.json` for product and layout data. Geometry and interaction source: `materials.js`, `room.js`, `products.js`, `bikes.js`, `expanded-storage.js`, `storage.js`, `example-contents.js`, `left-wall.js`, `interaction.js`. `storage.js` builds mixed shelf openings independently of example contents. The optional upper study uses an explicitly assumed rear clearance; it is not a roof measurement. `source/visual-template.html` supplies the original base geometry. `build-viewer.py` combines those sources into `viewer.js` and updates its cache-busting URL. Do not edit generated `viewer.js` directly.

The existing GitHub Pages workflow rebuilds and checks the planner on every push to main, then deploys the whole existing site. Other site pages are preserved.

Read `alternatives.md` for assumptions and product sources. Prices are a 6 September 2026 snapshot. Car version, equipment envelopes and bike interlocking are provisional. Custom construction has estimated costs and no engineered load rating. Raw Polycam scans, original photos and local diagnostic screenshots are not included.

## Check storage changes

```sh
python3 garage/validate-design.py
npm install --prefix /tmp/garage-check --ignore-scripts --no-audit --no-fund three@0.158.0
node garage/check-storage.mjs /tmp/garage-check/node_modules/three
```

Geometry checks run the actual helpers with pinned Three.js, without WebGL. They check example bounds and shelf collisions, not physical fit. The Pages workflow runs both checks. See `alternatives.md` for the 21 October 2026 review, observed categories, flexible-capacity brief, upper-space assumptions and unpriced additions. Original photos are not published.

The left-wall module uses the supplied 54.5 × 63.5 cm representative opening and about 9 cm recess depth. Its full-wall placement is a photo-based study. Keep its geometry behind the stud faces, preserve bracing and the charger span, and do not count its shallow shelves as rear-rack capacity.
