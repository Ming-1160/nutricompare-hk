# Browser checks

These two scripts open the site in a real browser (Chromium, through Playwright), go through the main tasks at phone and desktop size, and run axe-core on each screen. They are developer tooling. The website does not load anything from this folder.

| Script | What it checks |
|---|---|
| `v19-batch1.cjs` | Version 1.9 batch 1: nutrient line on phone cards, brand words, exclusion reasons, number sources, alternatives, share link and QR code. |
| `v110.cjs` | Version 1.10: loading failures and "try again", the holds while data is missing, brand fallback, unit-price ranking, comparison marks, privacy receipt, label lesson, assistant settings, "ask the AI to explain", and what happens when a program file is missing. |

## How to run

You need Node.js 20 or later.

```
cd tools/acceptance
npm install
npx playwright install chromium
```

In a second terminal, serve the repository root:

```
python3 -m http.server 8800
```

Then:

```
node v110.cjs http://127.0.0.1:8800/
node v19-batch1.cjs http://127.0.0.1:8800/
```

Each line of output is one check, marked PASS or FAIL. The last line gives the totals and the number of screens with accessibility violations. Screenshots go to a temporary folder unless you give a folder as the second argument.

Run `node --test app/tests/*.test.mjs` from the repository root as well. Those unit tests need no installation.

## What these checks do not cover

- They run against a local server. They have not been run against the GitHub Pages address.
- They use Chromium with phone emulation. They are not a real iPhone or Android phone, and not Safari or Firefox.
- They cannot test the MaaS assistant. Where a check needs an assistant link, it uses a made-up address and only checks what the website does with it.
- They are not user tests.

The output of the last run before each release is kept in `docs/evidence/`.
