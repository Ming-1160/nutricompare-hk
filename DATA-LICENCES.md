# Data sources, changes and reuse

NutriCompare is an independent ITC2010 student prototype. No source organization endorses it. These notices apply to data provenance and reuse, not medical validation.

## Open Food Facts

Contains information from Open Food Facts, made available under the Open Database License (ODbL).

- [OFF-derived records, manual corrections, exact-ID mappings and credits](app/data/off-hk-labels.json): database rights and our changes offered under [ODbL1.0](https://opendatacommons.org/licenses/odbl/1-0/); individual contents under [DbCL1.0](https://opendatacommons.org/licenses/dbcl/1-0/).
- Source images: named authors/Open Food Facts contributors under [CC BY-SA3.0](https://creativecommons.org/licenses/by-sa/3.0/). Each original image link retains author, upload date and licence URL. The website links to source images; photos were not altered or rehosted in the public site. Image upload date is not a batch date.
- Four OFF-derived records include manual reading/correction of label facts, conservative unknown fields, source-version notes and exact existing Pricewatch-ID mapping. Automated allergens/nutrition were not accepted without evidence.
- Version1.4 separately publishes [bulk community nutrition references](app/data/off-nutrition-library.json), including source numbers, dates, independently corroborated identity mappings and quality holds, under ODbL1.0/DbCL1.0. Unlike the four manually read records, these tables are structured community data, not inspected HK labels. No complete allergy statement is inferred. Unknown100g/100ml bases cannot be converted to portions or ranked. OFF country tags are community claims, not current availability or HK formulation proof.
- [Enrichment, priority and barcode deduplication](app/enrichment.mjs) and [HK brand/HKNA matched factual references](app/data/hk-nutrition-expansion.json) supplement the public alteration/input files below. Normalized source values, conversion notes, dates and all public exact-ID mappings are included; the bulk data file does not rehost images or claim they were read. Original source API values and audit limitations remain attached.
- The precise [merge methods](app/catalogue.mjs) and all additional/alteration data are publicly available: [brand/retailer facts](app/data/products.json), [Pricewatch food rows](app/data/pricewatch-foods.json), [source metadata](app/data/pricewatch-meta.json), and the OFF subset above. These provide the alterations and methods for reproducing the merged database under ODbL's share-alike provisions. Separating files does not remove obligations for a derivative join.
- Preserve ODbL/DbCL notices and attribution when reusing the OFF subset/derived database. Image rights are separate; this does not grant trademark rights or rights beyond the underlying source licences.

Official guidance: [OFF API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/), [OFF licence guide](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/), [API reuse conditions](https://support.openfoodfacts.org/help/en-gb/12-donnees-api/94-y-a-t-il-des-conditions-pour-utiliser-l-api).

## Consumer Council / DATA.GOV.HK

Source: Hong Kong Consumer Council Pricewatch, published via DATA.GOV.HK. Data ownership remains with Consumer Council. Reuse is subject to [DATA.GOV.HK terms](https://data.gov.hk/en/terms-and-conditions); retain source, ownership and portal attribution. [Official dataset](https://data.gov.hk/tc-data/dataset/cc-pricewatch-pricewatch).

This website selects six ordinary-food source groups and stores a snapshot. It preserves source prices and offer text, but does not claim live stock or complete retailer coverage. Internal source product IDs are not barcodes; GTIN evidence is separately identified when obtained from an individual official product page or label.

Supplementary Consumer Council website barcode/cover responses were used internally to discover possible OFF records. That website's separate disclaimer does not establish an open bulk reuse licence for those fields. Its raw supplementary barcode dataset and cover images are **not** published or relabelled as DATA.GOV.HK open-feed data. Public nutrition matches record independent OFF brand/name/exact-pack facts compared with the licensed price-feed text. Ambiguous/shared barcodes, variant and size conflicts are held out; a barcode alone does not prove label equivalence.

## Brands, retailers and other references

Manufacturer/retailer facts, label links and read dates are recorded individually. Brand and retailer rights remain with their owners. No claim is made to license their trademarks, packaging artwork or expressive material. Original linked sources and their notices must be retained. Source-scoped completeness does not verify the current physical pack, current formula or absence of cross-contact.

Government NIIS remains an external general-food reference. Its full database is not republished, and general-food averages never replace a named product's missing nutrition. HKNA partial references remain identified and limited.

The2026 HKNA drinks and food tables were read in full (39pages,320rows), but only41 independently matched factual nutrition records are published, with PDF/page citations and explicit energy-per-pack conversion. The complete compilation, photographs and school snack classifications are not republished. HKNA does not certify current pack accuracy or patient suitability. Existing stronger primary-source tables take priority; missing carbohydrate and other unreported fields stay unknown.
