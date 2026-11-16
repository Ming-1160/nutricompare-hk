/** Separate overseas reference records from the original Hong Kong price catalogue. */
export const FDC_LIBRARY_GROUP = 'fdc-library';
export const FDC_SOURCE_FAMILY = 'usda-fdc-reference';
const NUTRIENTS = ['energyKcal','carbohydrates','sugars','fat','saturatedFat','transFat','protein','fibre','sodiumMg'];

export const isFdcReference = product => product?.libraryGroup === FDC_LIBRARY_GROUP || product?.catalogueGroup === FDC_LIBRARY_GROUP;
export const isInternationalReference = product => product?.libraryGroup === 'off-library' || isFdcReference(product);
export const isFdcLibraryPayload = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) && Array.isArray(value.products));

/** Check only an explicit, unambiguous gram amount; do not infer a weight from counts or ounces. */
function householdGramAmount(value) {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFKC').trim();
  const matches = [...text.matchAll(/(?<![a-z0-9.,/⁄])(\d+(?:\.\d+)?)\s*(?:grams?|grm|g)(?![a-z])/giu)];
  if (matches.length !== 1 || /\b(?:between|approx(?:imately)?|up to|less than|more than|at least|at most)\b|[~≈<>]/iu.test(text)) return null;
  const match = matches[0];
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  // Ranges, fractions and multipliers can describe more than one interpretation.
  if (/(?:\d[\d.,]*\s*(?:[-–—/⁄]|to|through|至|x|×|\*)\s*)$/iu.test(before)
    || /^\s*(?:[-–—/⁄]|to|through|至)\s*\d/iu.test(after)) return null;
  const grams = Number(match[1]);
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

function hasMaterialServingConflict(metadata = {}) {
  if (!/^(?:grm|g|grams?)$/i.test(String(metadata?.rawServingSizeUnit ?? '').trim())) return false;
  const raw = metadata.rawServingSize;
  const household = householdGramAmount(metadata.householdServingFullText);
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || household === null) return false;
  // Retain ordinary label rounding (e.g. 30 g versus 28 g / 1 oz). A large
  // disagreement makes the source's standardized nutrient basis uncertain.
  const tolerance = Math.max(2, household * .05);
  return Math.abs(raw - household) > tolerance + Number.EPSILON * Math.max(raw, household) * 8;
}

/** Only normalized, explicit per-100g USDA records are accepted. No branded HK table is inferred or filled. */
export function normalizeFdcReference(record) {
  if (!record || typeof record !== 'object' || !/^FDC-[1-9]\d*$/.test(record.id ?? '')) return null;
  const fdcId = Number(record.id.slice(4));
  if (!Number.isSafeInteger(fdcId) || record.fdcId !== undefined && Number(record.fdcId) !== fdcId) return null;
  if (!(typeof record.nameEn === 'string' && record.nameEn.trim()) && !(typeof record.nameZh === 'string' && record.nameZh.trim())) return null;
  if (hasMaterialServingConflict(record.fdcMetadata)) return null;
  const input = record.nutrition;
  if (!input || input.basisAmount !== 100 || input.basisUnit !== 'g' || !['United States','New Zealand'].includes(record.marketCountry)) return null;
  if (!NUTRIENTS.some(key => typeof input[key] === 'number' && Number.isFinite(input[key]))) return null;
  if (NUTRIENTS.some(key => input[key] !== null && input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0))) return null;
  const nutrition = { ...input, ...Object.fromEntries(NUTRIENTS.map(key => [key, input[key] ?? null])),
    basisAmount:100, basisUnit:'g', region:record.marketCountry==='New Zealand'?'nz-fdc-reference':'us-fdc-reference', hkLabelVerified:false, status:'reference' };
  return { ...record, id:`FDC-${fdcId}`, fdcId, libraryGroup:FDC_LIBRARY_GROUP, catalogueGroup:FDC_LIBRARY_GROUP,
    nutritionSourceFamily:FDC_SOURCE_FAMILY, dataStatus:'overseas-reference', marketCountry:record.marketCountry, origin:null,
    prices:[], physicalPackChecked:false, nutrition,
    allergens:{ contains:Array.isArray(record.allergens?.contains)?[...record.allergens.contains]:[],
      mayContain:Array.isArray(record.allergens?.mayContain)?[...record.allergens.mayContain]:[], status:'unknown',
      text:'USDA 海外參考未核對完整香港成分及過敏聲明；未列出不代表不含。' },
  };
}

/** Append references by their own FDC ID only; never join by GTIN or mutate a previous product. */
export function appendFdcLibrary(dataset, library) {
  if (!isFdcLibraryPayload(library)) return dataset;
  const existingIds = new Set(dataset.products.map(product => product.id));
  const added = [];
  let rejected = 0;
  let duplicateIds = 0;
  for (const record of library.products) {
    const product = normalizeFdcReference(record);
    if (!product) { rejected++; continue; }
    if (existingIds.has(product.id)) { duplicateIds++; continue; }
    existingIds.add(product.id);
    added.push(product);
  }
  const products = [...dataset.products, ...added];
  const hasNutrition = product => NUTRIENTS.some(key => typeof product.nutrition?.[key] === 'number' && Number.isFinite(product.nutrition[key]));
  return { ...dataset, products,
    ...(dataset.enrichment?{enrichment:{...dataset.enrichment,nutritionCount:products.filter(hasNutrition).length,
      explicitBasis:products.filter(product=>hasNutrition(product)&&['g','ml'].includes(product.nutrition?.basisUnit)).length}}:{}),
    nutritionLibraries:{...dataset.nutritionLibraries,fdc:{...library.metadata,sourceFamily:FDC_SOURCE_FAMILY,
      inputRecords:library.products.length,added:added.length,rejected,duplicateIds,state:'ready'}},
  };
}
