# NutriCompare HK v1.12 release

Release date: 16 November 2026. This update builds on public v1.11 commit `5dc1011d4bb66ffeb539fa8050833647498617de`.

## Included

- 358 distinct US-market USDA FoodData Central reference records, appended under separate FDC identities. Of these, 316 have complete 1+7 numeric tables and 42 are partial. The data were retrieved on 13 November 2026; source publication dates remain visible and are not replaced by the release date.
- Four original, locally hosted photographs for two existing Vita 236 ml products. Product details preserve the photographer/uploader, upload date, original-image link, CC BY-SA 3.0 licence and unchanged-file status.
- Separate Hong Kong priced, international, USDA-only and OFF-only scopes. Overseas references have no invented Hong Kong price, origin, retailer or reviewed allergy statement. The default Hong Kong catalogue remains 1,788; international references total 1,615 and all scopes together contain 3,403 records.
- Source GTINs on USDA cards to distinguish same-title records. No name-based merge of different barcodes or markets.
- Carbohydrate ranking separated by known total/available definition and g/ml basis. Unknown definitions remain visible without a numeric rank. The comparison table also blocks incompatible carbohydrate lowest/gap claims.

A further source-basis audit quarantined one record from the preliminary 359-record candidate: FDC-2774415 reports 245 g versus “1 Pack (36g)”. It is excluded rather than recalculated. One small 30 g versus 28 g discrepancy remains with a visible uncertainty note. The runtime normalizer rejects material explicit gram-basis conflicts. Full source evidence is retained in [serving-basis holds](evidence/v112/serving-basis-holds.json).

- An AI result requesting a validated Hong Kong merchant or budget switches an unpriced reference scope back to the priced HK catalogue when the link does not explicitly request another scope. A visible note explains the switch; selected allergen exclusions remain authoritative.

## Verification

The final Node suite has 240 tests: 239 pass, zero fail and one optional original raw-price-snapshot check is skipped. Tests include carbohydrate-ranking and source-serving consistency regressions. Two independent code/data reviews checked the actual release payload, not only fixtures.

All 3,222 active nutrient cells were compared with the declared saved official API responses. The 150 less-than-derived fields across 133 records remain unknown, as do four originally absent trans-fat fields. All ten original Hong Kong JSON files are byte-identical to v1.11.

The final candidate was inspected in the in-app Chromium browser: source-photo cards/details and credits, USDA market and missing-price notices, carbohydrate grouping, international counts, allergy exclusion, and clearing price restrictions while retaining the selected allergen. Mobile viewport inspection and public deployment readback are recorded in the local release evidence. The earlier 13 November 17-check report remains historical evidence and is not a new live MaaS test.

One live MaaS query was verified end to end on 16 November: “惠康有冇低糖檸檬茶？每包20蚊以下。” The reply automatically filled the result link, conditions stayed unchanged until confirmation, and applying it selected the priced HK scope, WELLCOME, HK$20 and sugar order, yielding five results. Closing removed the iframe. This is an assistant-run integration check, not a user study or exhaustive AI evaluation.

## Limits

The Hong Kong price snapshot remains 21 October 2026. These overseas references do not count toward the 1,000 original-product Hong Kong-source target, which remains unmet. Photographs do not establish the current physical pack or complete a partial allergen statement. Comprehensive MaaS acceptance across all conditions, real phones, real users and clinical outcomes are not established by this release. The separate comparison-explanation feature stays disabled.

Source and licence details: [v1.12 data sources](v112-data-sources.md), [data licences](../DATA-LICENCES.md) and [photo credits](../app/assets/product-photos/CREDITS.md).

The previous public version is commit `5dc1011d4bb66ffeb539fa8050833647498617de`. Keep any rollback scoped to this release; do not erase unrelated later work.
