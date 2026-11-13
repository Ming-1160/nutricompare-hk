# NutriCompare HK v1.11 release

Release prepared on 13 November 2026 from the v1.11 preview, based on the existing GitHub Pages release at commit 5994818.

The release adds the redesigned shopping interface, original category illustrations, and an on-demand embedded MaaS assistant. AI result links require explicit confirmation before the website validates and applies conditions. Existing allergy choices are retained. The origin-filter URL round trip is also fixed.

The ten product data JSON files, allergy exclusion rules, price snapshot, MaaS share link, model settings and disabled comparison explanation are unchanged.

Prepublication verification on the release candidate:

- Node tests: 229 total, 228 passed, zero failed, one skipped because the optional original Pricewatch snapshot is not bundled.
- Chromium interface smoke checks: 14 passed, zero failed, no page errors. These include approved result-link import yielding 13 products while retaining peanuts, external-link rejection, comparison selection restoration, three-column mobile comparison, and explicit iframe load/unload.
- The smoke browser served the exact candidate files through request fulfillment and substituted a static frame for MaaS. It made no live AI requests. The actual MaaS frame and greeting had loaded during the earlier preview review; a completed live AI response-to-import flow remains unverified.
- No real-user, real-phone, Safari or Firefox verification is claimed. The earlier home-page accessibility scans are historical preview evidence, not a complete release accessibility audit.

The files under evidence/v111-preview and v111-preview-notes.md preserve the preview-stage record. Their statements about not yet publishing describe that earlier stage.

Publishing this release updates the existing public GitHub Pages prototype. It does not constitute teacher submission or completion of the pending fieldwork and user testing.
