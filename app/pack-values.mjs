/** Derive pack values from declared sizes, without changing the listed retail price. */
import { nutritionFor } from './engine.mjs?v=19';

const text = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
const number = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const near = (left, right) => Math.abs(left - right) <= Number.EPSILON * Math.max(1, left, right) * 8;
const UNKNOWN = { unit:null, totalAmount:null, innerAmount:null, innerCount:null, source:null };

const DECIMAL = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const UNIT = String.raw`millilit(?:res?|ers?)|kilograms?|lit(?:res?|ers?)|grams?|kgs?|gms?|ml|kg|g|l|公斤|千克|公克|毫升|公升|克|升`;
const KNOWN_UNIT = new RegExp(`^(?:${UNIT})$`, 'u');
const MEASURE = `(${DECIMAL})\\s*(${UNIT})`;
const START = String.raw`(?<![a-z0-9.,/+−–-])`;
const TIMES = '[x×*]';
const COUNT = '([1-9]\\d*)';
const PACK_UNIT = String.raw`packs?|packets?|bags?|bottles?|cans?|cartons?|cups?|sachets?|盒|包|樽|瓶|罐|袋|杯|支|條`;
const COUNT_UNIT = `(?:${PACK_UNIT}|pcs?|pieces?|件|個|片|粒)?(?:裝)?`;
const INNER = `${MEASURE}\\s*${TIMES}\\s*${COUNT}\\s*${COUNT_UNIT}`;
const REVERSE_INNER = `${COUNT}\\s*${TIMES}\\s*${MEASURE}`;
const end = pattern => new RegExp(`${START}(?:${pattern})$`, 'u');
const countSpec = count => Number.isSafeInteger(Number(count)) && Number(count) > 1
  ? { ...UNKNOWN, innerCount:Number(count) } : null;

function measure(amount, unit) {
  const value = number(amount);
  const symbol = text(unit);
  if (!value || !KNOWN_UNIT.test(symbol)) return null;
  const volume = /^(?:ml|millilit|毫升|l|lit|公升|升)/.test(symbol);
  const large = /^(?:kg|kilogram|公斤|千克|l|lit|公升|升)/.test(symbol);
  const totalAmount = value * (large ? 1000 : 1);
  return Number.isFinite(totalAmount) ? { ...UNKNOWN, unit:volume ? 'ml' : 'g', totalAmount } : null;
}

function multi(amount, unit, count) {
  const inner = measure(amount, unit);
  const innerCount = Number(count);
  if (!inner || !Number.isSafeInteger(innerCount) || innerCount < 1) return null;
  const totalAmount = inner.totalAmount * innerCount;
  if (!Number.isFinite(totalAmount)) return null;
  return innerCount === 1 ? inner : { ...inner, totalAmount, innerAmount:inner.totalAmount, innerCount };
}

function combined(total, unit, amount, innerUnit, count) {
  const outer = measure(total, unit);
  const inner = multi(amount, innerUnit, count);
  return outer && inner && outer.unit === inner.unit && near(outer.totalAmount, inner.totalAmount) ? inner : null;
}

const PATTERNS = [
  [end(`${MEASURE}\\s*\\(\\s*${INNER}\\s*\\)`), combined],
  [end(`\\(\\s*${INNER}\\s*\\)\\s*${MEASURE}`), (amount, unit, count, total, totalUnit) => combined(total, totalUnit, amount, unit, count)],
  [end(INNER), multi],
  [end(`\\(\\s*${INNER}\\s*\\)`), multi],
  [end(REVERSE_INNER), (count, amount, unit) => multi(amount, unit, count)],
  [end(`\\(\\s*${REVERSE_INNER}\\s*\\)`), (count, amount, unit) => multi(amount, unit, count)],
  [end(`pack\\s+of\\s+${COUNT}`), countSpec],
  [end(`${COUNT}\\s*[- ]\\s*pack`), countSpec],
  [end(`${COUNT}\\s*(?:盒|包|樽|瓶|罐|袋|杯|支|條)裝`), countSpec],
  [end(MEASURE), measure],
  [end(`\\(\\s*${MEASURE}\\s*\\)`), measure],
];

