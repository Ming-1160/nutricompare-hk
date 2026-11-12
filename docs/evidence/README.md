# Check records

Output of the automated checks run before each release. They show what was checked and what was not. They are not user tests.

| File | What it is |
|---|---|
| `2026-11-12-v110-unit-tests.txt` | `node --test app/tests/*.test.mjs` on v1.10: every test name and its result. |
| `2026-11-12-v110-browser-checks.txt` | `tools/acceptance/v110.cjs` on v1.10: one line per check, then the axe-core result for each screen. |
| `2026-11-12-v110-batch1-browser-checks.txt` | `tools/acceptance/v19-batch1.cjs` on v1.10: the version 1.9 batch 1 checks, run again to show nothing was broken. |
| `2026-11-12-v110-assistant-link-unit-tests.txt` | The unit tests again, after the MaaS assistant link was added to `app/ai-config.mjs` later the same day. |
| `2026-11-12-v110-assistant-link-browser-checks.txt` | `tools/acceptance/v110.cjs` again with the link in place. Two more checks than before: a "no link yet" case was added because the settings file now has a link. |
| `2026-11-12-v110-assistant-link-batch1-browser-checks.txt` | `tools/acceptance/v19-batch1.cjs` again with the link in place. |

How they were produced: the release files were unpacked into an empty folder, served by a local web server, and checked with Chromium (phone emulation 390 px and desktop 1366 px). The unit tests in that folder skip one test that needs the original raw Pricewatch file; with that file present all tests pass.

Limits: no real phone, no Safari or Firefox, not the GitHub Pages address, no real users. These checks never open the MaaS assistant. The checks were written and run by the same AI assistant that wrote version 1.10.

The MaaS assistant itself was tested separately on 12 November 2026 through its share link. The questions, expected behaviour and results are in sections 5 and 7 of [`docs/maas-assistant.md`](../maas-assistant.md). Those tests were also run by the AI assistant, not by group members or users.

To run the checks again, see `tools/acceptance/README.md`.
