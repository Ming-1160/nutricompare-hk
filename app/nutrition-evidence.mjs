import { getAllergenAssessment, getEligiblePrices, nutritionFor } from './engine.mjs?v=19';
import { hasReviewedHkNutrition } from './hk-labels.mjs?v=19';
import { getPackNutrition } from './pack-values.mjs?v=19';

const finite = value => Number.isFinite(value) ? value : null;
const metricUnit = key => key === 'energyKcal' ? 'kcal' : key === 'sodiumMg' ? 'mg' : 'g';
const offCommunity = product => product.nutrition?.status === 'community-reference'
  || product.nutritionSourceFamily === 'off-community-reference';
const overseas = product => product.dataStatus === 'overseas-reference'
  || product.nutrition?.region === 'overseas-reference';

export function getComparisonPackNutrition(product) {
  const { whole, inner, ...spec } = getPackNutrition(product);
  const isInner = spec.innerAmount !== null;
  return { ...spec, isInner, amount: isInner ? spec.innerAmount : spec.totalAmount, values: isInner ? inner : whole };
}

export function getNutritionSourceLabel(product) {
  if (hasReviewedHkNutrition(product)) return '香港標籤已讀';
  if (offCommunity(product)) return 'OFF 社群參考';
  if (overseas(product)) return '海外配方參考';
  return '標籤待補';
}

const isOff = source => /\.openfoodfacts\.org\//i.test(source.url ?? '');
const isHkna = source => /\.hkna\.org\.hk\//i.test(source.url ?? '');
const isPricewatch = source => /online-price-watch\.consumer\.org\.hk\//i.test(source.url ?? '');
const isRetailer = source => /wellcome\.com\.hk|rtacdn-os\.com|citysuper\.com\.hk|glutenfreehk\.com|pns\.hk/i.test(source.url ?? '');
const sourceText = source => `${source.label ?? source.name ?? ''} ${source.scope ?? ''}`;
const containsNutrition = source => /營養|nutrition/i.test(sourceText(source))
  && !/未提供完整成分或營養|不是營養背標|未提供營養|沒有營養/.test(sourceText(source));
const sourceName = source => source?.label ?? source?.name ?? null;

function nutritionSource(product) {
  const sources = (product.sources ?? []).filter(source => source.url && !isPricewatch(source));
  const raw = product.sourceNutrition ?? {};
  let candidates = [];
  let type;
  if (offCommunity(product)) {
    candidates = sources.filter(source => isOff(source) && /社群/i.test(sourceText(source)));
    type = 'OFF 社群參考';
  } else if (product.nutrition?.region === 'HKNA-reference') {
    candidates = sources.filter(isHkna);
    type = '香港營養學會（HKNA）參考';
  } else if (overseas(product)) {
    candidates = sources.filter(source => !isOff(source) && !isHkna(source));
    type = '海外配方參考';
  } else if (product.nutrition?.status === 'partial-hk-retailer-statement') {
    candidates = sources.filter(isRetailer);
    type = '香港零售商產品資料';
  } else if (hasReviewedHkNutrition(product)) {
    const offPhotos = sources.filter(source => isOff(source) && !/社群產品資料|社群填寫/.test(sourceText(source)));
    candidates = sources.filter(source => !isOff(source) && !isHkna(source));
    if (offPhotos.length && (!candidates.length || /hk-market-pack-photo/.test(product.nutrition?.region ?? ''))) {
      candidates = offPhotos;
      type = 'OFF 刊登嘅香港包裝標籤圖（已讀）';
    } else if (/retailer/.test(`${product.dataStatus} ${product.nutrition?.region}`) || candidates.some(isRetailer)) {
      candidates = candidates.filter(isRetailer);
      type = product.dataStatus === 'hk-retailer-label' ? '香港零售商產品資料' : '香港零售商標籤圖';
    } else {
      type = '香港官網';
    }
  }
  const exactImage = raw.transcribedFromImage ?? raw.image;
  const matchedImage = candidates.find(source => source.url === exactImage);
  const nutritionSources = candidates.filter(containsNutrition);
  const preferred = matchedImage ?? nutritionSources[0] ?? candidates[0];
  if (!preferred && !exactImage) return null;
  return {
    label: sourceName(preferred) ?? type ?? '原標資料',
    url: exactImage ?? preferred.url,
    checkedAt: matchedImage?.checkedAt ?? raw.sourceRetrievalDate ?? raw.reviewedAt ?? preferred?.checkedAt ?? null,
    type: type ?? '來源性質未核實',
    supportingSources: exactImage ? [] : nutritionSources.slice(1).map(source => ({ url:source.url, label:sourceName(source) })),
  };
}

