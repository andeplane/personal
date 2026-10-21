# Garage storage planner

Live: https://andeplane.github.io/personal/garage/

Four coordinated whole-garage plans compare 40, 50, 60 and 80 cm rear storage. Each uses the existing left-wall recesses, optional high baskets, right-wall gear storage and existing loft. The default is the 50 cm comparison. Switching layouts preserves the camera, pan and zoom; presets and Reset view change it explicitly.

## Develop

From the repository root:

```sh
python3 garage/build-viewer.py
python3 -m http.server 8766
```

Open http://localhost:8766/garage/. The viewer imports pinned Three.js 0.158.0 modules from jsDelivr and needs internet / WebGL. There is no build-time Python dependency.

Edit `design-data.json` for layout and evidence data. Source modules: `materials.js`, `room.js`, `products.js` (object inspection), `bikes.js`, `expanded-storage.js` (right wall), `example-contents.js`, `left-wall.js`, `space.js` (loft and access), `storage.js`, `summary.js`, `interaction.js`. `source/visual-template.html` supplies the base geometry; `build-viewer.py` combines the sources into committed `viewer.js` and updates its cache-busting URL. Do not edit generated `viewer.js` directly.

## Validate

```sh
python3 garage/validate-design.py
npm install --prefix /tmp/garage-check --ignore-scripts --no-audit --no-fund three@0.158.0
node garage/check-storage.mjs /tmp/garage-check/node_modules/three
```

The Pages workflow rebuilds and checks the model before deploying the whole existing site. Geometry checks cover 64 combinations using actual Three.js without WebGL. They establish internal consistency, not physical fit or loading. See `alternatives.md` for measurements, assumptions, allocation and proof boundaries.

The representative left-wall opening is 54.5 × 63.5 cm and about 9 cm deep. Lower inserts remain flush; high basket projection and clear height are adjustable. Bracing and the charger span remain intact. Whole-wall placement, loft footprint / loading, roof profile, equipment sizes and real passability remain provisional. Original photos and scans stay local.

## Photorealistic concepts

Each selected plan has a car-free photo concept below the interactive model. These were generated from that plan's entrance-perspective 3D rendering and the supplied garage photos using ImageGen CLI / gpt-image-2. Selected generated JPEGs are in `assets/`; generation and targeted refinement prompts are in `photo-prompts.json`. Original photographs remain local.

The images show default settings and do not update with the sliders. AI-generated shelf details and perspective can differ; use the interactive model and design notes for dimensions. No photo is evidence of physical fit or a completed installation.
