# NutriCompare HK

Traditional Chinese, mobile-responsive ITC2010 functional prototype. Static HTML/CSS/JavaScript; no build dependencies, login, tracking, third-party runtime, stored health profile or paid API required.

## Features

- Chinese/English food and brand search; biscuit/snack categories.
- Whole-pack HKD budget and merchant filters; verified origin field when available.
- Conservative multi-allergen filtering: contains, may-contain and incomplete records are excluded.
- Up to three products compared per100g/ml or a custom comparison amount. Missing values remain unknown; package prices do not scale with the nutrition amount.
- HK retailer price snapshots, source dates and correctly labelled merchant/product links.
- Transparent fixed-keyword request parser. This is not generative AI or a clinical recommendation engine.

The root page and `app/` both open the functional prototype. `group-brief.html` preserves the earlier group proposal and research notes.

## Data status: 21 October 2026

12 products, 31 Consumer Council merchant price observations. Six nutrition records are **overseas manufacturer references**, three are **partial HKNA references**, and three have no nutrition values. Foreign/reference formulations are not verified matches to current Hong Kong packaging. Every product preserves its sources, date, transformations and limitations in `app/data/products.json`.

**No complete current HK package allergen record has been verified.** An active allergy filter currently returns no confirmed matching products, with separate known-conflict and unknown counts. This intentionally avoids treating incomplete labels as safe. Next data step: verify actual HK packs, full ingredients/precautions and identity before changing completeness flags. Do not promote records merely to make results non-empty.

Prices were retrieved on 21 October; this is not a per-price effective date, a live price feed or a stock guarantee. Most purchase links lead to merchant homepages, clearly labelled as such. Member/multi-buy discounts and delivery charges are excluded. No clinical benefit or real-user testing is claimed.

## Run and check

Serve this folder over HTTP, for example `python -m http.server 8773`, then open `http://localhost:8773/`. Direct `file:` use cannot fetch the JSON reliably.

Engine tests: `node --test app/tests/engine.test.mjs`.

## Optional AI integration

The current application contains no API keys. EdUHK student ChatGPT/GenAI login does not establish API entitlement. An actual integration needs an approved API endpoint, deployment/model, usage permission and server-side secret handling. Keep secrets out of GitHub Pages and never ask patients to enter university credentials. The existing deterministic data/filter functions should remain authoritative even after AI is added.

## Sources and attribution

- Prices: [Consumer Council Pricewatch open data](https://data.gov.hk/tc-data/dataset/cc-pricewatch-pricewatch), under [DATA.GOV.HK terms](https://data.gov.hk/en/terms-and-conditions).
- Partial local nutrition references: [HKNA Prepackaged Snacks 2026](https://www.hkna.org.hk/database-of-prepackaged-snacks-2026/).
- Manufacturer facts: per-product source links; foreign market differences explicitly retained.
- Label interpretation: [Centre for Food Safety FAQ](https://www.cfs.gov.hk/english/faq/faq_14.html).

Generic package illustrations are original CSS/SVG artwork, not photographs of actual product packaging. Brand and retailer rights remain with their respective owners.
