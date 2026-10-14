# KOBA-I Audio 6.2.1 Reader Release Candidate

This release candidate integrates two independently reviewed Reader improvements on top of the approved `5f374f29` WordPress security baseline.

- Closed Reader Settings controls are hidden and inert before, during, and after the existing close transition.
- Intentional typography changes remain keyboard-accessible and continue using the existing preference contract.
- Illustrated pages can open in an accessible expanded viewer with Fit, Zoom In, Zoom Out, Reset, Close, pinch-to-zoom, pan, keyboard controls, mouse-wheel zoom, and double-click reset.
- Expanded viewing reuses the already-authorized protected image URL and does not create a new media identity or authorization path.
- Closing or regrouping the viewer restores focus to the exact `chapterId + pageId` trigger.
- Switching between single-page and same-chapter spread layouts preserves the exact selected page, including a selected right-hand page.
- Existing chapter-local spread boundaries, durable progress identity, bounded image residency, and reflowable reading behavior remain in place.

The production updater remains frozen at 6.1.0. This 6.2.1 release candidate is for isolated validation only and must not be published through the shared updater or installed on a production site without separate site-specific founder authorization.