function originalMetric(product, key) {
  const nutrition = product.nutrition ?? {};
  const raw = product.sourceNutrition ?? nutrition.sourcePerServing;
  const parsedBasis = /^(?:per\s*)?(\d+(?:\.\d+)?)\s*(g|ml)$/i.exec(raw?.basis ?? '');
  let amount = finite(raw?.basisAmount ?? raw?.amount ?? raw?.servingSize ?? (parsedBasis && Number(parsedBasis[1])));
  let unit = raw?.basisUnit ?? raw?.unit ?? parsedBasis?.[2].toLowerCase();
  // The published Nissin serving amount uses the same unit as its normalized table.
  if (raw?.basis === 'per-serving' && amount !== null) unit ??= nutrition.basisUnit;
  const sourceValues = raw?.values ?? raw;
  let value = finite(sourceValues?.[key]);
  let valueUnit = metricUnit(key);
  let label;
  if (value === null && key === 'energyKcal' && Number.isFinite(sourceValues?.energyKj)) {
    value = sourceValues.energyKj;
    valueUnit = 'kJ';
  } else if (value === null && key === 'sodiumMg' && Number.isFinite(sourceValues?.saltG ?? nutrition.sourceSaltG)) {
    value = sourceValues?.saltG ?? nutrition.sourceSaltG;
    valueUnit = 'g';
    label = '鹽';
  }
  if (!raw) {
    amount = finite(nutrition.basisAmount);
    unit = nutrition.basisUnit;
    value ??= finite(nutrition[key]);
    // OFF stores some sodium source records in grams, while the app shows mg.
    const offNutrients = product.offMetadata?.nutrimentsCanonical;
    if (key === 'sodiumMg' && offCommunity(product) && Number.isFinite(offNutrients?.sodium_100g)) {
      value = offNutrients.sodium_100g;
      valueUnit = 'g';
    }
    // HKNA energy is printed per individual package, while the other available values are per 100.
    if (key === 'energyKcal' && nutrition.region === 'HKNA-reference') {
      const originalEnergy = /(?:每包|包裝)\s*(\d+(?:\.\d+)?)\s*千卡/.exec(nutrition.sourceLimit ?? product.sourceLimit ?? '');
      const identity = product.nutritionIdentityEvidence ?? product.identityEvidence;
      if (!originalEnergy || !identity?.sourceIndividualPackAmount) return null;
      amount = identity.sourceIndividualPackAmount;
      unit = identity.sourceIndividualPackUnit;
      value = Number(originalEnergy[1]);
    }
  } else if (raw.legacy && amount === nutrition.basisAmount && unit === nutrition.basisUnit) {
    // Coca-Cola stores its exact per-100ml raw table in provider field names.
    value ??= finite(nutrition[key]);
  }
  const referenceOnly = nutrition.referenceBasis === '100g-or-100ml' && !unit;
  return value === null ? null : { amount, unit: unit ?? null, value, valueUnit, referenceOnly, label };
}

function conflictDetails(product, key, original) {
  const nutrition = product.nutrition ?? {};
  const conflict = nutrition.sourceConflict;
  const versions = product.nutritionSourceConflict;
  const valueUnit = metricUnit(key);
  if (conflict?.field === key) {
    const { basisAmount:amount, basisUnit:unit } = conflict;
    return { reason:'同容量嘅零售商標籤圖同品牌營養圖數值唔一致，未能確認來源版本。', sources:[
      { label:'香港零售商標籤圖', url:conflict.retailerPhoto, value:conflict.retailerPhotoValue, amount, unit, valueUnit },
      { label:'香港官網營養圖', url:conflict.brandOfficialImage, value:conflict.brandOfficialValue, amount, unit, valueUnit },
    ] };
  }
  if (versions?.fields?.includes(key)) {
    const record = (label, row) => ({ label, url:row?.transcribedFromImage ?? row?.url, value:finite(row?.values?.[key]),
      amount:row?.basisAmount, unit:row?.basisUnit, valueUnit });
    return { reason:'兩個公開版本嘅數值有矛盾，未能確認現售版本。', sources:[
      record('舊版完整營養標籤', versions.olderFullTable), record('較新版包裝正面摘要', versions.newerFront),
    ] };
  }
  const rawConflict = product.sourceNutrition?.conflict;
  if (typeof rawConflict === 'string' && ((key === 'energyKcal' && /能量留空/.test(rawConflict))
    || (key === 'sugars' && /糖留空/.test(rawConflict)))) {
    return { reason:rawConflict, sources:[] };
  }
  if (original && nutrition.status === 'partial-hk-official-quality-flag') {
    return { reason:nutrition.sourceLimit, sources:[] };
  }
  return null;
}

