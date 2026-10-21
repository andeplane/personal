# Garage storage planner

Static Three.js planner at <https://andeplane.github.io/personal/garage/>. Plans use real catalogue components: original IKEA BOAXEL (40 cm), original BROR + BOAXEL (55 cm), and AJ TRANSFORM starter / extensions at 60 and 80 cm. Every selectable new component has a SKU, current Norwegian retailer link and VAT-inclusive price. Existing room / belongings are context, not invented purchase products.

Switching plans preserves the camera, pan and zoom. View presets and Reset view change the camera explicitly.

## Build and checks

```sh
python3 garage/build-viewer.py
node --check garage/viewer.js
python3 garage/validate-design.py
python3 garage/validate-images.py
python3 garage/test-image-freshness.py
npm install --prefix .garage-check --ignore-scripts --no-audit --no-fund three@0.158.0
node garage/check-storage.mjs "$PWD/.garage-check/node_modules/three"
```

Run heavier geometry verification on home-mini via `codex-home` per the workspace instructions. `viewer.js` is generated; edit the modules and rebuild. The builder also updates its hash in `index.html`.

The geometry check covers 48 combinations: four plans, five roof heights, baskets on / off, and two extra loft / parked-mode cases. It checks actual stock basket geometry, model-to-shopping quantities, shelf / equipment collisions, mixed openings, one sled and ladder, retained braces, the local charger keepout, rear footprints / assumed roof clearance, comparison areas and loft approach status. It does not establish a physical installation, structural backing, loading or measured fit of the belongings.

## Left wall

Retain all 27 schematic existing ledges / mini shelves in the representative 54.5 × 63.5 cm openings, about 9 cm deep. Seven 198 cm Elfa rails and one stock 316 mm rail above the charger carry 27 small and eight large baskets in the default model. Small baskets are 435 × 80 × 70 mm; large baskets 435 × 135 × 140 mm. They never resize to fit a brace or ceiling. Installed projections include the rail / mounting gap: 98 mm low down and 153 mm at 186 cm height. Rails attach to the existing stud faces, in front of the retained braces; the recess shelves stay behind.

The charger reservation is local in height and length rather than an empty two-metre wall span. Actual whole-wall stud, brace and charger locations are photo-based, so installation needs those positions checked. There are no bespoke inserts, fake baskets, custom timber extensions or fractional material purchase quantities.

## Sources and images

`design-data.json` records product identities, prices, fixed stock dimensions, source links and the original catalogue baseline commit. `alternatives.md` explains installation assumptions and scope.

The current car-free Imagegen images are generated separately from each default plan's exported 3D view. Every image is paired with that exact source view, follows the selected plan, and states its 40/55/60/80 cm shelf depth. The full left-wall basket arrangement, charger opening and each retail shelving system are part of the generation brief. Contents are clean, illustrative garage styling; they may include typical items the family does not own. Slider and checkbox changes remain interactive model views.

`validate-images.py` blocks Pages deployment when model geometry, product dimensions, default storage settings, source renders or generated assets differ from the reviewed generation manifest. Price-only updates do not invalidate images. `test-image-freshness.py` deliberately changes baskets, depths, rendering code, defaults and image files to exercise that guard. Follow `garage/AGENTS.md`: regenerate and inspect images, never just restamp their hashes. Original garage photographs remain private; no original is published.
