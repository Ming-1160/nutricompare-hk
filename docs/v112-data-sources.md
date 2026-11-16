# v1.12 overseas nutrition references and product photos

Prepared on 13 November 2026 and reviewed for release on 16 November 2026. This update follows Ming's decision to allow overseas food products with explicit source attribution. The existing website is publicly accessible; the new material therefore uses open data/image licences rather than treating coursework or non-commercial use as blanket reuse permission.

## USDA FoodData Central

The release contains358 United States-market records,316 with complete1+7 numeric values. The remaining42 have partial1+7 tables because of missing values or source less-than bounds; they are not all missing trans fat. All358 were published between23July and22October2026. The additional library uses the documented USDA Branded Foods API, saved as a static snapshot. USDA publishes FoodData Central data under CC0 1.0. No personal API key, login, live visitor-to-USDA request or retailer system is used by the website.

- Official licensing/API guide: https://fdc.nal.usda.gov/api-guide/
- Branded-food documentation: https://fdc.nal.usda.gov/GBFPD_Documentation/
- Per-product official links and original publication/modification dates are retained in the data and displayed in product details.
- The data's market country is kept separately from manufacturing origin. The source records in this release describe the United States market; no Hong Kong formulation, current Hong Kong stock or local price is inferred.
- The references have separate FDC IDs. They are appended without replacing a Hong Kong product just because its name, brand or barcode is similar.

The import selects explicit gram-based records and preserves USDA's already-standardized per100g figures. It does not divide those values by serving size again. Only exact numeric fields actually present in the source are used. Across133 products,150 source-derived LCSL (less-than) fields—111 fibre,22 protein and17 sugars—are displayed as unknown (`null`) and blocked from exact numeric ranking. The4 original missing trans-fat values remain unknown too. Fibre is outside the1+7 completeness count, so the133 products with less-than fields do not all have partial1+7 tables. Total carbohydrate remains the source's total/by-difference definition, not an assumed Hong Kong available-carbohydrate definition.

Import checks cover GTIN check digits, stated market, record dates, required nutrient units/values, energy range, mass plausibility and component consistency. Source values failing those checks are held, not corrected or filled with guesses. Record dates are distinct from this snapshot's retrieval date. Selection is a bounded reference subset, not a representative market survey or a guarantee of latest versions outside the queried results.

An earlier trial from the October2026 bulk-export prefix exposed old2019/2020 records and implausible source values. That trial was rejected for this release and is not the final imported dataset. The current API snapshot and its audit determine the released counts.

The final release excludes FDC-2774415 from the preliminary 359-record candidate because its native 245 g serving conflicts with “1 Pack (36g)”. No values were recalculated. A smaller 30 g versus 28 g source discrepancy is retained with a visible uncertainty note. A source-consistency guard rejects a single explicit household gram amount when it differs by more than both 2 g and 5%; ambiguous text is not converted. The full audit is in [serving-basis holds](evidence/v112/serving-basis-holds.json).

## Reference-library controls

The 358 reference records have distinct FDC IDs and distinct GTINs. Some names and package descriptions repeat across different source barcodes; those records are retained separately rather than merged by name. Cards display the source GTIN. Carbohydrate ordering separates known total and available definitions by g/ml basis; records with an unspecified definition remain visible without a numeric rank.

Hong Kong priced products remain the default. People may choose overseas references or USDA-only records. The earlier OFF-only scope remains compatible with existing links. USDA records have no Hong Kong prices and cannot pass an allergy-exclusion filter because their complete statements have not been reviewed.

If the optional USDA file fails, the website reports its unavailability separately. The original ten files retain their existing missing-data protections. Price/store filters remain explicit; the overseas notice offers a button to clear those two filters while retaining allergy choices.

## Product images

Four unchanged original JPEGs illustrate two exact existing products:

- P000000913, GTIN4891028166269: Vita Chocolate Milk Beverage236ml, front and back; Open Food Facts contributor macrofactor, uploaded3June2026.
- P000000902, GTIN4891028701484: Vita Hi-Calcium Whole Milk Beverage236ml, front and nutrition; macrofactor, uploaded7March2026. Older ingredient photographs do not complete a current allergen statement.

The photographs are provided under CC BY-SA3.0, with author, date, original-image link and licence in the details. Local files are loaded lazily. The images do not change nutrition values, allergy decisions or physical-pack verification status. Packaging artwork and trademarks may have separate rights; no brand endorsement is claimed.

- Image licence: https://creativecommons.org/licenses/by-sa/3.0/
- Open Food Facts reuse guidance: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/

## Unchanged limitations

The original Hong Kong price snapshot remains21October2026. This update does not claim real-user tests, current physical-pack checks, comprehensive live MaaS response-to-import acceptance beyond one checked example, medical suitability or complete accessibility certification. The separate comparison-explanation feature stays disabled.