export function getNutrientEvidence(product, key, displayedValues) {
  const source = nutritionSource(product);
  const original = originalMetric(product, key);
  const displayed = { amount:finite(displayedValues?.basisAmount), unit:displayedValues?.basisUnit ?? null,
    value:finite(displayedValues?.[key]), valueUnit:metricUnit(key), referenceOnly:Boolean(displayedValues?.referenceOnly) };
  const conflict = displayed.value === null && !Number.isFinite(product.nutrition?.[key]) ? conflictDetails(product, key, original) : null;
  const recordedHknaConversion = key === 'energyKcal' && product.nutrition?.region === 'HKNA-reference'
    && /小包熱量等比例換算/.test(product.nutrition.sourceLimit ?? '') && finite(product.servingSize) !== null;
  let reason = conflict?.reason ?? null;
  if (displayed.value === null && !reason) {
    reason = original ? '現有標籤資料未能按呢個份量或基準提供數值。'
      : source ? '現有來源冇提供可採用嘅呢項數值。' : '暫時冇已記錄嘅營養來源數值。';
  } else if (!original && displayed.value !== null) {
    reason = '資料只保留咗整理後嘅數值，未有獨立記錄原標數值。';
    if (recordedHknaConversion) reason += `現有紀錄列明數值由 ${product.servingSize}${product.nutrition.basisUnit} 小包換算。`;
  }
  if (displayed.value === null) reason = `冇來源數值。${reason}`;
  const comparableBasis = original && (original.unit === displayed.unit || original.referenceOnly && displayed.referenceOnly);
  let converted = null;
  if (displayed.value !== null && recordedHknaConversion) converted = true;
  else if (displayed.value !== null && comparableBasis && original.amount !== null && displayed.amount !== null) {
    converted = original.amount !== displayed.amount || original.valueUnit !== displayed.valueUnit;
  }
  return { source, original, displayed, converted, reason, conflictSources:conflict?.sources ?? [] };
}

function closestCommonPrice(originalPrices, candidate) {
  let closest = null;
  for (const original of originalPrices) {
    if (!original.store) continue;
    for (const alternative of getEligiblePrices(candidate, { store:original.store })) {
      const gap = Math.abs(original.price - alternative.price);
      if (gap <= 2 + Number.EPSILON * Math.max(original.price, alternative.price) && (!closest || gap < closest.gap)) {
        closest = { store:original.store, originalPrice:original.price, alternativePrice:alternative.price, gap };
      }
    }
  }
  return closest;
}

export function findAlternatives(product, products, selectedAllergens = []) {
  const path = product.sourceCategory?.pathZh;
  const original = nutritionFor(product);
  const unit = original.basisUnit;
  const comparable = item => hasReviewedHkNutrition(item) && Number.isFinite(item.nutrition?.basisAmount)
    && item.nutrition.basisAmount > 0 && !item.nutrition.sourceBasisUnknown;
  if (!Array.isArray(path) || !path.length || !comparable(product) || !unit) return [];
  const originalPrices = getEligiblePrices(product);
  const options = [];
  for (const candidate of products) {
    const candidatePath = candidate.sourceCategory?.pathZh;
    if (candidate.id === product.id || !Array.isArray(candidatePath) || candidatePath.length !== path.length
      || !path.every((name, index) => name === candidatePath[index]) || !comparable(candidate)) continue;
    if (selectedAllergens.length && getAllergenAssessment(candidate, selectedAllergens).status !== 'no-listed-match') continue;
    const nutrients = nutritionFor(candidate);
    if (nutrients.basisUnit !== unit) continue;
    const metrics = ['sodiumMg', 'sugars'].flatMap(key => {
      const originalValue = original[key];
      const value = nutrients[key];
      if (!(originalValue > 0) || value === null || value > originalValue * .8) return [];
      return [{ key, originalValue, value, reduction:(originalValue - value) / originalValue }];
    });
    if (!metrics.length) continue;
    const price = closestCommonPrice(originalPrices, candidate);
    if (price) options.push({ product:candidate, ...price, unit, metrics });
  }
  return options.sort((a, b) => a.gap - b.gap).slice(0, 3);
}
