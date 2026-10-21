# NutriCompare HK

Traditional Chinese, mobile-responsive ITC2010 functional prototype. Static HTML/CSS/JavaScript; no build dependencies, login, tracking, third-party runtime, stored health profile or paid API required.

## Features

- Chinese/English food and brand search across 1,788 records, with seven food categories and 24-item progressive loading.
- Whole-pack HKD budget and merchant filters; verified origin field when available.
- Conservative multi-allergen filtering: contains, may-contain and incomplete records are excluded.
- Up to three products compared per100g/ml or a custom comparison amount. Missing values remain unknown; package prices do not scale with the nutrition amount.
- HK retailer price snapshots, source dates and correctly labelled merchant/product links.
- Transparent fixed-keyword request parser. This is not generative AI or a clinical recommendation engine.
- Separate views for all prices, records with nutrition, and complete source-scoped HK allergy statements.

The root page and `app/` both open the functional prototype. `group-brief.html` preserves the earlier group proposal and research notes.

## Data status: 21 October 2026, version 1.3

The catalogue has **1,788 products and 4,496 merchant-price observations**. This release enriches **26 existing product identities**, using 22 Hong Kong brand/retailer records and four separately attributed Open Food Facts (OFF) records. There are now **41 records with partial/full nutrition and 35 complete source-scoped Hong Kong ingredient/allergy statements** (previously20/11). Two OFF records support complete published allergy coverage; two remain partial. Source completeness is not current-batch or cross-contact safety verification.

The underlying Consumer Council Pricewatch import includes **1,780 food records and 4,489 source price observations across nine merchant codes**. Eight independently curated products are outside that feed. Adding price data never establishes nutrition or allergy facts.

The six included Pricewatch source groups cover bakery/cereals/spreads, dairy/soy/eggs, snacks/biscuits, rice/oils/canned food/fresh ingredients, noodles/cooking/frozen food and drinks. The raw feed has 2,735 records; 955 are excluded as alcohol, personal care, household/pet goods, or the mixed milk-powder/baby-care category. Adult milk powder in that mixed category is consequently not covered. This is not all HK supermarket stock.

`app/data/pricewatch-foods.json` is the compact source catalogue. `pricewatch-meta.json` records retrieval time, coverage, exact source fields, merchant links and exclusions. `catalogue.mjs` expands common provenance and unknown fields, then merges curated evidence **only by exact source ID**, keeping independent retailer prices and evidence. Source internal IDs are not GTIN barcodes. Unknown nutrition units are not guessed from a product category. Offers are retained as source text, never silently applied to single-pack budget calculations.

The official source updates daily, but this website publishes a **stored snapshot, with no automatic daily synchronization**. Run `node tools/import-pricewatch.mjs` from the repository root to regenerate the two imported data files; then test and publish them. `--offline` reuses the locally downloaded snapshot. The source HTTP Last-Modified timestamp is not a per-product price effective date.