const PREVIOUS_MEASURE = new RegExp(`${START}${DECIMAL}\\s*(?:${UNIT}|oz|lbs?|fl\\.?\\s*oz)(?![a-z])`, 'u');
const PREVIOUS_COUNT = new RegExp(`${START}(?:${COUNT}\\s*(?:${PACK_UNIT})\\s*(?:裝)?|pack\\s+of\\s+${COUNT})(?![a-z])`, 'u');
const BLOCKED_PREFIX = /(?:\b(?:per|about|approx(?:imately)?|up to|from|to|between|x)\b\.?|每|約|大約|大概|最少|最多|至|不少於|不多於|[+×*/]|\d\s*[-−–~])\s*$/u;
const VARIABLE_PACK = /\b(?:random|variable|catch|approximate)\s+weight\b|\bweight\s+(?:may\s+)?var(?:y|ies)\b|不定重|重量不一|重量不定/u;

// Parse a complete, terminal size expression. An earlier amount or dangling multiplier
// can signal alternatives, additions or a nested assortment instead of the pack size.
function declaredPack(value) {
  const clean = text(value);
  if (!clean) return null;
  for (const [pattern, build] of PATTERNS) {
    const match = pattern.exec(clean);
    if (!match) continue;
    const prefix = clean.slice(0, match.index).trimEnd();
    if (VARIABLE_PACK.test(clean) || PREVIOUS_MEASURE.test(prefix) || PREVIOUS_COUNT.test(prefix)
      || BLOCKED_PREFIX.test(prefix) || /\d\s*x$/.test(prefix)) return { conflict:true };
    return build(...match.slice(1)) ?? { conflict:true };
  }
  return null;
}

function compatible(left, right) {
  return !(left.unit && right.unit && (left.unit !== right.unit || !near(left.totalAmount, right.totalAmount)))
    && !(left.innerCount && right.innerCount && left.innerCount !== right.innerCount)
    && !(left.innerAmount && right.innerAmount && !near(left.innerAmount, right.innerAmount));
}

/** Quantity is the outer retail pack; serving size and promotional text never define it. */
export function getPackSpec(product) {
  if (!product) return { ...UNKNOWN };
  const structured = measure(product.quantity, product.quantityUnit);
  const labelled = declaredPack(product.packSize);
  // Imported Pricewatch packs commonly carry the specification in the product name.
  // For other records only use explicit fields; generic community names are not package evidence.
  const pricewatch = /^P\d{9}$/.test(product.pricewatchCode ?? product.id ?? '') || product.dataStatus === 'pricewatch-price-only';
  const names = pricewatch ? [declaredPack(product.nameZh), declaredPack(product.nameEn)].filter(Boolean) : [];
  const evidence = [structured, labelled, ...names].filter(Boolean);
  if (evidence.some(item => item.conflict) || evidence.some((item, index) => evidence.slice(0, index).some(other => !compatible(item, other)))) return { ...UNKNOWN };
  const count = evidence.find(item => item.innerCount);
  const inner = evidence.find(item => item.innerAmount);
  // A title can supply an explicit pack count, but a separate size without an
  // outer/inner relationship cannot say which level that size refers to.
  const size = count && !inner && !structured ? null : evidence.find(item => item.unit);
  const primary = size ?? count;
  return {
    unit:size?.unit ?? null, totalAmount:size?.totalAmount ?? null,
    innerAmount:inner?.innerAmount ?? null, innerCount:count?.innerCount ?? null,
    source:!primary ? null : primary === structured ? 'structured' : primary === labelled ? 'pack-size' : 'product-name',
  };
}

