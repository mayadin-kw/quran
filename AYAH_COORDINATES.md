# Ayah coordinate data

The visible page art in this project is a scanned/decorated version of the
**Mushaf al-Madinah, Hafs ʿan ʿAsim, King Fahd Complex (KFQC)**.  The local
`ayah-coordinates/001.json` through `604.json` files are Quran SVG's matching
Hafs/KFQC per-ayah polygon data in its native `345 × 550` space.

Source: [Quranpedia / Quran SVG](https://github.com/quranpedia/quran-svg),
`mushafs/hafs/kfqc/json`.  The polygon/JSON contribution is CC0 1.0; the page
art is KFQC material permitted for digital/web/software use under the source
repository's NOTICE.

The displayed JPEGs are not the SVG artwork itself: they have an ornamental
frame and scan-specific crop. `ayah-coordinate-calibration.json` therefore
contains an affine transform for each *verified matching* image page. It was
created by `tools/calibrate_ayah_coordinates.py`, which registers the Quran
SVG glyph outlines to the actual project JPEG using SIFT/RANSAC and records
the residual error. This is a data-generation calibration, not a CSS offset.

Pages 1 and 2 are deliberately marked unavailable. Their opening-page text is
laid out in an ornamental circle while the Quran SVG opening spread is linear,
so its polygon data is incompatible. The reader exposes a developer warning
instead of drawing a false highlight. Add a coordinate source specifically for
those two scans, then rerun/extend the calibration before enabling them.

At runtime the image and SVG overlay occupy the same rendered rectangle. The
SVG viewBox is set to the JPEG's natural dimensions and each source polygon is
given its calibrated matrix. CSS `object-fit: contain` is therefore harmless:
the outer page container and both layers get exactly the same layout and scale
together on desktop and mobile.
