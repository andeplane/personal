# Keep the 3D plans and Imagegen images together

The user explicitly requires the photorealistic images to follow the current
storage designs. Never restore or relabel an old image as a new plan preview.

- Whenever room geometry, shelving, basket quantity/placement, loft, product
  dimensions or layout depth changes, export fresh car-free 3D references and
  regenerate every affected Imagegen image before publishing.
- Use the current plan rendering as the geometry authority. Original garage
  photographs supply materials and the appearance of belongings, not an older
  storage arrangement. Keep a clean, realistic look; typical garage items the
  family does not own are allowed as illustrative contents.
- Check each output against its own reference: all recess inserts, both upper side runs and the charger
  opening, the correct rear shelving system, shelf positions, loft, one sled,
  ladder, and the distinct wall-only, balanced-rack, fitted-recess/open-bay and 80 cm bulk strategies. Reject output that redesigns
  the storage or substitutes invented furniture.
- Keep the source render beside each generated image so the comparison is
  visible. Static images show default settings, not live slider changes.
- Record the source-model fingerprint, source-render hash, prompt and final
  image hash in `photo-prompts.json` only after regenerating and inspecting
  the images. Never update fingerprints merely to make validation pass.
- Run `python3 garage/validate-images.py`. A stale image is a release failure,
  not something to conceal with a collapsed section or an earlier-image label.

Prefer ready-sized products. The user permits cutting real purchased boards when useful; show stock SKU, dimensions, cut list, supports and whole-board quantities. Never invent a retail product for a fitted piece.
