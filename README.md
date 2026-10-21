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

## Data status: 21 October 2026, version 1.1

23 products and 52 merchant price observations. Eleven new Hong Kong source records comprise **five visually inspected HK-market online back-label photos** and **six full HK manufacturer/retailer online statements**. These are distinguished on cards and in details, with direct label/source links. Five records are complete HK retailer statements, not photographs of a Hong Kong sticker; one is the Hong Kong manufacturer's Bonchi record. Its unmatched 80g pack price remains unknown.

`allergens.status: complete` means all ingredients and visible allergy/precaution information in the specified HK published source were recorded; it is **not physical current-batch verification or a cross-contact safety guarantee**. An active milk restriction returns five source-scoped no-listed-match records; peanut returns six. Combining peanut with HKD20 leaves the exact 236ml Kowloon Dairy record. The three Vitasoy label versions explicitly contain milk and soy, and factory precaution statements remain exclusions. The Vita zero-sugar tea also has factory allergen warnings and is excluded accordingly.

The original twelve records remain unchanged in completeness: six overseas manufacturer references, three partial HKNA references and three price-only records. They cannot pass an active allergy filter. Missing nutrition stays unknown. Some source image paths/date stamps reflect 2022/2023/2025 packaging; source age and version limits are visible. No newly inspected current physical batch is claimed.

Prices were retrieved on 21 October; this is not a per-price effective date, a live feed or a stock guarantee. Consumer Council prices and exact HK retailer product-page prices are kept distinct. New retail channels include Glutenfree HK (monthly orders/batched delivery) and city'super. Product links and merchant homepage links are labelled separately. Member/multi-buy discounts and delivery charges are excluded. No clinical benefit or real-user testing is claimed.

## Run and check

Serve this folder over HTTP, for example `python -m http.server 8773`, then open `http://localhost:8773/`. Direct `file:` use cannot fetch the JSON reliably.

Engine and actual-catalogue tests: `node --test app/tests/engine.test.mjs app/tests/catalogue.test.mjs`.

## Optional AI integration

The current application contains no API keys. EdUHK student ChatGPT/GenAI login does not establish API entitlement. An actual integration needs an approved API endpoint, deployment/model, usage permission and server-side secret handling. Keep secrets out of GitHub Pages and never ask patients to enter university credentials. The existing deterministic data/filter functions should remain authoritative even after AI is added.

## Sources and attribution

- Prices: [Consumer Council Pricewatch open data](https://data.gov.hk/tc-data/dataset/cc-pricewatch-pricewatch), under [DATA.GOV.HK terms](https://data.gov.hk/en/terms-and-conditions).
- Partial local nutrition references: [HKNA Prepackaged Snacks 2026](https://www.hkna.org.hk/database-of-prepackaged-snacks-2026/).
- Manufacturer facts: per-product source links; foreign market differences explicitly retained.
- Label interpretation: [Centre for Food Safety FAQ](https://www.cfs.gov.hk/english/faq/faq_14.html).

Generic package illustrations are original CSS/SVG artwork, not photographs of actual product packaging. Brand and retailer rights remain with their respective owners.
