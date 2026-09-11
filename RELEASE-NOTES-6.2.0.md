# KOBA-I Audio 6.2.0

This release adds the isolated `illustrated_pages` presentation model for finished author-designed page plates.

- Missing, null, and `reflowable` layout modes continue through the existing Bloom/Jubilee reader.
- Illustrated pages are proportionally contained, centered, and never cropped or reconstructed.
- Eligible dual-page spreads use deterministic same-chapter pairing and fall back to a single page when minimum usable dimensions are not met.
- Authorized page assets are resolved by the protected manifest; durable storage identities and signed URLs remain server-side concerns.

Production promotion remains on hold until the required device and regression acceptance matrix passes.