/** Supplemental unit rates for one listed merchant price. Offers do not enter the calculation. */
export function getPackPrices(product, wholePrice) {
  const spec = getPackSpec(product);
  const price = number(wholePrice);
  const per100 = price !== null && spec.totalAmount ? (price / spec.totalAmount) * 100 : null;
  const perInner = price !== null && spec.innerCount ? price / spec.innerCount : null;
  return { ...spec, wholePrice:price, per100:Number.isFinite(per100) ? per100 : null, perInner };
}

const TRANSFORMED = /\b(?:as (?:prepared|consumed|served|cooked)|after (?:preparation|cooking|draining|dilution)|prepared|cooked|drained|diluted|reconstituted|reheated|brewed|rehydrated)\b|沖調後|沖泡後|烹調後|煮熟後?|瀝乾後?|加水後|稀釋後/u;
const TRANSFORMED_NOTE = /\bas (?:prepared|consumed|served|cooked)\b|\bafter (?:preparation|cooking|draining|dilution)\b|\b(?:per|values? for)\b[^.;]{0,30}\b(?:cooked|prepared|drained|diluted|reconstituted|rehydrated)\b|沖調後|沖泡後|烹調後|煮熟後|瀝乾後|加水後|稀釋後/u;
const ASSORTED = /\b(?:assort(?:ed|ment)|mixed (?:flavou?rs?|variet(?:y|ies))|variety pack)\b|雜錦|什錦|混合口味|多種口味|口味組合/u;
const NUTRIENTS = ['energyKcal','carbohydrates','sugars','fat','saturatedFat','transFat','protein','fibre','sodiumMg'];

function matchingNutrition(product, spec) {
  const nutrition = product?.nutrition ?? {};
  if (!spec.unit || !spec.totalAmount || nutrition.basisUnit !== spec.unit || !number(nutrition.basisAmount)
    || nutrition.sourceBasisUnknown || nutrition.referenceBasis === '100g-or-100ml') return false;
  const original = product.sourceNutrition ?? {};
  const originalUnit = measure(1, original.basisUnit)?.unit;
  if ((originalUnit && originalUnit !== spec.unit) || nutrition.asPrepared === true || nutrition.prepared === true) return false;
  if ([nutrition.basis, nutrition.referenceBasis, nutrition.preparationState, nutrition.preparation, nutrition.state, original.basis, original.preparationState,
    product.quantityState, product.packState].some(value => TRANSFORMED.test(text(value).replace(/[-_]/g, ' ')))) return false;
  if ([nutrition.conversionNote, nutrition.sourceLimit, original.conversionNote, product.sourceLimit].some(value => TRANSFORMED_NOTE.test(text(value)))) return false;
  if (ASSORTED.test(text(`${product.nameZh ?? ''} ${product.nameEn ?? ''} ${product.packSize ?? ''}`))) return false;
  if (product.dataStatus === 'overseas-reference' || nutrition.region === 'overseas-reference'
    || product.dataStatus === 'off-community-reference' || nutrition.status === 'community-reference') return false;
  if (product.dataStatus === 'partial-reference' || nutrition.region === 'HKNA-reference') {
    const identity = product.nutritionIdentityEvidence ?? product.identityEvidence;
    const labelledInner = measure(identity?.sourceIndividualPackAmount, identity?.sourceIndividualPackUnit);
    const relevantAmount = spec.innerCount ? spec.innerAmount : spec.totalAmount;
    if (identity?.matchMethod !== 'manual-exact-brand-variant-individual-pack-size' || !labelledInner
      || labelledInner.unit !== spec.unit || !relevantAmount || !near(labelledInner.totalAmount, relevantAmount)) return false;
  }
  return true;
}

/** Calculate nutrients only when the product evidence supports the same as-sold g/ml basis. */
export function getPackNutrition(product) {
  const spec = getPackSpec(product);
  if (!matchingNutrition(product, spec)) return { ...spec, whole:null, inner:null };
  const at = amount => {
    const values = nutritionFor(product, 'portion', amount);
    return NUTRIENTS.some(key => Number.isFinite(values[key])) ? values : null;
  };
  return { ...spec, whole:at(spec.totalAmount), inner:spec.innerAmount ? at(spec.innerAmount) : null };
}
