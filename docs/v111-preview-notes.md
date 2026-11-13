# NutriCompare HK v1.11 preview

13 November 2026. Local preview based on the exact v1.10 AI-link release at commit 5994818. No push or deployment has been performed.

## Changes

- Rebuilt the header, compact introduction, search controls, category navigation, product cards and comparison tray around the shopping task. Added original SVG shopping and category illustrations; no unverified product photographs.
- Added an on-demand in-page MaaS dialog, clear processing notice and external fallback. Opening the dialog alone does not create an iframe; the load button does. Closing unloads the frame. The existing model, prompt, expiry and public share link are retained.
- Imported AI result links require the exact official HTTPS project URL and explicit confirmation. Message origin and frame source are checked. Product figures are never imported from AI. Existing allergy choices are retained and the normal parser validates every condition. Data-loading holds continue to block comparisons and AI-result imports.
- Fixed origin filters disappearing from shared URLs. Origin values must exist in the actual catalogue. Added four origin regression tests and five embedded-assistant helper tests.
- Updated the privacy receipt's scope for cross-origin frames, stale project-page wording, three-person contribution placeholders and test instructions. The comparison AI explanation remains switched off.
- Module/cache references use v=111 consistently. Data files, nutrition facts, allergen decisions and the price snapshot were not changed.

## Design references

The information hierarchy is an adaptation informed by FoodSwitch's nutrient sorting and similar alternatives, Yuka's detail sheets and Open Food Facts' comparison and missing-data workflow. These were official-page reviews, not installed-app tests. No health score or suitability judgement was adopted.

- https://www.foodswitch.com/app/foodswitch/
- https://yuka.io/en/app/
- https://openfoodfacts.github.io/smooth-app/
- https://doc.fastgpt.io/en/guide/build/publish/link

## Verification and limits

See docs/evidence/v111-preview/verification.json and unit-tests.txt. Unit tests: 228 pass, zero fail, one optional raw snapshot skip. Mobile first-card actions measured about603px from the top, with three selected products fitting a334px comparison table. Ten bundled JSON data files are unchanged.

The actual MaaS frame and greeting loaded. Full AI reply/import end-to-end, all dialog accessibility states, real phones and non-Chromium browsers are not signed off. Home-page axe scans returned zero violations, but six desktop contrast checks were incomplete and need manual checking. Browser use was stopped before the final import test. Do not describe this preview as fully acceptance-tested or deployed.

## Run locally

Serve the extracted folder over HTTP, for example `python3 -m http.server 8773`, and open http://localhost:8773/ . Opening index.html directly may prevent JSON from loading. The ZIP contains the website at its root, but review it before copying it into the GitHub repository. Do not replace the live site until Ming approves.

## Still pending

Actual fieldwork labels and second-person verification; T1-T5 user tests; iPhone/Android and fresh-browser mobile-data tests; English interface; decision on comparison AI explanation; presentation and video materials; full updated browser acceptance and manual contrast review.
