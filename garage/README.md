# Garage planner

Static Three.js planner: <https://andeplane.github.io/personal/garage/>.
Edit source modules and `design-data.json`, then run `python3 garage/build-viewer.py`; `viewer.js` is generated.

Plans differ in whole-room allocation: A wall shelves/loft, B two BROR racks, C fitted recess shelves/one rack/open bay, D two 80 cm TRANSFORM bays. All purchase items have a SKU, dimensions, VAT-inclusive price and direct retailer link. Existing belongings and shell are context. Only C cuts boards; stock boards and whole-board quantities remain explicit.

See [design principles, evidence and tradeoffs](alternatives.md).

## Checks

```
python3 garage/build-viewer.py
python3 garage/validate-design.py
node --check garage/viewer.js
node garage/check-storage.mjs /path/to/three@0.158.0
python3 garage/validate-images.py
python3 garage/test-image-freshness.py
```

Run heavier geometry tests on a home worker using `codex-home`, following the user's host instructions. Browser/WebGL checks run locally. Geometry checks cover four plans, five roof heights, recess additions on/off, and two extra loft/parking cases. Cut-board shares round up to whole stock boards in the shopping list. The comparison table computes each plan's own quantities independently of the currently selected plan.

## Image freshness

Follow [AGENTS.md](AGENTS.md). A changed scene requires new source renders, new Imagegen images and visual review. Do not merely update the manifest hash. Generated images reflect default settings; sliders update the live model. Private source photographs stay outside the public repository.

`validate-images.py` binds source geometry, product dimensions, defaults and final assets. `test-image-freshness.py` verifies changes are rejected; price-only changes do not require regeneration.
