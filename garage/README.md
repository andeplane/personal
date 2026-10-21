# Garage storage planner

Static Three.js planner at <https://andeplane.github.io/personal/garage/>. Plans use real catalogue components: original IKEA BOAXEL (40 cm), original BROR + BOAXEL (55 cm), and AJ TRANSFORM starter / extensions at 60 and 80 cm. Every selectable new component has a SKU, current Norwegian retailer link and VAT-inclusive price. Existing room / belongings are context, not invented purchase products.

Switching plans preserves the camera, pan and zoom. View presets and Reset view change the camera explicitly.

## Build and checks

```sh
python3 garage/build-viewer.py
node --check garage/viewer.js
python3 garage/validate-design.py
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

The retained car-free generated images belong to the earlier concepts. An always-visible Imagegen gallery, a link next to the plan price, and a preview beside the model keep them easy to find. The preview and large image follow the selected plan; all four originals remain available at full size. The page states that they predate the latest shelf and basket changes. Original garage photographs remain private; no original is published.
