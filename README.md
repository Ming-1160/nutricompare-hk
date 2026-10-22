# NutriCompare HK

Traditional Chinese, mobile-responsive ITC2010 functional prototype. Static HTML/CSS/JavaScript; no build dependencies, login, tracking, third-party runtime, stored health profile or paid API required.

## Features

- Chinese/English food and brand search across3,051 records:1,788 original HK price-comparison products plus1,263 separately labelled, unpriced OFF community nutrition references.24-item progressive loading; original priced catalogue shown by default. This release adds no new unpriced products and removes four newly identified duplicate references.
- Whole-pack HKD budget and merchant filters; verified origin field when available.
- Conservative multi-allergen filtering: contains, may-contain and incomplete records are excluded.
- Up to three products compared per100g/ml or a custom comparison amount. Missing values remain unknown; package prices do not scale with the nutrition amount.
- HK retailer price snapshots, source dates and correctly labelled merchant/product links.
- Transparent fixed-keyword request parser. This is not generative AI or a clinical recommendation engine.
- Separate library scopes for HK priced products, OFF nutrition references, or both; further filter for nutrition, manually read HK nutrition sources, explicit100g/ml basis, or complete source-scoped HK allergy statements.

The root page and `app/` both open the functional prototype. `group-brief.html` preserves the earlier group proposal and research notes.

## Data status:22 October2026, version1.5

This release concentrates on the **original1,788 priced products**, retaining all4,496 merchant-price observations from the21October snapshot. **293** have partial/full numeric nutrition (was228), **140** have a manually read HK nutrition source (was54), **102** of those have all1+7 numeric fields, and **99** have a complete source-scoped HK allergy statement (was37). The1,000-product HK-source goal has **not** been reached. Community/secondary references and additional unpriced OFF products do not count toward that goal. A reviewed public HK source is not current physical-batch verification.

The new88 unique original-product records comprise74 HK brand/retailer records and14 separately attributed OFF photo records. They add65 previously absent nutrition tables and replace21 community/secondary tables with whole HK-source tables; two other reviewed sources attach to already stronger HK tables. Sixty-two complete published allergy statements are added. Sources include32 Lee Kum Kee exact-pack HK official label images, Nestlé HK label images, Wellcome package photos (including Meadows, Knorr, Heinz, Amoy and Doll), and dated OFF HK packaging. Every imported nutrition panel was visually read; complete allergy claims require the published ingredient and precaution statement. Partial or dated incomplete evidence does not pass allergy restrictions. Milk avoidance yields47 choices, peanut71, and peanut plusHKD20 yields49 at stored whole-pack prices; these are not safety guarantees or dietary advice.

Source identity was checked using brand, flavour, exact pack and visible physical barcode where available. Retailer internal item numbers are not package EANs. Different-flavour images mixed into a gallery, genuine barcode/pack conflicts and unreadable fields were held. Maggi200ml has conflicting HK published sodium values8500/9255mg per100ml: the display value stays unknown, while both original values/images remain accessible. Native5ml/1g/236ml source amounts and rounding notes are retained. Different formulations are never combined field by field. Existing stronger reviewed HK tables, complete allergy evidence and all original prices survive. Four old unpriced OFF entries became identifiable duplicates after barcode reading and are removed.

Government research covered DATA.GOV.HK dataset metadata, CFS NIIS, all362 entries of the Salt/Sugar product list, candidate packaging images and EatSmart. The nutrition-labelling exemption dataset contains exemption facts, not nutrient tables. NIIS general-food composition cannot fill a named pack's missing table. Candidate government images were chiefly fronts or too small to read reliably; EatSmart's snack tool accepts user-entered nutrition. This pass adds **zero government-derived numeric branded tables**; no government compilation/photos are republished or averages substituted. These findings do not establish that every government document lacks usable labels.

Public reproducibility inputs: [74 HK source reviews](app/data/hk-reviewed-labels.json), [14 OFF-derived image reviews and credits](app/data/off-hk-reviewed-labels.json), and [original-only merge, source priority, deduplication and coverage](app/hk-labels.mjs). Other source inputs remain linked below. The OFF-derived data/alterations are offered underODbL/DbCL; linked photos retain per-authorCCBYSA notices. Only links to brand/retailer images are public, not local image copies. See[DATA-LICENCES.md](DATA-LICENCES.md).

Validation:69 tests, including source/price preservation, original-only additions, unknown fields, the sodium conflict, serving arithmetic, conservative allergy behavior and deduplication. Desktop and390px mobile layouts and key source/filter dialogs were checked. No clinical or real-user validation is claimed. No background refresh or scheduled research is installed.

## Previous version1.4 snapshot

The1,788 original priced products retain all4,496 merchant-price observations. **228** now have partial/full nutrition, up from41. Another**1,267** unique OFF Hong Kong-country-tagged nutrition references have no invented HK prices or purchase channels. Across both libraries, **1,495** products have some numeric nutrition and **789** explicitly distinguish a100g or100ml basis. The remaining706 retain an unknown g/ml basis: raw per100 reference values may be viewed, but portion arithmetic and nutrition ranking are disabled. These counts do **not** mean1,000 original priced products have verified current HK nutrition labels.

Sources were researched in Traditional Chinese, English and relevant original brand languages. Official HK brand facts supply24 exact-identity candidates; the full2026 HKNA drinks/food PDFs were read (39pages,320rows) and41 exact brand/flavour/individual-pack candidates selected. After existing-source priority and overlap, these add60 nutrition tables to the original41. OFF then adds127 previously missing priced nutrition references. No different-source nutrient fields are spliced together; a partial local table is not silently completed with overseas values.

Bulk OFF research retrieved all2,385 older HK-index records, then1,208 current API records using exact-code and HK-product batches. The public dataset retains134 independently brand/name/exact-pack-consistent priced candidates after11 additional variant/quality holds, and1,299 standalone candidates after48 name/scope holds.32 barcode duplicates are removed on merge. Source-country tags are community reports, not proof of current HK sale/formulation. Current records are preferred; older index records retain their source dates and missing source quality flags. Persistent503 failures prevented a complete current refresh; no claim of exhaustive web coverage is made.

There are now**37 complete source-scoped HK allergy statements**, including two newly read Nestlé HK330g package artworks. All bulk OFF allergy statements remain unknown. Milk avoidance yields8 source-no-listed-match choices; peanut avoidance26; peanut plusHKD20 remains16. None is a safety guarantee. Trans fat is shown when actually reported; missing values stayunknown.

Published inputs: [HK brand/HKNA facts](app/data/hk-nutrition-expansion.json), [OFF-derived tables, source dates, original canonical numbers, mappings and holds](app/data/off-nutrition-library.json), and [exact merge/priority/deduplication code](app/enrichment.mjs). OFF data and alterations are attributed underODbL/DbCL; no bulk photos are rehosted or represented as read. Supplementary CC website barcode discovery responses are internal and are not republished under the open-price-feed licence. See[DATA-LICENCES.md](DATA-LICENCES.md).

Validation:56 tests cover source preservation, exact priced coverage, no duplicate expansion barcodes, unknown basis, missing prices, conservative allergy behavior, full-source priority and actual HK serving arithmetic. No clinical validation or real-user test results are claimed. Prices remain the21October2026 snapshot; no automatic refresh is installed.

## Previous version1.3 snapshot

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
