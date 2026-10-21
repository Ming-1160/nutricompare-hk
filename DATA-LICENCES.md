# Data sources, changes and reuse

NutriCompare is an independent ITC2010 student prototype. No source organization endorses it. These notices apply to data provenance and reuse, not medical validation.

## Open Food Facts

Contains information from Open Food Facts, made available under the Open Database License (ODbL).

- [OFF-derived records, manual corrections, exact-ID mappings and credits](app/data/off-hk-labels.json): database rights and our changes offered under [ODbL1.0](https://opendatacommons.org/licenses/odbl/1-0/); individual contents under [DbCL1.0](https://opendatacommons.org/licenses/dbcl/1-0/).
- Source images: named authors/Open Food Facts contributors under [CC BY-SA3.0](https://creativecommons.org/licenses/by-sa/3.0/). Each original image link retains author, upload date and licence URL. The website links to source images; photos were not altered or rehosted in the public site. Image upload date is not a batch date.
- Four OFF-derived records include manual reading/correction of label facts, conservative unknown fields, source-version notes and exact existing Pricewatch-ID mapping. Automated allergens/nutrition were not accepted without evidence.
- The precise [merge methods](app/catalogue.mjs) and all additional/alteration data are publicly available: [brand/retailer facts](app/data/products.json), [Pricewatch food rows](app/data/pricewatch-foods.json), [source metadata](app/data/pricewatch-meta.json), and the OFF subset above. These provide the alterations and methods for reproducing the merged database under ODbL's share-alike provisions. Separating files does not remove obligations for a derivative join.
- Preserve ODbL/DbCL notices and attribution when reusing the OFF subset/derived database. Image rights are separate; this does not grant trademark rights or rights beyond the underlying source licences.

Official guidance: [OFF API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/), [OFF licence guide](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/), [API reuse conditions](https://support.openfoodfacts.org/help/en-gb/12-donnees-api/94-y-a-t-il-des-conditions-pour-utiliser-l-api).

## Consumer Council / DATA.GOV.HK

Source: Hong Kong Consumer Council Pricewatch, published via DATA.GOV.HK. Data ownership remains with Consumer Council. Reuse is subject to [DATA.GOV.HK terms](https://data.gov.hk/en/terms-and-conditions); retain source, ownership and portal attribution. [Official dataset](https://data.gov.hk/tc-data/dataset/cc-pricewatch-pricewatch).

This website selects six ordinary-food source groups and stores a snapshot. It preserves source prices and offer text, but does not claim live stock or complete retailer coverage. Internal source product IDs are not barcodes; GTIN evidence is separately identified when obtained from an individual official product page or label.

## Brands, retailers and other references

Manufacturer/retailer facts, label links and read dates are recorded individually. Brand and retailer rights remain with their owners. No claim is made to license their trademarks, packaging artwork or expressive material. Original linked sources and their notices must be retained. Source-scoped completeness does not verify the current physical pack, current formula or absence of cross-contact.

Government NIIS remains an external general-food reference. Its full database is not republished, and general-food averages never replace a named product's missing nutrition. HKNA partial references remain identified and limited.
