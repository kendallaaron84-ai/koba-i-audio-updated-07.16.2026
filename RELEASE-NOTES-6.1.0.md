# KOBA-I Audio 6.1.0 — Illustrated EPUB MVP

Production upgrade baseline: `6.0.23`

Release artifact: `koba-i-audio-6.1.0.zip`

## Scope

- Standards-based illustrated reflowable EPUB presentation.
- Embedded JPEG/JPG, PNG, GIF, and safely supported SVG assets.
- Responsive containment that preserves aspect ratio and avoids unnecessary enlargement.
- EPUB reading order, supplied alternative text, figure/caption relationships, and compatible publisher styling remain intact.
- The existing publication `CoverArtUrl` is presented as the contained first reading view when valid, without blindly duplicating an EPUB-defined cover.
- Missing or broken images are isolated so remaining chapter content and reader controls continue working.
- The existing E-Book Workbench chapter editor can upload and insert JPEG, PNG, GIF, and safely stored SVG images at the current writing position. Inserted images remain inside the existing chapter HTML contract and persist through Save Draft/reload.

## Explicit exclusions

- No fixed-layout or pre-paginated EPUB renderer.
- No comic, manga, panel-navigation, OCR, image generation, gallery, page-composition canvas, or separate media-management workflow.
- No reader authentication, entitlement, protected-media, publication-record, or tenant-binding changes.

## Version contract

The plugin header, `KOBA_IA_VERSION`, Composer package metadata, updater manifest, test expectations, and archive filename are all `6.1.0`. WordPress's updater uses PHP `version_compare`; `6.1.0` compares greater than the installed `6.0.23` baseline.

## Functional acceptance

- Twelve deterministic EPUB fixture archives cover text-only, JPEG, transparent PNG, safe SVG, inline, full-width, full-page-like, captioned, multiple-image, broken-image, cover-deduplication, and cover-fallback behavior.
- The packaged reader implementation and stylesheet pass all 36 browser combinations at desktop, 430px, and 390px.
- The existing 64-test reader, navigation, progress, session, entitlement, storefront, audio, and video regression suite passes without failure.