Government CFS NIIS was checked, including its downloadable 742-row FRL workbook. It is a general food-composition reference, not a named HK pack label. The [CFS copyright notice](https://www.cfs.gov.hk/english/notices/notices.html) requires prior written authorization for public redistribution of the compilation, so the public website links to [NIIS](https://www.cfs.gov.hk/tc_chi/nutrient/) rather than republishing its full database. No general-food values fill branded product gaps. Individual Wellcome/PNS pages can supply additional evidence, but no open whole-catalogue nutrition/allergen API was verified; inaccessible pages are not bypassed.

## Curated label evidence

New sources include11 exact-pack Nissin HK full product pages, five Kowloon Dairy manufacturer package-label artworks, Calbee Pizza90g HK retailer photos, five Garden HK retailer ingredient/precaution statements, and four OFF records (Calbee original55g, Garden chocolate chiffon60g, Vita high-calcium low-fat milk236ml, Pocari500ml). Actual photographs, brand packaging artwork and online text statements are distinguished. Older images (including a2020 Calbee pack) have visible dates/version caveats. Foreign versions, unreadable panels and same-barcode weight changes were held out rather than silently merged.

The same conservative rules yield **8 milk-source-no-listed-match choices** (previously5) and **24 peanut-source-no-listed-match choices** (previously6). Peanut avoidance plus HKD20 yields16 foods at recorded whole-pack prices, including bread, milk and noodles. This is label/price comparison, not personal dietary advice. Lactose-free milk still contains milk; contains/may-contain/factory warnings remain exclusions. Partial OFF labels never pass an active allergy restriction.

A Nissin single sesame91g page lists saturated fat higher than total fat: both fields remain unknown, with raw values and the source issue retained. They were not repaired from a five-pack page. Vita236ml photo sodium130mg/carton becomes55.0847mg/100ml rather than OFF's automatic65mg. Per-serving tables use the actual serving amount; cooking water is not added to dry-food weights. Cropped tables and absent fibre remain unknown. Label and barcode readings received independent review.

app/data/off-hk-labels.json preserves the OFF-derived subset, corrections, exact-ID mappings and photo authors/dates. It is offered under ODbL/DbCL with photo CC-BY-SA notices. All alteration/input data and exact join methods (mergeLabelSources/buildCatalogue) are public. Retain share-alike terms, Consumer Council attribution and other source notices; see [DATA-LICENCES.md](DATA-LICENCES.md).

Older overseas manufacturer and partial HKNA references retain their uncertainties. Factory precautions on Vitasoy and Vita tea are preserved. Hong Kong published sources do not prove what is on the user's current physical batch. All missing facts stay unknown.

Prices are the21October2026 snapshot, not live prices, effective dates or stock. Source/product/merchant links are distinguished; discounts, delivery fees and minimum orders are not applied. The website passed49 tests and was checked in desktop/mobile layouts. No clinical benefit or real-user testing is claimed.

## Run and check

Serve this folder over HTTP, for example `python -m http.server 8773`, then open `http://localhost:8773/`. Direct `file:` use cannot fetch the JSON reliably.

Engine and catalogue tests: `node --test app/tests/*.test.mjs`. The bulk suite checks complete in-scope import, exclusions, exact-ID preservation, prices, missing data, allergy safety behavior, and bilingual/merchant/budget search. Optional raw-source parity runs when the downloaded source snapshot is available locally.

## Optional AI integration

The current application contains no API keys. EdUHK student ChatGPT/GenAI login does not establish API entitlement. An actual integration needs an approved API endpoint, deployment/model, usage permission and server-side secret handling. Keep secrets out of GitHub Pages and never ask patients to enter university credentials. The existing deterministic data/filter functions should remain authoritative even after AI is added.

## Sources and attribution

- Prices: [Consumer Council Pricewatch open data](https://data.gov.hk/tc-data/dataset/cc-pricewatch-pricewatch), owned by Consumer Council, published via DATA.GOV.HK under [DATA.GOV.HK terms](https://data.gov.hk/en/terms-and-conditions). The source organizations do not endorse this prototype.
- Partial local nutrition references: [HKNA Prepackaged Snacks 2026](https://www.hkna.org.hk/database-of-prepackaged-snacks-2026/).
- OFF: [Open Food Facts contributors](https://world.openfoodfacts.org), [ODbL](https://opendatacommons.org/licenses/odbl/1-0/) / [DbCL](https://opendatacommons.org/licenses/dbcl/1-0/), photo authors and CC-BY-SA credits in each record.
- Manufacturer facts: per-product source links; foreign market differences explicitly retained.
- Label interpretation: [Centre for Food Safety FAQ](https://www.cfs.gov.hk/english/faq/faq_14.html).

Generic package illustrations are original CSS/SVG artwork, not photographs of actual product packaging. Brand and retailer rights remain with their respective owners.
