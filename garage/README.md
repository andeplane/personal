# Garage 3D planner

Live: https://andeplane.github.io/personal/garage/

Six dimensioned storage alternatives for a 2.83 × 6.10 m garage, with clickable product information, empty/equipped views, camera presets, optional car and three transverse bikes with adjustable nesting. D/E include the latest nearly full-width rear storage extensions.

## Develop

From the repository root:

```sh
python3 garage/build-viewer.py
python3 -m http.server 8766
```

Open http://localhost:8766/garage/. Python 3 builds the committed JavaScript; no Python dependencies are needed. The browser imports pinned Three.js 0.158.0 modules from jsDelivr and therefore needs internet access and WebGL.

Edit `design-data.json` for product and layout data. Geometry and interaction source: `materials.js`, `room.js`, `products.js`, `bikes.js`, `expanded-storage.js`, `interaction.js`. `source/visual-template.html` supplies the original base geometry. `build-viewer.py` combines those sources into `viewer.js` and updates its cache-busting URL. Do not edit generated `viewer.js` directly.

The existing GitHub Pages workflow rebuilds and checks the planner on every push to main, then deploys the whole existing site. Other site pages are preserved.

Read `alternatives.md` for assumptions and product sources. Prices are a 6 September 2026 snapshot. Car version, equipment envelopes and bike interlocking are provisional. Custom construction has estimated costs and no engineered load rating. Raw Polycam scans, original photos and local diagnostic screenshots are not included.
