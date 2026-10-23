# Garage planner

Static Three.js planner: <https://andeplane.github.io/personal/garage/>.
Edit source modules and `design-data.json`, then run `python3 garage/build-viewer.py`; `viewer.js` is generated.

Wall storage and rear storage are independent controls. The default shows built pine shelves using the left recesses, deeper shelves high up, two 55 cm BROR rear racks and high rear boards. The rear can instead be empty, use 38 cm wall boards, one BROR rack with an open bay, 80 cm TRANSFORM racks, or the restored full-width Adrian + fitted timber bay. Existing ledges, braces, ski shelf, charger and loft are retained.

Purchase objects have a SKU, stock dimensions, VAT-inclusive price and direct retailer link. Cut shelves identify the actual stock board, cut length, notch requirement and whole-board quantity. Existing belongings and the shell are context. Fixings, joint plates, backing, finish, delivery and labour are excluded explicitly; the model is not a structural design.

See [design principles, evidence and tradeoffs](alternatives.md).

## Checks

```
python3 garage/build-viewer.py
python3 garage/validate-design.py
node --check garage/viewer.js
node garage/check-storage.mjs /path/to/three@0.158.0
node garage/check-camera.mjs /path/to/three@0.158.0
python3 garage/validate-images.py
python3 garage/test-image-freshness.py
```

Run heavier geometry tests on a home worker using `codex-home`, following the user's host instructions. Browser/WebGL checks run locally. Geometry checks cover all 96 independent combinations and 48 extra roof/loft cases. They check shelf depth, usable area after cut-outs, uncut original braces, charger clearance, supports, parking envelope, example contents and purchase quantities. Cut-board shares round up to whole stock boards. The pinned OrbitControls regression dispatches wheel events for 12 off-centre perspective/top cases and checks fixed-point projection, including a failing legacy-behavior control. Browser checks compare exact camera state before and after changing both wall and rear controls.

## Image freshness

Follow [AGENTS.md](AGENTS.md). A changed scene requires new source renders, new Imagegen images and visual review. Do not merely update the manifest hash. Ten component studies show each distinct selection without claiming to be a photograph of every possible combination. The live 3D model shows the complete selected combination and any corner pieces omitted to avoid rear storage. Each image appears beside its own source render.

Open `garage/capture.html` through the local server to prepare a component and export its current car-free 3D PNG. The same page exposes camera/configuration state for browser checks. It uses the real viewer and controls, not separate geometry.

`validate-images.py` binds source geometry, product dimensions, defaults, component configurations and final assets. `test-image-freshness.py` verifies changes are rejected; price-only changes do not require regeneration. Private original photographs stay outside the public repository.
