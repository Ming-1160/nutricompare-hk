/** NutriCompare HK: deterministic search, conservative filters and label arithmetic. */
import {hasReviewedHkNutrition} from './hk-labels.mjs?v=20261022-hk-labels-more';

export const ALLERGENS = Object.freeze([
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'tree-nuts', 'sesame', 'sulphites',
]);

const ALLERGEN_ALIASES = {
  gluten: ['gluten', 'wheat', 'barley', 'rye', 'oats', 'oat', 'spelt', 'cereals containing gluten', '含麩質穀物', '麩質', '小麥', '大麥', '黑麥', '燕麥'],
  crustaceans: ['crustaceans', 'crustacean', 'shellfish', 'shrimp', 'prawn', 'crab', 'lobster', '甲殼類', '甲殼動物', '蝦', '蟹', '龍蝦'],
  eggs: ['egg', 'eggs', '雞蛋', '蛋', '蛋類'],
  fish: ['fish', '魚', '魚類'],
  peanuts: ['peanut', 'peanuts', 'groundnut', 'groundnuts', '花生'],
  soy: ['soy', 'soya', 'soybean', 'soybeans', '大豆', '黃豆', '豆類'],
  milk: ['milk', 'dairy', '乳', '奶', '牛奶', '奶類', '乳類', '乳製品'],
  'tree-nuts': ['tree-nuts', 'tree nuts', 'tree nut', 'nuts', 'nut', '果仁', 'almond', 'almonds', 'hazelnut', 'hazelnuts', 'walnut', 'walnuts', 'cashew', 'cashews', 'pecan', 'pecans', 'pistachio', 'pistachios', 'macadamia', 'brazil nut', 'brazil nuts', '木本堅果', '堅果', '杏仁', '榛子', '核桃', '腰果', '碧根果', '開心果', '夏威夷果'],
  sesame: ['sesame', 'sesame seed', 'sesame seeds', '芝麻', '芝蔴'],
  sulphites: ['sulphites', 'sulfites', 'sulphite', 'sulfite', 'sulphur dioxide', 'sulfur dioxide', '亞硫酸鹽', '二氧化硫'],
};

const NUTRIENTS = Object.freeze([
  'energyKcal', 'carbohydrates', 'sugars', 'fat', 'saturatedFat', 'transFat', 'protein', 'fibre', 'sodiumMg',
]);

function clean(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en').normalize('NFKC') : '';
}

function searchText(value) {
  return clean(value)
    .replace(/朱古力/g, '巧克力')
    .replace(/餅乾|饼干|餅干/g, '餅')
    .replace(/花生醬/g, '花生')
    // "Cream crackers" are plain crackers and "ice cream" is not a filled biscuit: keep them out of the 夾心 synonym.
    .replace(/cream\s*crackers?/g, '克力架')
    .replace(/ice\s*cream/g, '雪糕')
    .replace(/忌廉|奶油|cream/g, '夾心')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeAllergen(value) {
  const key = clean(value).replace(/^en:/, '');
  return ALLERGENS.find(id => ALLERGEN_ALIASES[id].includes(key)) ?? null;
}

function normalizedSelection(values) {
  const selected = Array.isArray(values) ? values : [];
  const canonical = [...new Set(selected.map(normalizeAllergen).filter(Boolean))];
  const unsupported = selected.filter(value => !normalizeAllergen(value));
  return { canonical, unsupported };
}

// The Consumer Council top-level groups are very broad ("奶類及乳製品 / 大豆製品 / 蛋類" covers fresh milk, tofu and eggs),
// so a search for "soy" or "蛋" would otherwise match every product in the group.
function searchableTags(product) {
  // Single-concept top-level groups such as 飲品 stay searchable; only the " / " multi-group names are left out.
  const broad = new Set([product.sourceCategory?.zh, product.sourceCategory?.en].filter(name => typeof name === 'string' && name.includes('/')));
  return (Array.isArray(product.tags) ? product.tags : []).filter(tag => !broad.has(tag));
}

const haystacks = new WeakMap();
function searchableProduct(product) {
  if (product && typeof product === 'object' && haystacks.has(product)) return haystacks.get(product);
  const brand = typeof product.brand === 'object'
    ? Object.values(product.brand ?? {}).join(' ')
    : product.brand;
  const text = searchText([
    product.nameZh, product.nameEn, brand, product.brandEn, product.brandZh, product.category, product.packSize,
    ...searchableTags(product),
  ].filter(Boolean).join(' '));
  if (product && typeof product === 'object') haystacks.set(product, text);
  return text;
}

function matchesQuery(product, query) {
  const tokens = searchText(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const haystack = searchableProduct(product);
  return tokens.every(token => haystack.includes(token));
}

/** Valid full-pack prices for the chosen merchant. Multi-buy offers are not applied. */
export function getEligiblePrices(product, filters = {}) {
  const store = clean(filters.store);
  return (Array.isArray(product?.prices) ? product.prices : [])
    .filter(price => !store || store === 'all' || clean(price.store) === store)
    .filter(price => numeric(price.price) !== null)
    .map(price => ({ ...price, price: numeric(price.price) }));
}

/** The cheapest eligible whole-pack snapshot price; unknown is null, never zero. */
export function getMinPrice(product, filters = {}) {
  const prices = getEligiblePrices(product, filters);
  return prices.length ? Math.min(...prices.map(price => price.price)) : null;
}

/** An absence from a label is not a guarantee of safety. */
export function getAllergenAssessment(product, selectedAllergens = []) {
  const { canonical, unsupported } = normalizedSelection(selectedAllergens);
  const selected = [...canonical, ...unsupported.map(String)];
  if (!selected.length) {
    return { status: 'not-selected', selected: [], conflicts: [], message: '未設定過敏原篩選；請自行核對實物包裝。' };
  }
  const label = product?.allergens ?? {};
  const contains = (Array.isArray(label.contains) ? label.contains : []).map(normalizeAllergen).filter(Boolean);
  const mayContain = (Array.isArray(label.mayContain) ? label.mayContain : []).map(normalizeAllergen).filter(Boolean);
  const conflicts = canonical.filter(id => contains.includes(id) || mayContain.includes(id));
  if (conflicts.length) {
    return { status: 'conflict', selected, conflicts, message: '成分或「可能含有」聲明列出所選過敏原，已排除。' };
  }
  if (unsupported.length || label.status !== 'complete' || !Array.isArray(label.contains) || !Array.isArray(label.mayContain)) {
    return { status: 'unknown', selected, conflicts: [], message: '過敏原資料未齊／未能核實，不能確認符合條件。' };
  }
  return {
    status: 'no-listed-match', selected, conflicts: [],
    message: '已記錄聲明未列出所選過敏原；不代表保證安全，購買前仍須核對當前包裝。',
  };
}

/**
 * Converts labelled per-100g/ml values using label arithmetic only.
 * basis='portion' requires a positive gram/ml amount (or a verified servingSize).
 */
export function nutritionFor(product, basis = '100', portion = null) {
  const nutrition = product?.nutrition ?? {};
  const basisUnit = ['g', 'ml'].includes(nutrition.basisUnit) ? nutrition.basisUnit : null;
  const sourceAmount = numeric(nutrition.basisAmount ?? 100);
  let amount = basis === 'portion' ? numeric(portion ?? product?.servingSize) : 100;
  // OFF index supplies normalized values per100g OR100ml without distinguishing the unit.
  // Show those raw reference values only; never calculate a portion from an assumed unit.
  const referenceOnly=!basisUnit&&nutrition.referenceBasis==='100g-or-100ml'&&sourceAmount===100&&basis!=='portion';
  if (amount === 0 || (!basisUnit&&!referenceOnly) || !sourceAmount) amount = null;
  const factor = amount === null || !sourceAmount ? null : amount / sourceAmount;
  const values = Object.fromEntries(NUTRIENTS.map(key => {
    const value = numeric(nutrition[key]);
    return [key, factor === null || value === null ? null : Math.round(value * factor * 10000) / 10000];
  }));
  return { ...values, basisUnit, referenceOnly, basisAmount: amount, amount, basis: basis === 'portion' ? 'portion' : '100' };
}

const NUTRITION_SORTS = Object.freeze({
  'carbs-asc': ['carbohydrates', false],
  'sugar-asc': ['sugars', false],
  'sodium-asc': ['sodiumMg', false],
  'protein-desc': ['protein', true],
});

function unitOf(product) {
  return ['g', 'ml'].includes(product?.nutrition?.basisUnit) ? product.nutrition.basisUnit : null;
}

/**
 * Unit blocks used by a nutrition ranking, e.g. [{unit:'ml',count:66},{unit:'g',count:7}].
 * Only products with a known value on an explicit g/ml basis are counted. Ties keep first appearance.
 */
export function rankingGroups(products, sort) {
  const nutritionSort = NUTRITION_SORTS[sort];
  if (!nutritionSort) return [];
  const [key] = nutritionSort;
  const counts = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const unit = unitOf(product);
    if (unit && nutritionFor(product)[key] !== null) counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }
  return [...counts].map(([unit, count]) => ({ unit, count })).sort((a, b) => b.count - a.count);
}

function compareNullable(left, right, descending = false) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
}

/** Returns a new result array; does not change the dataset or any filters. */
export function filterProducts(products, filters = {}) {
  const budget = numeric(filters.budget);
  const category = clean(filters.category);
  const origin = clean(filters.origin);
  const store = clean(filters.store);
  const hasAllergenSelection = Array.isArray(filters.allergens) && filters.allergens.length > 0;
  const filtered = (Array.isArray(products) ? products : []).filter(product => {
    if(filters.libraryScope==='priced'&&product.libraryGroup==='off-library')return false;
    if(filters.libraryScope==='off-library'&&product.libraryGroup!=='off-library')return false;
    if (filters.dataScope === 'nutrition' && !NUTRIENTS.some(key => numeric(product.nutrition?.[key]) !== null)) return false;
    if (filters.dataScope === 'hk-nutrition' && !hasReviewedHkNutrition(product)) return false;
    if (filters.dataScope === 'comparable' && (!['g','ml'].includes(product.nutrition?.basisUnit)||!NUTRIENTS.some(key=>numeric(product.nutrition?.[key])!==null)))return false;
    if (filters.dataScope === 'hk-label' && product.allergens?.status !== 'complete') return false;
    if (category && category !== 'all' && clean(product.category) !== category) return false;
    if (origin && origin !== 'all' && clean(product.origin) !== origin) return false;
    if (!matchesQuery(product, filters.query)) return false;
    if (hasAllergenSelection && getAllergenAssessment(product, filters.allergens).status !== 'no-listed-match') return false;
    if (store && store !== 'all' && !getEligiblePrices(product, filters).length) return false;
    const price = getMinPrice(product, filters);
    if (budget !== null && (price === null || price > budget)) return false;
    return true;
  });
  if (filters.sort === 'price-asc') {
    return filtered.sort((a, b) => compareNullable(getMinPrice(a, filters), getMinPrice(b, filters)));
  }
  const nutritionSort = NUTRITION_SORTS[filters.sort];
  if (nutritionSort) {
    const [key, descending] = nutritionSort;
    const value = product => unitOf(product) ? nutritionFor(product)[key] : null;
    // 100g and 100ml values are never ranked against each other. Each unit is ranked as its own block
    // (the block with more known values first) and every unknown value follows all known values.
    const order = rankingGroups(filtered, filters.sort).map(group => group.unit);
    const block = product => value(product) === null ? order.length : order.indexOf(unitOf(product));
    return filtered.sort((a, b) => block(a) - block(b) || compareNullable(value(a), value(b), descending));
  }
  if (clean(filters.query) && (!filters.sort || filters.sort === 'relevance')) {
    const tokens=searchText(filters.query).split(' ').filter(Boolean);
    const score=product=>{
      const primary=searchText([product.nameZh,product.nameEn,typeof product.brand==='object'?Object.values(product.brand??{}).join(' '):product.brand,product.brandEn].filter(Boolean).join(' '));
      return tokens.reduce((sum,token)=>sum+Number(primary.includes(token)),0);
    };
    // A broad source category can match the query, but exact product words come first.
    return filtered.sort((a,b)=>score(b)-score(a));
  }
  return filtered;
}

/* ------------------------------------------------------------------------------------------------
 * Offline request parser (rule-based; not generative AI, not medical advice). It runs only in the browser.
 * Safety rules, each covered by tests:
 *  1. Allergy wording never becomes a product search.
 *  2. Every allergen named in an allergy statement is kept; anything in it that cannot be named is reported.
 *  3. Questions such as 有冇花生醬 / 惠康冇花生醬咩 ask FOR a food; they are not "without".
 *  4. A food the person says they do not want (唔飲咖啡 / no chocolate) is never used as the search.
 * ---------------------------------------------------------------------------------------------- */

/** Sort cues, in priority order: a diabetes-focused shopper's sugar/carbohydrate wording wins over price. */
const SORT_CUES = Object.freeze([
  ['sugar-asc', /低糖|少糖|減糖|减糖|戒糖|(?<!(?<![所只])有)(?:無|无|冇|不含|唔含)\s*蔗糖|(?:冇|無|唔係|不是)(?:咁|好|太)甜|(?<![a-z])(?:quit|cut(?:\s+out)?|no\s+more)\s+sugar|(?<![咁太好])(?:唔|不)甜|(?<!(?<![所只])有)(?:無|无|冇|不|唔)\s*(?:添)?加\s*糖|(?<!(?<![所只])有)(?:無|无|冇)糖|零糖|0\s*糖|走糖|走甜|少甜|(?:唔|不)要糖|(?:唔|不)(?:要|好)?(?:太|咁)甜|sugar[-\s]?free|(?:low|less|no|zero|reduced)[-\s]*sugar|no\s*added\s*sugar|less\s*sweet|not\s+(?:too|so|very)\s+sweet|unsweetened|(?:唔係|不是)(?:好|很|太|咁)甜/giu],
  ['carbs-asc', /低碳水|少碳水|減碳水|减碳水|低碳|(?:low|less|reduced)[-\s]*carb(?:ohydrate)?s?/giu],
  ['sodium-asc', /低鈉|少鈉|減鈉|减钠|低鹽|少鹽|減鹽|走鹽|(?<!(?<![所只])有)(?:無|无|冇)鹽|(?:唔|不)要鹽|(?:唔|不)(?:要|好)?(?:太|咁)鹹|(?:low|less|reduced|no)[-\s]*(?:sodium|salt)|salt[-\s]?free/giu],
  ['protein-desc', /高蛋白|多蛋白|high[-\s]*protein/giu],
  ['price-asc', /最平|平啲|便宜|最抵|超抵|好抵|抵買|抵食|(?:對|对)?\s*(?:價錢|價格|价钱|价格)\s*(?:好|很|比較|比较|都|幾|几)?\s*敏感|(?<![a-z])cheap(?:er|est)?(?![a-z])|lowest\s*price|price[-\s]*sensitive/giu],
]);
const ALLERGEN_NAMES = Object.freeze({ gluten: '含麩質穀物', crustaceans: '甲殼類', eggs: '蛋類', fish: '魚類', peanuts: '花生', soy: '大豆', milk: '奶類', 'tree-nuts': '木本堅果', sesame: '芝麻', sulphites: '亞硫酸鹽' });
const SORT_LABELS = Object.freeze({
  'sugar-asc': '糖：低至高', 'carbs-asc': '碳水化合物：低至高', 'sodium-asc': '鈉：低至高',
  'protein-desc': '蛋白質：高至低', 'price-asc': '價格：低至高',
});
const LIMIT_WORDS = '(?:要|含量)?\\s*(?:唔超過|不超過|唔好超過|少於|低於|以下|less\\s*than|under|below|max(?:imum)?|<|≤)\\s*\\d+(?:\\.\\d+)?(?!\\s*(?:蚊|元|港元|港幣|hkd|dollars?|bucks?|\\d))\\s*';
/** "糖唔超過5克" / "sugar less than 5g": the site cannot set nutrient limits, so the limit becomes a low-to-high ranking. */
const NUTRIENT_LIMITS = Object.freeze([
  ['sugar-asc', new RegExp(`(?:糖|sugars?)\\s*${LIMIT_WORDS}(?:克|grams?|g)?`, 'giu')],
  ['carbs-asc', new RegExp(`(?:碳水(?:化合物)?|carb(?:ohydrate)?s?)\\s*${LIMIT_WORDS}(?:克|grams?|g)?`, 'giu')],
  ['sodium-asc', new RegExp(`(?:鈉|鹽|sodium|salt)\\s*${LIMIT_WORDS}(?:毫克|mg|克|g)?`, 'giu')],
]);

/** Food wording -> [search word, category or null]. The first match wins, so more specific wording comes first. */
const FOOD_CUES = Object.freeze([
  [/cream\s*crackers?|soda\s*crackers?|saltines?|克力架|梳打餅|梳打饼/giu, '克力架', 'biscuits'],
  [/椰漿|椰浆|椰奶|coconut\s*(?:milk|cream)/giu, '椰漿', null],
  [/夾心|夹心|忌廉|奶油|(?<!ice\s?)(?<![a-z])creams?(?![a-z])(?!\s*crackers?)|sandwich/giu, '夾心', null],
  [/牛油果|avocados?/giu, '牛油果', null],
  [/牛奶糖|奶糖|milk\s*cand(?:y|ies)/giu, '奶糖', null],
  [/朱古力|巧克力|chocolate/giu, '巧克力', null],
  [/黑咖啡|black\s*coffee/giu, 'black coffee', 'drinks'],
  [/咖啡|coffee/giu, 'coffee', 'drinks'],
  [/奶茶|milk\s*tea/giu, '奶茶', 'drinks'],
  [/檸檬茶|柠檬茶|lemon\s*tea/giu, '檸檬茶', 'drinks'],
  [/豆奶|荳奶|豆漿|豆浆|soy.?milk|soya.?milk/giu, 'soy', 'drinks'],
  [/燕麥奶|燕麦奶|oat\s*milk/giu, '燕麥', 'drinks'],
  [/杏仁奶|almond\s*milk/giu, '杏仁', 'drinks'],
  [/椰子水|椰青水|椰青|coconut\s*water/giu, '椰青水', 'drinks'],
  [/鮮奶|牛奶|(?<!(?:soy|soya|oat|almond|rice|coconut|dairy)[\s-]?)(?<![a-z])milk(?!\s*(?:chocolate|tea))/giu, '牛奶', 'drinks'],
  [/綠茶|绿茶|烏龍|乌龙|茶包|(?<!奶|檸檬|柠檬)茶|(?<!milk\s|lemon\s)(?<![a-z])teas?(?![a-z])/giu, '茶', 'drinks'],
  [/即食麵|即食面|杯麵|杯面|碗麵|碗面|公仔麵|快熟麵|出前一丁|instant\s*noodles?|cup\s*noodles?/giu, '即食麵', 'meals'],
  [/薯片|potato\s*chips?|crisps/giu, '薯片', 'snacks'],
  [/麥片|燕麥|燕麦|(?<![a-z])oat(?:meal|s)?(?![a-z])/giu, '麥片', null],
  [/果汁|juice/giu, '果汁', 'drinks'],
  [/汽水|可樂|可乐|(?<![a-z])colas?(?![a-z])|soft\s*drinks?/giu, '汽水', 'drinks'],
  [/乳酪|yogh?urt/giu, '乳酪', 'dairy'],
  [/蠔油|蚝油|oyster\s*sauce/giu, '蠔油', null],
]);
const CATEGORY_CUES = Object.freeze([
  ['drinks', /嘢飲|飲品|飲料|飲|喝|drinks?|beverages?/giu],
  ['snacks', /零食|小食|snacks?/giu],
  ['bakery', /麵包|面包|方包|蛋糕|bread|cakes?/giu],
]);
const BISCUIT_CUE = /餅乾|饼干|餅干|餅|饼|biscuits?|crackers?|cookies?|wafers?/iu;
const STORE_CUES = Object.freeze([
  ['PARKNSHOP', /百佳|parknshop|park\s*['’]?\s*n\s*['’]?\s*shop|\bpns\b/giu],
  ['WELLCOME', /惠康|wellcome/giu],
  ['JASONS', /market\s*place|jasons/giu],
  ['AEON', /aeon|吉之島/giu],
]);

const NUM = '(\\d+(?:\\.\\d{1,2})?)';
const CN_NUM = '([零一二兩两三四五六七八九十百廿卅]+)';
const UNTIL = '(?:\\s*(?:以下|以內|以内|內|内))?';
const NOT_A_UNIT = '(?!\\s*(?:克|g\\b|grams?|毫升|ml|mg|毫克|kcal|卡|包|件|個|片|粒|盒|罐|支|樽|袋|%|percent|\\.\\d))';
const BUDGET_KEYWORDS = '(?:預算|预算|budget|不超過|唔超過|唔好超過|最多|最高|under|below|up\\s*to|less\\s*than|within|max(?:imum)?|少於|以下)';
/** Explicit money is read first, then nutrient limits, then a bare number after a budget word. */
const CURRENCY_BUDGETS = Object.freeze([
  [new RegExp(`(?:hk\\$|\\$|hkd)\\s*${NUM}${UNTIL}`, 'iu'), 'number'],
  [new RegExp(`${NUM}\\s*(?:蚊|元|港元|港幣|hkd|dollars?|bucks?)${UNTIL}`, 'iu'), 'number'],
  [new RegExp(`${CN_NUM}\\s*(?:蚊|元|港元|港幣)${UNTIL}`, 'u'), 'chinese'],
]);
const EN_NUMBER = '((?<![a-z])(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|a)(?![a-z])[\\s-]*(?:and[\\s-]+)?)+)';
const EN_CURRENCY_BUDGET = new RegExp(`${EN_NUMBER}\\s*(?:hk\\s*)?(?:dollars?|bucks?|hkd)`, 'iu');
const KEYWORD_BUDGETS = Object.freeze([
  [new RegExp(`${BUDGET_KEYWORDS}\\s*[:：]?\\s*${NUM}${NOT_A_UNIT}`, 'iu'), 'number'],
  [new RegExp(`${BUDGET_KEYWORDS}\\s*[:：]?\\s*${CN_NUM}(?!\\s*(?:克|毫升|毫克|包|件|個|片|粒|盒|罐|支|樽|袋))`, 'u'), 'chinese'],
  [new RegExp(`${BUDGET_KEYWORDS}\\s*[:：]?\\s*${EN_NUMBER}(?!\\s*(?:grams?|g\\b|ml|mg|kcal|packs?|pieces?|percent))`, 'iu'), 'english'],
]);
const CONTEXT_WORDS = /糖尿病人|糖尿病|糖尿|糖友|血糖|病人|患者|長者|老人家|適合|适合|健康|healthy|diabet\w*|patients?/giu;
const FILLER_WORDS = /我有|我係|我是|我想|我要|正在|幾多|多少|邊款|邊啲|邊個|乜嘢|咩|什麼|甚麼|點揀|所有|全部|最高|最多|唔該晒|唔該|麻煩你|麻煩|先至啱|先啱|只有|呢度|這裡|这里|呢間|\bhow\s*much\b|\bwhich\b|\bwhat\b|\bshow\b|\ball\b|\blist\b|\bunder\b|\bbelow\b|\bwithin\b|\bbudget\b|\bthanks?\b|\bthank\s*you\b|想食|想飲|想買|想搵|想要|搵吓|搵|幫我|有冇|有沒有|有無|可唔可以|可不可以|可以|請問|推介|推薦|一款|一啲|一些|啲|嘅|的|吖|呀|啊|呢|吧|嗎|㗎|喎|同埋|同|和|及|包裝|食品|食物|東西|嘢|野|購買|買|大概|左右|\bi\s*want\b|\bi'?d\s*like\b|\blooking\s*for\b|\bplease\b|\bsome\b|\bany\b|\bfoods?\b|\bfor\b|\band\b|\bthe\b|\ba\b|\bwith\b|\bin\b|\bat\b|\bis\b|\bare\b|\bthere\b|\bdo\b|\byou\b|\bhave\b|\bgot\b|\bneed\b|\bme\b|\bmy\b|\bi'?(?:m|d|ve|ll)\b|\bi\b|\bwants?\b|\bwanna\b|\bsell\b|\bstock\b|\bsomething\b|\bgood\b|\b(?:has|had|ok|okay|fine|best|suitable|recommend(?:ed)?|eat|drink|buy|get|can(?:['’]?t|not)?|could|should|would|will|to|of|or|on|it|its|this|that|these|those)\b|\bsweet\b|\btasty\b|\bnice\b|\b(?:help|find|search|look|pls|plz|kindly|anything|everything|stuff)\b|搵唔到|買唔到|唔到|唔得|不行|唔辣|不辣|走辣|少辣|微辣|小辣|唔知|唔使|唔好意思|不如|不錯|唔錯|嚟講|来讲|來說|来说|好危險|危險|危险|\b(?:sure|maybe|perhaps|not|am|also|he|she|they|is|was|live|survive|without|cannot)\b|\bcan['’]?t\b|最好|喺|於|亦都|點解|點樣|為什麼|为什么|都得|都可以|乜都|其他|其餘|之外|以外|好好食|好好味|好好飲|好味|好食|好飲|好吃|美味|鍾意|中意|喜歡|喜欢|反應|反应|\b(?:dad|daddy|father|mum|mom|mother|parents?|grandma|grandpa|grandparents?|kids?|child(?:ren)?|son|daughter|husband|wife|family|elderly)\b|小朋友|細路|小孩|兒童|嬰兒|老人|阿爺|阿嫲|公公|婆婆|爺爺|嫲嫲|老公|老婆|個仔|個女|仔女|老豆|老竇|老爸|阿爸|爸爸|老媽|阿媽|媽媽|屋企人|家人|長輩|俾佢|畀佢|俾我|畀我|給他|給她|給我|我哋|我們|我|你|佢|俾|畀/giu;

/** Extra everyday words that name an allergen; used only to read requests and links, never to read label data. */
const PARSER_EXTRA_ALIASES = Object.freeze({
  peanuts: ['花生醬', 'peanut butter'],
  soy: ['豆漿', '豆浆', '豆奶', '荳奶', '豆腐', 'tofu', 'soy milk', 'soya milk', 'soymilk', '大豆類'],
  milk: ['芝士', 'cheese', '乳酪', 'yoghurt', 'yogurt', '乳糖', 'lactose', '忌廉', '奶油', 'cream', '牛油', 'butter', '奶粉', 'milk powder', '乳製品'],
  eggs: ['蛋白', '蛋黃', 'egg white', 'egg yolk', '蛋類'],
  fish: ['海鮮', 'seafood', '魚類'],
  crustaceans: ['海鮮', 'seafood', '甲殼類'],
  sesame: ['麻油', '芝麻油', 'sesame oil'],
  gluten: ['麵粉', '面粉', 'flour', '麵筋', '含麩質穀物', '乳糜瀉', 'coeliac', 'celiac', 'coeliac disease', 'celiac disease'],
  'tree-nuts': ['木本堅果'],
});
/** Generic "nuts" wording names both nut groups. */
const GENERIC_NUT_ALIASES = new Set(['堅果', '果仁', 'nut', 'nuts']);
const ALIAS_TO_IDS = (() => {
  const map = new Map();
  for (const id of ALLERGENS) {
    for (const alias of [...ALLERGEN_ALIASES[id], ...(PARSER_EXTRA_ALIASES[id] ?? [])]) {
      const key = clean(alias);
      if (!key || (key.length === 1 && !/[㐀-鿿]/u.test(key))) continue;
      map.set(key, [...new Set([...(map.get(key) ?? []), id])]);
    }
  }
  for (const key of GENERIC_NUT_ALIASES) map.set(key, ['peanuts', 'tree-nuts']);
  return map;
})();
/** The same aliases without spaces or hyphens, for link values such as "treenuts" or "peanut-butter". */
const COMPACT_ALIAS_TO_IDS = new Map([...ALIAS_TO_IDS].map(([key, ids]) => [key.replace(/[\s_'’-]/g, ''), ids]));
/** Allergies the label filter cannot cover: named back to the user, never turned into a product search. */
const UNSUPPORTED_ALLERGENS = Object.freeze([
  ['芥末', /芥末|mustard/iu],
  ['芹菜', /芹菜|celery/iu],
  ['軟體貝類', /軟體貝類|软体贝类|貝類|贝类|蠔|蚝|扇貝|帶子|青口|蜆|魷魚|鱿鱼|墨魚|墨鱼|八爪魚|章魚|鮑魚|鲍鱼|海螺|田螺|響螺|螺肉|molluscs?|mollusks?|oysters?|scallops?|squids?|clams?|mussels?|octopus(?:es)?|abalones?|cuttlefish|snails?|whelks?|cockles?/iu],
  ['椰子', /椰子|coconut/iu],
  ['奇異果', /奇異果|奇异果|kiwi/iu],
  ['蕎麥', /蕎麥|荞麦|buckwheat/iu],
  ['羽扇豆', /羽扇豆|lupin/iu],
]);
/** Words in an exclusion that are diet wishes or sort wishes rather than allergies. */
const DIET_WORDS = Object.freeze([
  ['sugar-asc', /^(?:高|太多|多|太|添加)?(?:糖|甜|甜嘢|甜食|糖分|sugar|sugary|sweets?|added sugars?)$/iu],
  ['sodium-asc', /^(?:高|太多|多|太)?(?:鹽|鹹|咸|鈉|salt|salty|sodium)$/iu],
  ['carbs-asc', /^(?:高|太多|多|太)?(?:碳水|碳水化合物|澱粉|淀粉|carbs?|carbohydrates?|starch)$/iu],
  ['price-asc', /^(?:價錢|價格|价钱|价格|price|prices|cost)$/iu],
]);
/** Common restrictions that are not label allergens; the site says it cannot filter them. */
const OTHER_WORDS = '辣|辣嘢|spicy|煎炸|油炸|炸嘢|fried|酒|酒精|alcohol|咖啡因|caffeine|味精|msg|豬|豬肉|猪肉|pork|牛|牛肉|beef|肥|胖|油膩|熱氣|寒涼|fatty|greasy';
const OTHER_RESTRICTIONS = new RegExp(`^(?:太)?(?:${OTHER_WORDS})$`, 'iu');
/** "Food allergy" without naming a food: flagged so the person picks the allergens themselves. */
const GENERIC_ALLERGY_WORDS = /^(?:某啲|某些|一啲|一些|啲|好多|好幾樣|幾樣|多種|很多)?(?:食物|食品|嘢食|嘢|東西|food|foods|something|things?)$/iu;
/** Words that may follow an allergen inside an allergy item without naming anything new (花生醬, 牛奶製品). */
const KNOWN_SUFFIX = /^(?:製品|制品|類|类|產品|产品|成分|醬|酱|味|油|粉|醬料|調味|食品|食物|嘢|穀物|穀類|谷物|含|含有|帶有|有機|有机|低脂|脫脂|全脂|鮮|新鮮|organic|fresh|skimmed|skim|whole|low-fat|full-fat|products?|based|oil|flour|paste|sauce|powder|protein|ingredients?|foods?|traces?)$/iu;

/** Latin aliases need word edges, otherwise "peanuts allergy" would also read as "nuts allergy". */
/** Words an alias must not run into: 牛油果 is avocado, 蛋白質 is protein. */
const ALIAS_NOT_BEFORE = Object.freeze({ 牛油: '果', 蛋白: '質|质' });
function aliasSource(alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[a-z]/i.test(alias)) return `(?<![a-z])${escaped}(?:e?s)?(?![a-z])`;
  return ALIAS_NOT_BEFORE[alias] ? `${escaped}(?!${ALIAS_NOT_BEFORE[alias]})` : escaped;
}
/** Allergen ids for one matched alias, allowing an English plural ("prawns", "crabs"). */
const idsForAlias = key => ALIAS_TO_IDS.get(key) ?? (/^[a-z]/.test(key) ? ALIAS_TO_IDS.get(key.replace(/s$/, '')) ?? ALIAS_TO_IDS.get(key.replace(/es$/, '')) : undefined);
// A plural key ("nuts") is left out when its singular is listed, because the singular already matches the plural.
const ALIAS_KEYS = [...ALIAS_TO_IDS.keys()].filter(key => !/^[a-z].*s$/.test(key) || ![key.slice(0, -1), key.slice(0, -2)].some(stem => stem !== key && ALIAS_TO_IDS.has(stem) && /^[a-z]/.test(stem) && (stem + 's' === key || stem + 'es' === key)));
const ALL_ALIASES_SOURCE = ALIAS_KEYS.sort((a, b) => b.length - a.length).map(aliasSource).join('|');
const ALIAS_GLOBAL = new RegExp(`(?:${ALL_ALIASES_SOURCE})`, 'giu');
const ALIAS_ANY = new RegExp(`(?:${ALL_ALIASES_SOURCE})`, 'iu');
const testPattern = (pattern, text) => { pattern.lastIndex = 0; const hit = pattern.test(text); pattern.lastIndex = 0; return hit; };

/** Allergen ids named in a piece of text (longest alias first, no overlaps) and the words left over. */
function readAllergens(text) {
  const ids = [];
  let generic = false;
  ALIAS_GLOBAL.lastIndex = 0;
  const remainder = clean(text).replace(ALIAS_GLOBAL, match => {
    const key = clean(match);
    if (GENERIC_NUT_ALIASES.has(key)) generic = true;
    for (const id of idsForAlias(key) ?? []) if (!ids.includes(id)) ids.push(id);
    return ' ';
  });
  return { ids, remainder, generic };
}

/** Maps one word from a link or an assistant to allergen ids; unknown words give []. */
export function allergenIdsForWord(word) {
  const key = clean(String(word ?? '')).replace(/^en:/, '').replace(/\s+/g, ' ');
  if (!key) return [];
  if (ALLERGENS.includes(key)) return [key];
  const compact = key.replace(/[\s_'’-]/g, '');
  const ids = ALIAS_TO_IDS.get(key) ?? ALIAS_TO_IDS.get(key.replace(/[-_]/g, ' ')) ?? COMPACT_ALIAS_TO_IDS.get(compact)
    ?? (/[a-z]s$/.test(compact) ? COMPACT_ALIAS_TO_IDS.get(compact.slice(0, -1)) : undefined);
  return ids ? [...ids] : [];
}
/** The label of an allergy this site cannot filter (mustard, molluscs, …), or null. */
export function unsupportedAllergenLabel(word) {
  const text = clean(String(word ?? ''));
  return UNSUPPORTED_ALLERGENS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}
const namesAllergy = text => readAllergens(text).ids.length > 0 || Boolean(unsupportedAllergenLabel(text));
const UNSUPPORTED_GLOBAL = UNSUPPORTED_ALLERGENS.map(([label, pattern]) => [label, new RegExp(pattern.source, 'giu')]);
/** Removes allergies the site cannot filter (魷魚, mustard) before allergen words are read, so 魷魚 never reads as 魚. */
function takeUnsupported(text) {
  const labels = [];
  let rest = clean(text);
  for (const [label, pattern] of UNSUPPORTED_GLOBAL) rest = rest.replace(pattern, () => { if (!labels.includes(label)) labels.push(label); return ' '; });
  return { rest, labels };
}

/**
 * Reads one link value such as "花生和牛奶", "牛奶製品", "tree nuts" or "peanuts mustard".
 * @returns {{ids:string[], unsupported:string[], unknown:string[], generic:boolean}} unknown keeps the words as written.
 */
export function readAllergenPhrase(text) {
  const result = { ids: [], unsupported: [], unknown: [], generic: false };
  const add = ids => { for (const id of ids) if (!result.ids.includes(id)) result.ids.push(id); };
  for (const raw of String(text ?? '').normalize('NFKC').split(LIST_SEPARATOR)) {
    const item = clean(raw);
    if (!item) continue;
    const direct = allergenIdsForWord(item);
    if (direct.length) { add(direct); if (GENERIC_NUT_ALIASES.has(item)) result.generic = true; continue; }
    const taken = takeUnsupported(item);
    result.unsupported.push(...taken.labels);
    const found = readAllergens(taken.rest);
    add(found.ids);
    if (found.generic) result.generic = true;
    let named = found.ids.length > 0 || taken.labels.length > 0;
    const unknown = [];
    for (const word of found.remainder.split(/[\s\p{P}\p{S}]+/u).filter(Boolean)) {
      const ids = allergenIdsForWord(word);
      const label = ids.length ? null : unsupportedAllergenLabel(word);
      if (ids.length) { add(ids); named = true; }
      else if (label) { result.unsupported.push(label); named = true; }
      else if (!KNOWN_SUFFIX.test(word)) unknown.push(word);
    }
    if (named) result.unknown.push(...unknown);
    else result.unknown.push(raw.trim());
  }
  result.unsupported = [...new Set(result.unsupported)];
  return result;
}

// Exclusion triggers. A trigger "owns" the allergy list next to it. Hard words (allergies, "can't eat") turn every item
// that cannot be named into an "unclear" allergy; soft words ("without", 唔含) turn it into a food that is not searched.
const ZH_SUFFIX = /(?:過敏|过敏|敏感|不耐受|不耐(?![放用熱热煮存久看穿洗]))(?:反應|反应|症狀|症状|問題|问题|史)?/gu;
const ZH_PREFIX = /唔可以含有|唔可以含|不可以含有|不能含有|冇得食|冇得飲|冇得掂|唔食得|唔飲得|食唔得|飲唔得|食唔到|飲唔到|唔使有|唔使落|唔使加|唔使放|唔需要|不需要|不用加|不用放|不用有|唔使|不用|唔可以食|唔可以飲|唔可以有|唔可以|不能吃|不能喝|不可以吃|不可以喝|戒口唔食|唔想食|唔想飲|唔想要|唔想買|唔想|不想吃|不想喝|不想要|不想|唔要食|唔要飲|唔好買|唔好食|唔好飲|唔太鍾意|唔係好鍾意|唔鍾意|唔中意|唔like|不喜歡|不喜欢|好憎|討厭|讨厌|憎|唔會食|唔會飲|唔適合食|唔適合飲|唔適合|不適合|唔好俾|唔好畀|唔沾|唔掂|戒咗|戒掉|唔食|唔飲|不吃|不喝|最好避開|避免|避開|避开|不含|唔含|唔好有|不要有|唔要有|(?<![恐哪唔不])怕/gu;
const ZH_HARD = /冇得|唔食得|唔飲得|食唔得|飲唔得|食唔到|飲唔到|唔可以|不能|不可以|戒口/u;
const EN_PREFIX = /(?<![a-z])(?:allergic(?:\s+to)?|anaphyla\w*(?:\s+to)?|allerg(?:y|ies|ens?)\s*(?:to|[:：-])|intoleran(?:t|ce)\s+(?:to|of)|sensitive\s+to|can['’]?t\s+(?:eat|have|drink|take|tolerate|consume)|cannot\s+(?:eat|have|drink|take|tolerate|consume)|skip|(?:do\s*not|don['’]?t)\s+(?:eat|drink|have|want|like|give)|(?:must\s+not|mustn['’]?t)\s+(?:contain|have|include|eat|drink|take)|not\s+allowed\s+(?:to\s+)?(?:eat|have|drink)|(?:shouldn['’]?t|should\s+not|won['’]?t|will\s+not)\s+(?:eat|have|drink)|(?:get|gets|got|have|has|had)\s+(?:an?\s+)?(?:bad\s+|severe\s+|allergic\s+)?(?:reactions?|hives|a\s+rash|rashes)\s+(?:from|to|after\s+eating)|reacts?\s+(?:badly\s+)?to|gets?\s+(?:sick|ill|a\s+rash|hives|itchy|bloated)\s+(?:from|after\s+(?:eating|drinking)|when\s+(?:i|he|she)\s+(?:eats?|drinks?))|swells?\s+up\s+(?:if|when)\s+(?:i|he|she|they)\s+(?:eats?|drinks?)|hate|dislike|not\s+a\s+fan\s+of|(?:keep|stay)\s+away\s+from|steer\s+clear\s+of|stay\s+off|cut(?:ting)?\s+out|nothing\s+(?:containing|with)|no\s+more|(?:does\s*not|doesn['’]?t)\s+(?:contain|have|include)|not\s+contain(?:ing)?|free\s+(?:from|of)|exclud(?:e|ing)|avoid(?:ing)?|without|(?:no|nothing)\s+(?:(?:foods?|products?|snacks?|drinks?|things?|items?)\s+)?(?:that|which)\s+(?:contains?|has|have|includes?))(?![a-z])\s*[:：]?/giu;
const EN_HARD = /allerg|anaphyla|intoleran|sensitiv|can['’]?t|cannot|must|allowed|tolerate|reaction|react|hives|rash|sick|ill|swell/iu;
/** "anything that contains", "products derived from": skipped so the allergen after them is read. */
const EN_RELATIVE = /^\s*(?:(?:any|all|the)\s+)?(?:foods?|products?|anything|things?|stuff|items?|snacks?|drinks?)?\s*(?:(?:that|which)\s+(?:contains?|has|have|includes?|uses?|(?:is|are)\s+made\s+(?:from|with)|comes?\s+from)|containing|including|made\s+(?:from|with)|derived\s+from|based\s+on|with)\s+/iu;
const EN_SUFFIX = /(?<![a-z])(?:allerg(?:y|ies)|allergic(?!\s+to)|intoleran(?:t|ce)|sensitivit(?:y|ies)|(?:is|are)\s+(?:a\s+)?(?:big|hard|definite)\s+no|(?:doesn['’]?t|does\s+not|don['’]?t|do\s+not)\s+agree\s+with\s+(?:me|him|her|us)|(?:is|are)\s+(?:off[-\s]?limits|a\s+no[-\s]?go|not\s+(?:ok|okay|allowed|safe)\s+for\s+me)|makes?\s+(?:me|my\s+(?:throat|face|lips?|mouth|skin)|him|her)\s+(?:very\s+|really\s+|so\s+)?(?:sick|ill|itch(?:y)?|swell(?:\s+up)?|break\s+out|throw\s+up|vomit)|upsets?\s+(?:my|his|her)\s+(?:stomach|tummy)|gives?\s+(?:me|him|her)\s+(?:an?\s+)?(?:stomach\s*ache|tummy\s*ache|diarrh?o?ea|hives|rash(?:es)?)|(?:is|are)\s+not\s+for\s+me|(?:is|are)\s+(?:a\s+)?(?:big\s+)?problem(?:\s+for\s+(?:me|him|her|us))?|[-:：]\s*(?:no|nope|never|none)(?![a-z])|gives?\s+me\s+(?:hives|a\s+rash|rashes))(?![a-z])|(?<=[a-z㐀-鿿])\s*[-:：]\s*(?:no|nope|never|none)(?![a-z])/giu;
const ZH_CONTENT = '想食|想飲|想買|想搵|想要|我要|要買|搵|買|嘅|的|但|低糖|少糖|減糖|無糖|无糖|零糖|走糖|低鈉|少鈉|低鹽|少鹽|減鹽|高蛋白|最平|平啲|便宜|預算|预算|百佳|惠康|吉之島|蚊|元';
/** Where a Chinese "prefix" list ends: 唔含花生 | 嘅餅乾. */
const ZH_STOP = new RegExp(`${ZH_CONTENT}|口味|味|\\d|\\$|，|,`, 'u');
/** Where a Chinese list that ends in 過敏 starts when there is no 對: 低糖餅乾 | 花生過敏. */
const ZH_START = new RegExp(`${ZH_CONTENT}|餅乾|饼干|餅|饼|零食|小食|飲品|嘢飲|麵包|面包|蛋糕|朱古力|巧克力|咖啡|即食麵|杯麵|薯片|果汁|汽水|可樂|\\d`, 'gu');
const EN_STOP = /(?<![a-z])(?:but|so|and\s+(?:i|we)|i\s+want|i'?d\s+like|want|wants|wanna|need|needs|looking|please|show|find|give|under|below|budget|within|less\s+than|cheap(?:er|est)?|low|for|that|which|in|at|from)(?![a-z])|\$|\d/iu;
const EN_START = /(?<![a-z])(?:have|has|had|got|with|my|our|his|her|their|i'?m|we|severe|bad|mild|serious|a|an|but|so|want|need|looking|for|biscuits?|cookies?|crackers?|snacks?|drinks?|chocolate|coffee|tea|juice|noodles?|chips|under|below|budget|cheap(?:est)?|low|less|i)(?![a-z])|\$|\d/giu;
const LIST_SEPARATOR = /\s*(?:同埋|同|和|及|與|与|、|,|，|\/|&|或者|或|(?<![a-z])(?:or|and|nor|plus)(?![a-z]))\s*/iu;
const ITEM_LEAD = /^(?:我哋|我們|我|佢哋|佢|他|她|你|個仔|個女|小朋友|屋企人|家人|老人家|媽媽|爸爸|阿媽|阿爸|老公|老婆|本身|有(?!機|机)|係|是|好|都|亦|也|會|对|對|輕微|嚴重|严重|最好|避免|避開|唔食得|唔飲得|食唔得|飲唔得|唔可以食|唔可以飲|唔可以有|唔可以|唔想食|唔想飲|唔想要|唔想|唔要食|唔要飲|仲有|還有|还有|另外|同埋|仲|其他|其餘|其余|全部|所有|連|唔使有|唔使落|唔使|不用|唔好買|唔好俾|唔好畀|唔好|唔鍾意|唔會食|唔會|唔適合食|唔適合|唔沾|唔掂|戒咗|戒掉|唔食|唔飲|不含|唔含|唔要|不要|戒|怕|俾|畀|含有|帶有|包含)+/u;
const TRAILING_WORDS = /(?:全部|所有|一律|都係|晒|都|也|亦|會|会|好|要|有啲|少少|有點|有点|嚴重|严重|輕微|轻微|有|我哋|我們|我|佢哋|佢)+$/u;
/** Words that end a list item without naming anything (唔食得花生同埋要低糖 → 要). */
const ITEM_TRAIL = /(?:而且|仲有|仲|又|要|想|都|亦|也)+$/u;
const EN_FILLER_ITEM = /(?<![a-z])(?:a|an|the|any|all|of|some|cow'?s|foods?|products?|stuff|things?|containing|contains|with|kinds?|types?|me|i'?m|i|am|have|has|got|my|our|his|her|their|son'?s?|daughter'?s?|kids?|child(?:ren)?|husband|wife|mum|mom|dad|severe|mild|bad|very|really|also|too|to|eat|eating|drink|drinking|ones?|kind|family|people|person|here|myself)(?![a-z])/giu;
const PARTICLES = /[\s㗎喎呀啊架嘅啦囉咯嘛]/gu;
const NO_ALLERGY_BEFORE = /(?:沒有|没有|冇|無|无|唔係|不是|冇乜|沒甚麼|没什么)\s*(?:任何|乜嘢|咩|甚麼|什么)?\s*(?:食物)?\s*$|(?<![a-z])(?:no|not|zero|don['’]?t\s+have|do\s+not\s+have|without)\s*(?:any|known|food)?\s*$/iu;
// 冇／無／沒有 only mean "without" when they are not part of 有冇 (do you have) — 所有／只有 are still fine.
const WEAK_AVOID = "(?:(?<!(?<![所只])有)(?:無|无|冇|沒有|没有)|不要|唔要|戒|(?<![帶带拎攞行搬偷飛外])走|(?<![a-z])(?:no|non|zero)(?![a-z]))";
const WEAK_LIST = `(?:${ALL_ALIASES_SOURCE})(?:${LIST_SEPARATOR.source}(?:${ALL_ALIASES_SOURCE}))*`;
const WEAK_WORD = new RegExp(`${WEAK_AVOID}\\s*`, 'giu');
const FREE_SUFFIX = new RegExp(`(${WEAK_LIST})[-\\s]*free(?![a-z])`, 'giu');
const ALIAS_STICKY = new RegExp(`(?:${ALL_ALIASES_SOURCE})`, 'iuy');
const SEPARATOR_STICKY = new RegExp(LIST_SEPARATOR.source, 'iuy');
// Category words a person may refuse (唔要餅乾 / no snacks); single characters such as 飲 are left out on purpose.
const CATEGORY_WORDS = '嘢飲|飲品|飲料|drinks?|beverages?|零食|小食|snacks?|麵包|面包|方包|蛋糕|bread|cakes?';
const FOOD_WORDS = [...FOOD_CUES.map(([pattern]) => pattern.source), CATEGORY_WORDS, BISCUIT_CUE.source].join('|');
const AVOID_FOOD = new RegExp(`${WEAK_AVOID}\\s*(${FOOD_WORDS})`, 'giu');
// Candy words count here too: in 唔要花生 牛奶糖 the milk describes the candy.
const FOOD_AHEAD = new RegExp(`^\\s*(?:${FOOD_WORDS}|糖果|糖(?!尿|分)|candy|candies|toffees?|sweets)`, 'iu');
/** The allergen list that starts at index (花生同芝麻 / peanuts or sesame), or null. */
function aliasListAt(text, index) {
  ALIAS_STICKY.lastIndex = index;
  const first = ALIAS_STICKY.exec(text);
  if (!first) return null;
  const aliases = [first[0]];
  let end = ALIAS_STICKY.lastIndex;
  for (let guard = 0; guard < 12; guard++) {
    SEPARATOR_STICKY.lastIndex = end;
    const separator = SEPARATOR_STICKY.exec(text);
    const spaces = /^\s+/u.exec(text.slice(end));
    const next = separator ? SEPARATOR_STICKY.lastIndex : spaces ? end + spaces[0].length : -1;
    if (next < 0) break;
    ALIAS_STICKY.lastIndex = next;
    const alias = ALIAS_STICKY.exec(text);
    if (!alias) break;
    if (!separator && FOOD_AHEAD.test(text.slice(ALIAS_STICKY.lastIndex))) break;
    aliases.push(alias[0]);
    end = ALIAS_STICKY.lastIndex;
  }
  const free = /^[-\s]*free(?![a-z])/iu.exec(text.slice(end));
  return { aliases, end: end + (free ? free[0].length : 0) };
}
/** The first weak exclusion with its allergen list: {start, end, word, list}. */
function weakListAt(text, from = 0) {
  WEAK_WORD.lastIndex = from;
  for (let match = WEAK_WORD.exec(text); match; match = WEAK_WORD.exec(text)) {
    const list = aliasListAt(text, match.index + match[0].length);
    if (list) { WEAK_WORD.lastIndex = 0; return { start: match.index, end: list.end, word: match[0], aliases: list.aliases }; }
    if (WEAK_WORD.lastIndex === match.index) WEAK_WORD.lastIndex++;
  }
  WEAK_WORD.lastIndex = 0;
  return null;
}
const QUESTION_END = /(?:嗎|吗|咩|嘛|呀|啊|吖)\s*$/u;
const EXISTENCE_WORDS = /有冇|有沒有|有没有|有無|有无|(?<![a-z])(?:is\s+there|are\s+there|do\s+you\s+(?:have|sell)|have\s+you\s+got|any)(?![a-z])/iu;
const WANT_WORDS = /想食|想飲|想買|想搵|想要|我要|要買|搵|買|推介|推薦|(?<![a-z])(?:want|need|looking|please|show|find|recommend|give)(?![a-z])/iu;
const LACTOSE_FREE = /(?:無|无|冇|零|低|不含|唔含|去)\s*乳糖|lactose[-\s]*free|(?:without|with\s+no|no)\s+lactose/giu;
const NON_DAIRY_MILK = /(?:non[-\s]?dairy|dairy[-\s]?free|plant[-\s]?based|vegan)\s*milks?|植物奶|素奶/giu;
const LACTOSE_TOKEN = '\uE000';
const COELIAC = /乳糜瀉|乳糜泻|(?<![a-z])c(?:o)?eliac(?:'?s)?(?:\s+disease)?(?![a-z])/giu;
const SPLIT_BEFORE_WANT = /(?<![唔不冇無没沒])(?=想食|想飲|想買|想搵|想要|我要|(?<![a-z])i\s+want(?![a-z])|(?<![a-z])i'?d\s+like(?![a-z])|(?<![a-z])looking\s+for(?![a-z]))/iu;

/** Index of the first match of any pattern in text, or -1. */
function firstIndex(text, patterns) {
  let best = -1;
  for (const pattern of patterns) {
    const copy = new RegExp(pattern.source, pattern.flags.replace('g', '').replace('y', ''));
    const index = text.search(copy);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}
function lastBoundaryEnd(text, pattern) {
  let end = 0;
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) end = match.index + match[0].length;
  return end;
}
/** True when a short piece names a food, a category, a shop, a sort, a price or a wish (so it is not an allergy list item). */
function hasContent(text) {
  if (WANT_WORDS.test(text) || /\d|\$/.test(text) || BISCUIT_CUE.test(text)) return true;
  if ([...SORT_CUES, ...STORE_CUES, ...CATEGORY_CUES].some(([, pattern]) => testPattern(pattern, text))) return true;
  return FOOD_CUES.some(([pattern]) => [...text.matchAll(pattern)].some(match => !ALIAS_TO_IDS.has(clean(match[0]))));
}
/** True when a short piece adds a wish, a shop, a price, a sort or a category, so it does not continue an allergy list. */
function hasListContent(text) {
  if (WANT_WORDS.test(text) || /\d|\$/.test(text) || BISCUIT_CUE.test(text)) return true;
  return [...SORT_CUES, ...STORE_CUES, ...CATEGORY_CUES].some(([, pattern]) => testPattern(pattern, text));
}
/** "but not tree nuts" / "tree nuts are fine" is an exception, not another allergy. */
const NOT_AN_ITEM = /^\s*(?:not|except|apart\s+from|other\s+than|唔係|不是|除咗|除了)|(?<![a-z])(?:ok|okay|fine|safe|no\s+problem)(?![a-z])|(?<![唔不冇無没沒])(?:可以|食得|飲得)|冇問題|無問題|沒問題|冇事/iu;
/** True when a piece only names allergens (牛奶 / mustard / peanuts and milk / 我對花生). */
function namesOnlyAllergens(text) {
  const found = readAllergens(clean(text).replace(ITEM_LEAD, ''));
  let rest = found.remainder;
  let named = found.ids.length > 0;
  for (const [, pattern] of UNSUPPORTED_ALLERGENS) {
    const global = new RegExp(pattern.source, 'giu');
    if (global.test(rest)) { named = true; rest = rest.replace(new RegExp(pattern.source, 'giu'), ' '); }
  }
  rest = rest.split(LIST_SEPARATOR).join(' ').replace(/(?:都係|都|也|亦|呢|呀|啊|吖|啦|喎|(?<![a-z])(?:too|also|as\s+well)(?![a-z]))/giu, ' ').replace(/[\s\p{P}\p{S}]+/gu, '');
  return named && !rest;
}
const ZH_LIST_INTRO = /^\s*(?:原|源|食物|食品|嘅食物|嘅嘢)?\s*(?:[:：]|係|是|有|包括|包含)\s*/u;
function triggerOf(text) {
  for (const [pattern, kind, hard] of [[ZH_PREFIX, 'prefix', ZH_HARD], [EN_PREFIX, 'prefix', EN_HARD], [ZH_SUFFIX, 'suffix', null], [EN_SUFFIX, 'suffix', null]]) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    pattern.lastIndex = 0;
    if (!match) continue;
    const tail = text.slice(match.index + match[0].length);
    // 過敏原：花生，牛奶 lists its items after the word, like a prefix.
    if (pattern === ZH_SUFFIX && ZH_LIST_INTRO.test(tail)) return { trigger: 'prefix', hard: true };
    // 花生，牛奶都唔食得 / peanuts, milk I can't eat: nothing follows, so the items came before.
    if (kind === 'prefix' && !tail.replace(PARTICLES, '').replace(EN_FILLER_ITEM, ' ').replace(/[\s\p{P}\p{S}]+/gu, '')) return { trigger: 'suffix', hard: hard.test(match[0]) };
    return { trigger: kind, hard: hard ? hard.test(match[0]) : true };
  }
  if (ZH_END_REFUSAL.test(text)) return { trigger: 'suffix', hard: false };
  if (testPattern(EXCEPT_WORDS, text)) return { trigger: 'prefix', hard: false };
  if (ZH_SYMPTOM.test(text)) return { trigger: 'suffix', hard: true };
  // 唔要花生，牛奶 / no peanuts, milk: a weak word can also start a short list.
  if (weakListAt(text)) return { trigger: 'weak', hard: false };
  return { trigger: null, hard: false };
}

/** Splits a request into clauses, remembering which ones are questions and which only continue an allergy list. */
function clausesOf(text) {
  const pieces = [];
  for (const match of text.matchAll(/((?:[^，,。.;；!！?？\n]|(?<=\d)\.(?=\d))+)([，,。.;；!！?？\n]*)/gu)) {
    const question = /[?？]/u.test(match[2]) || QUESTION_END.test(match[1]);
    for (const part of match[1].split(/但係|但是|不過|可是|(?<![a-z])(?<!(?:anything|everything|all|nothing)\s+)but(?!\s+not)(?![a-z])|(?<![a-z])however(?![a-z])/iu)) {
      for (const piece of part.split(SPLIT_BEFORE_WANT)) {
        if (piece.trim()) pieces.push({ text: piece, question, ...triggerOf(piece) });
      }
    }
  }
  // The next piece is kept so "除咗花生之外，仲有蝦" can tell an addition from an exception.
  pieces.forEach((piece, index) => { piece.following = pieces[index + 1]?.text ?? ''; });
  // "allergies: peanuts, milk" / "對花生過敏，牛奶": a short list item after an allergy clause belongs to it.
  for (let i = 1; i < pieces.length; i++) {
    const previous = pieces[i - 1], piece = pieces[i];
    if (piece.trigger || piece.question || NOT_AN_ITEM.test(piece.text)) continue;
    const source = previous.continuation ? previous.from : previous.trigger;
    // After "allergies:" or "allergic to", a short item is part of the list even when it is a food (chocolate, coffee).
    if (source === 'prefix' && piece.text.trim().length <= 24 && !hasListContent(piece.text)) Object.assign(piece, { continuation: true, from: 'prefix', hard: previous.hard, listOnly: !namesAllergy(piece.text) });
    else if (source && namesOnlyAllergens(piece.text)) Object.assign(piece, { continuation: true, from: source, hard: source !== 'weak' });
  }
  // "花生，牛奶過敏": allergen-only items before a clause that ends in 過敏 belong to it.
  for (let i = pieces.length - 2; i >= 0; i--) {
    const next = pieces[i + 1], piece = pieces[i];
    if (piece.trigger || piece.continuation || NOT_AN_ITEM.test(piece.text)) continue;
    if ((next.trigger === 'suffix' || next.from === 'before-suffix') && namesOnlyAllergens(piece.text)) Object.assign(piece, { continuation: true, from: 'before-suffix', hard: true });
  }
  return pieces;
}

/** Sorts an item that names no allergen: a diet or sort wish, an allergy the site cannot filter, another restriction, or unknown. */
function readLooseItem(item, report, hard) {
  if (GENERIC_ALLERGY_WORDS.test(item)) { report.genericAllergy = true; return; }
  const diet = DIET_WORDS.find(([, pattern]) => pattern.test(item));
  if (diet) { report.sorts.push(diet[0]); return; }
  const unsupported = unsupportedAllergenLabel(item);
  if (unsupported) { report.unsupported.push(unsupported); return; }
  if (OTHER_RESTRICTIONS.test(item)) { report.other.push(item); return; }
  (hard ? report.unclear : report.avoidedFoods).push(item.slice(0, 20));
}
const onlyCategoryWords = text => {
  if (!BISCUIT_CUE.test(text) && !CATEGORY_CUES.some(([, pattern]) => testPattern(pattern, text))) return false;
  let rest = text.replace(new RegExp(BISCUIT_CUE.source, 'giu'), ' ');
  for (const [, pattern] of CATEGORY_CUES) rest = rest.replace(pattern, ' ');
  return !rest.replace(/[\s\p{P}\p{S}]+/gu, '');
};

/** Reads the items of an allergy statement and returns the words that should stay in the request (a product they want). */
function readItems(span, report, hard) {
  const kept = [];
  for (const raw of span.split(LIST_SEPARATOR)) {
    const item = raw.replace(PARTICLES, ' ').trim().replace(ITEM_LEAD, '').replace(ITEM_TRAIL, '').replace(EN_FILLER_ITEM, ' ').replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
    if (!item || NOT_AN_ITEM.test(item)) continue;
    const taken = takeUnsupported(item);
    report.unsupported.push(...taken.labels);
    const rest0 = taken.rest.replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
    if (!rest0 || (taken.labels.length && rest0.split(' ').every(word => KNOWN_SUFFIX.test(word)))) continue;
    const found = readAllergens(rest0);
    if (!found.ids.length) { readLooseItem(rest0, report, hard); continue; }
    found.ids.forEach(report.add);
    if (found.generic) report.genericNuts = true;
    const words = found.remainder.replace(/[\s\p{P}\p{S}]+/gu, ' ').trim().split(' ').filter(word => word && !KNOWN_SUFFIX.test(word));
    if (!words.length) continue;
    const rest = words.join(' ');
    const unsupported = unsupportedAllergenLabel(rest);
    if (unsupported) { report.unsupported.push(unsupported); continue; }
    // 不含麩質麵包: with a soft word the bread is what they want. In an allergy statement only a category word is kept.
    if (!hard || onlyCategoryWords(rest)) kept.push(rest);
    else report.unclear.push(rest.slice(0, 20));
  }
  return kept;
}

function itemsBefore(before, start) {
  const anchor = Math.max(before.lastIndexOf('對'), before.lastIndexOf('对'));
  let from = anchor >= 0 ? anchor + 1 : start(before);
  let span = before.slice(from);
  if (anchor < 0 && !namesAllergy(span)) { from = 0; span = before; }
  return { cut: anchor >= 0 ? anchor : from, span: span.replace(TRAILING_WORDS, '') };
}
const zhStart = before => lastBoundaryEnd(before, ZH_START);
const enStart = before => lastBoundaryEnd(before, EN_START);

/** Chinese statements that end with the allergy word: 對花生同麻油過敏 / 花生食唔得 / 過敏原：花生、牛奶. */
function readZhSuffix(text, report) {
  let from = 0;
  for (let guard = 0; guard < 8; guard++) {
    ZH_SUFFIX.lastIndex = from;
    const match = ZH_SUFFIX.exec(text);
    if (!match) break;
    const before = text.slice(0, match.index);
    const tail = text.slice(match.index + match[0].length);
    const end = match.index + match[0].length;
    if (NO_ALLERGY_BEFORE.test(before)) { report.noAllergy = true; text = `${before} ${tail}`; from = before.length + 1; continue; }
    const { cut, span } = itemsBefore(before, zhStart);
    const colon = tail.match(ZH_LIST_INTRO);
    if (colon && !namesAllergy(span)) {
      // 過敏原：花生、牛奶 / 過敏係花生同蝦.
      const after = tail.slice(colon[0].length);
      const stop = after.search(ZH_STOP);
      const list = stop >= 0 ? after.slice(0, stop) : after;
      report.triggered = true;
      const kept = readItems(list, report, true);
      text = `${before} ${kept.join(' ')} ${after.slice(list.length)}`;
      from = before.length + 1;
      continue;
    }
    if (match[0] === '敏感' && !namesAllergy(span) && !/食物|食品|嘢食|food/iu.test(span)) { from = end; continue; }
    report.triggered = true;
    const kept = readItems(span, report, true).join(' ');
    const head = text.slice(0, cut);
    text = `${head} ${kept} ${tail}`;
    from = head.length + kept.length + 2;
  }
  return text;
}

/** Chinese statements that start with the exclusion word: 唔食得花生同芝麻 / 唔含牛奶嘅餅 / 麩質同大豆都唔食得. */
function readZhPrefix(text, report) {
  let from = 0;
  for (let guard = 0; guard < 8; guard++) {
    ZH_PREFIX.lastIndex = from;
    const match = ZH_PREFIX.exec(text);
    if (!match) break;
    const hard = ZH_HARD.test(match[0]);
    if (!hard && /(?:以前|之前|從前|从前|以往|曾經|曾经)\s*(?:我|都|好)?\s*$/u.test(text.slice(0, match.index))) { from = match.index + match[0].length; continue; }
    const after = text.slice(match.index + match[0].length);
    const stop = firstIndex(after, [ZH_STOP, ZH_PREFIX, ZH_SUFFIX]);
    const span = stop >= 0 ? after.slice(0, stop) : after;
    report.triggered = true;
    if (!span.replace(PARTICLES, '')) {
      const before = text.slice(0, match.index);
      const { cut, span: items } = itemsBefore(before, zhStart);
      const kept = readItems(items, report, hard).join(' ');
      const head = text.slice(0, cut);
      text = `${head} ${kept} ${after}`;
      from = head.length + kept.length + 2;
      continue;
    }
    const kept = readItems(span, report, hard).join(' ');
    const head = text.slice(0, match.index);
    text = `${head} ${kept} ${after.slice(span.length)}`;
    from = head.length + kept.length + 2;
  }
  return text;
}

/** English statements: allergic to peanuts and milk / must not contain milk / I can't eat peanuts / peanut allergy. */
function readEnglish(text, report) {
  let from = 0;
  for (let guard = 0; guard < 8; guard++) {
    EN_PREFIX.lastIndex = from;
    const match = EN_PREFIX.exec(text);
    if (!match) break;
    const hard = EN_HARD.test(match[0]);
    if (/without/iu.test(match[0]) && /(?:can['’]?t|cannot|couldn['’]?t)\s+(?:live|do|survive|go|cope)\s*$/iu.test(text.slice(0, match.index))) { from = match.index + match[0].length; continue; }
    if (/(?:don['’]?t|do\s*not)\s+have/iu.test(match[0]) && /^\s*(?:any\s+)?[a-z\s'-]{1,30}?\s+(?:at\s+home|left|anymore|any\s+more|in\s+the\s+(?:fridge|house)|right\s+now)(?![a-z])/iu.test(text.slice(match.index + match[0].length))) { from = match.index + match[0].length; continue; }
    const relative = text.slice(match.index + match[0].length).match(EN_RELATIVE);
    const after = text.slice(match.index + match[0].length + (relative ? relative[0].length : 0));
    const stop = firstIndex(after, [EN_STOP, EN_PREFIX, EN_SUFFIX, EXCEPT_WORDS]);
    const span = stop >= 0 ? after.slice(0, stop) : after;
    report.triggered = true;
    if (!span.replace(EN_FILLER_ITEM, ' ').replace(/[\s\p{P}\p{S}]+/gu, '')) {
      const before = text.slice(0, match.index);
      const { cut, span: items } = itemsBefore(before, enStart);
      const kept = readItems(items, report, hard).join(' ');
      const head = text.slice(0, cut);
      text = `${head} ${kept} ${after}`;
      from = head.length + kept.length + 2;
      continue;
    }
    const kept = readItems(span, report, hard).join(' ');
    const head = text.slice(0, match.index);
    text = `${head} ${kept} ${after.slice(span.length)}`;
    from = head.length + kept.length + 2;
  }
  from = 0;
  for (let guard = 0; guard < 8; guard++) {
    EN_SUFFIX.lastIndex = from;
    const match = EN_SUFFIX.exec(text);
    if (!match) break;
    const before = text.slice(0, match.index);
    const tail = text.slice(match.index + match[0].length);
    if (NO_ALLERGY_BEFORE.test(before)) { report.noAllergy = true; text = `${before} ${tail}`; from = before.length + 1; continue; }
    report.triggered = true;
    const { cut, span } = itemsBefore(before, enStart);
    const kept = readItems(span, report, true).join(' ');
    const head = text.slice(0, cut);
    text = `${head} ${kept} ${tail}`;
    from = head.length + kept.length + 2;
  }
  return text;
}

/** Weak words own only what comes right after them: 冇花生嘅餅乾 / no milk / 唔要芝麻同花生 / 唔要朱古力. */
function readWeak(text, question, report) {
  // In a question, 冇／沒有 + food can ask whether a shop has it (惠康冇花生醬咩 / 百佳沒有花生醬嗎). It is only read that way
  // when nothing but a question ending follows and the question has no 有冇 of its own: 有冇無花生餅乾 still avoids peanuts.
  const asks = (whole, offset, all) => question && /^(?:無|无|冇|沒有|没有)/u.test(whole)
    && !EXISTENCE_WORDS.test(all.slice(0, offset)) && /^[\s嗎吗咩呀啊吖嘛呢㗎喎?？]*$/u.test(all.slice(offset + whole.length));
  // 我冇牛奶喇 / 屋企冇牛奶，想買: 冇 is the verb "have none", so the food is wanted.
  // 冇花生醬唔得 / 冇牛奶我唔得㗎: they cannot do without it.
  const needsIt = (end, all) => /^\s*(?:我|佢)?\s*(?:都)?\s*(?:唔得|不行|唔掂|唔慣|好難頂)/u.test(all.slice(end));
  const ranOut = (whole, start, end, all) => /^(?:冇|沒有|没有)/u.test(whole) && !/^\s*(?:先|至|才|就)\s*(?:食得|飲得|得|可以|ok)/iu.test(all.slice(end))
    && (/(?:我|你|佢|我哋|我們|屋企|家裡|家里|家中|公司|雪櫃|冰箱)\s*(?:都|已經|已经|而家)?\s*$/u.test(all.slice(0, start)) || /^\s*(?:喇|啦|了|晒|飲|食|用)/u.test(all.slice(end)));
  // 百佳沒有花生醬嗎 asks for peanut butter: the question word goes, the food stays.
  const asked = whole => whole.replace(/^(?:無|无|冇|沒有|没有)/u, ' ');
  text = text.replace(AVOID_FOOD, (whole, food, ...rest) => {
    const all = rest.at(-1), offset = rest.at(-2);
    if (asks(whole, offset, all)) return asked(whole);
    if (ALIAS_TO_IDS.has(clean(food))) return whole;
    report.triggered = true;
    report.avoidedFoods.push(food.trim().slice(0, 20));
    return ' ';
  });
  for (let from = 0, guard = 0; guard < 12; guard++) {
    const hit = weakListAt(text, from);
    if (!hit) break;
    const whole = text.slice(hit.start, hit.end);
    if (asks(whole, hit.start, text) || ranOut(whole, hit.start, hit.end, text) || needsIt(hit.end, text)) { text = `${text.slice(0, hit.start)}${asked(whole)}${text.slice(hit.end)}`; from = hit.start + 1; continue; }
    report.triggered = true;
    const found = readAllergens(hit.aliases.join(' '));
    found.ids.forEach(report.add);
    if (found.generic) report.genericNuts = true;
    text = `${text.slice(0, hit.start)} ${text.slice(hit.end)}`;
    from = hit.start + 1;
  }
  text = text.replace(FREE_SUFFIX, (whole, list) => {
    report.triggered = true;
    const found = readAllergens(list);
    found.ids.forEach(report.add);
    if (found.generic) report.genericNuts = true;
    return ' ';
  });
  // 唔要辣 / no alcohol: a restriction that is not a label allergen is named back, so it never colours the rest of the clause.
  text = text.replace(new RegExp(`${WEAK_AVOID}\\s*(?:太|咁)?(${OTHER_WORDS})(?![a-z])`, 'giu'), (whole, word, offset, all) => {
    if (asks(whole, offset, all)) return asked(whole);
    report.other.push(word);
    return ' ';
  });
  // A weak word in front of an allergy we cannot filter (唔要芥末) is reported, not searched.
  for (const [label, pattern] of UNSUPPORTED_ALLERGENS) {
    const weak = new RegExp(`${WEAK_AVOID}\\s*(?:${pattern.source})`, 'giu');
    text = text.replace(weak, (whole, offset, all) => {
      if (asks(whole, offset, all)) return asked(whole);
      report.triggered = true;
      report.unsupported.push(label);
      return ' ';
    });
  }
  return text;
}

// 牛奶唔要 / 花生就唔好 / 朱古力就唔要: the refusal comes after the items.
const ZH_END_REFUSAL = /(?:就|都|也|亦|我)?\s*(?:唔要|不要|唔好|唔得|不得|不行|唔掂|免了|算了|戒咗|戒掉|唔食|唔飲|唔會食)\s*[啦喇囉嘞呀啊吖了㗎架喎嘅]*\s*$/u;
function readZhEndRefusal(text, report) {
  const match = text.match(ZH_END_REFUSAL);
  if (!match) return text;
  const { cut, span } = itemsBefore(text.slice(0, match.index), zhStart);
  if (!span.replace(PARTICLES, '').replace(ITEM_LEAD, '')) return text.slice(0, match.index);
  // 冇花生醬唔得 / 冇牛奶我唔得㗎: "I can't do without it" asks for the food.
  if (/^\s*(?:冇|沒有|没有|無|无|唔要|不要)/u.test(span) && /唔得|不行|唔掂/u.test(match[0])) return text;
  report.triggered = true;
  const kept = readItems(span, report, false).join(' ');
  return `${text.slice(0, cut)} ${kept}`;
}
// 我食開花生會痕 / 飲完牛奶會肚痛: a reaction names the food before it.
const SYMPTOMS = '(?:好|周身|全身|成個人|個身|有啲|少少|即刻|會)?\\s*(?:痕|出疹|起疹|紅疹|腫|敏感|過敏|唔舒服|不舒服|肚痛|肚屙|肚瀉|腹瀉|屙|作嘔|嘔|氣喘|喘|休克|死|出事|呼吸困難|透唔到氣|頭暈|發作|入院|辛苦)';
const ZH_SYMPTOM = new RegExp(`(?:一)?(?:食|飲|掂|搽|吃|喝)(?:開|咗|完|親|到|落)?\\s*([^，,。]{0,12}?)\\s*(?:就會|都會|會|就|即刻|就即刻)\\s*(?:${SYMPTOMS})|([^，,。]{1,12}?)\\s*(?:會)?(?:令|令到|搞到|害)(?:我|佢|我個仔|我個女|小朋友)?\\s*(?:${SYMPTOMS})`, 'u');
function readZhSymptom(text, report) {
  const match = text.match(ZH_SYMPTOM);
  if (!match) return text;
  report.triggered = true;
  const kept = readItems(match[1] ?? match[2] ?? '', report, true).join(' ');
  return `${text.slice(0, match.index)} ${kept} ${text.slice(match.index + match[0].length)}`;
}
// 除咗花生之外都得 / anything except peanuts: these exclude, unless an allergy was already stated ("but not tree nuts").
const EXCEPT_WORDS = /除咗|除了|除开|除開|(?<![a-z])(?:(?:anything|everything|all|whatever)\s+(?:except|but)|except(?:\s+for)?|apart\s+from|other\s+than|but\s+not|besides|on\s+top\s+of|in\s+addition\s+to|as\s+well\s+as)(?![a-z])/giu;
/** "besides / apart from / on top of X" always add X. */
const ADDITIVE_WORDS = /^(?:besides|apart\s+from|on\s+top\s+of|in\s+addition\s+to|as\s+well\s+as)$/iu;
/** 除咗杏仁，其他堅果都唔食得: an exception needs "the others" in what follows. */
const OTHERS_AFTER = /其他|其餘|其余|全部|所有|(?<![a-z])(?:all\s+other|every\s+other|the\s+others?|other)(?![a-z])/iu;
const EXCEPT_STOP = /之外|以外|其他|其餘|其余|乜都|都|，|,|(?<![a-z])(?:is|are|and\s+(?:i|we)|i\s+want|please|for|under|below|i|i'?m|we|my)(?![a-z])|\$|\d/iu;
const ADDITIVE_AFTER = /仲有|仲|還有|还有|另外|同埋|亦都|亦|也|又|連|(?<!其他[^，,]{0,6})都|(?<![a-z])(?:also|as\s+well|too|in\s+addition|plus)(?![a-z])/iu;
const NEGATIVE_AFTER = /唔食得|唔飲得|食唔得|飲唔得|唔可以|不可以|不能|過敏|过敏|唔得|避開|避免|(?<![a-z])(?:allergic|allergy|can['’]?t|cannot|avoid|intoleran\w*)(?![a-z])/iu;
function readExcept(text, report, following = '') {
  let from = 0;
  for (let guard = 0; guard < 6; guard++) {
    EXCEPT_WORDS.lastIndex = from;
    const match = EXCEPT_WORDS.exec(text);
    if (!match) break;
    const after = text.slice(match.index + match[0].length);
    const stop = after.search(EXCEPT_STOP);
    const span = stop >= 0 ? after.slice(0, stop) : after;
    const tail = after.slice(span.length).replace(/^\s*(?:之外|以外)/u, ' ');
    const head = text.slice(0, match.index);
    const later = `${tail} ${following}`;
    let kept = '';
    // "除咗花生之外，仲有蝦" / "apart from peanuts I am also allergic to milk" add to the list; "allergic to nuts except almonds"
    // or "除咗杏仁，其他堅果都唔食得" name an allowed exception. Anything else ("anything except peanuts") excludes.
    // 除咗X…都唔食得 / besides X… also adds X. Only "除咗X，其他…都唔食得" or "allergic to nuts except almonds" name an allowed X.
    const english = /^[a-z]/i.test(match[0]);
    const exception = !ADDITIVE_WORDS.test(match[0].trim()) && !ADDITIVE_AFTER.test(later) && (english
      ? report.triggered || NEGATIVE_AFTER.test(head) || (OTHERS_AFTER.test(later) && NEGATIVE_AFTER.test(later))
      : OTHERS_AFTER.test(later) && NEGATIVE_AFTER.test(later));
    if (exception) {
      // The person says these are fine, so nothing is added or removed.
      const words = span.replace(EN_FILLER_ITEM, ' ').replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
      if (words) report.exceptions.push(words.slice(0, 20));
    } else {
      report.triggered = true;
      kept = readItems(span, report, false).join(' ');
    }
    text = `${head} ${kept} ${tail}`;
    from = head.length + kept.length + 2;
  }
  return text;
}

// Safety net for refusals no rule above has read ("我唔會食花生", "not peanuts", "花生對我嚟講好危險"). It only fires when the
// negation word comes right before the allergen (or a danger word right after it), so "唔同牌子嘅牛奶", "搵唔到花生醬" or
// "忌廉夾心餅" are left alone. The person is told the site guessed and can remove the condition.
const ZH_REFUSAL_CUE = '(?:唔(?!該|该|使|知|好意思|錯|错|如|理|緊要|紧要|係|系|單止|止|耐|怕|介意|同|記得|记得|太|到|夠|够|識|识|見|见|甜|辣|鹹|咸)'
  + '|不(?!過|过|如|錯|错|用|知|少|同|斷|断|停|但|止|單|单|是|久|好意思|得了|耐|怕|介意|太|記得|记得|夠|够|甜|辣)'
  + '|(?<!(?<![所只])有)(?:冇|無|无|沒|没)(?!問題|问题|所謂|所谓|論|论|事|錯|错|幾|几|乜|聊|敵|敌|限|添加|貨|货|試|试|咁|太|蔗|糖|鹽|盐|得)'
  + '|戒(?!指)|避|(?<![恐哪唔不])怕|禁|忌口|忌食|勿)';
const ZH_REFUSAL = new RegExp(`${ZH_REFUSAL_CUE}(?:[食飲要有用落沾吃喝含加放掂俾畀啲]|任何){0,2}\\s*`, 'gu');
const EN_REFUSAL = /(?<![a-z])(?:not|no|never|without|avoid\w*|skip|stop|quit|cannot|can['’]?t|won['’]?t|don['’]?t|doesn['’]?t|shouldn['’]?t|mustn['’]?t|ban(?:ned)?|nope)(?:\s+(?:eat|eating|drink|drinking|take|taking|consume|any|more|the|some|touch|of)){0,2}\s+/giu;
const DANGER_AFTER = /^\s*(?:(?:對|对)\s*(?:我|佢|我哋|我個仔|我個女|小朋友)?\s*(?:嚟講|來說|来说)?\s*)?(?:都|係|是)?\s*(?:好|非常|十分|極|极|超)?\s*(?:危險|危险|致命)|^\s*(?:is|are)\s+(?:very\s+|really\s+|so\s+)?(?:dangerous|deadly|unsafe|poison(?:ous)?)/iu;
function readNegatedLeftover(text, question, report) {
  // "Don't you have peanut butter?" asks for it.
  if (question && /(?<![a-z])you(?![a-z])/iu.test(text)) return text;
  const hits = [];
  for (const pattern of [ZH_REFUSAL, EN_REFUSAL]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const list = aliasListAt(text, match.index + match[0].length);
      if (list) hits.push({ start: match.index, end: list.end, aliases: list.aliases });
    }
  }
  // 花生對我嚟講好危險 / peanuts are dangerous for me.
  ALIAS_GLOBAL.lastIndex = 0;
  for (const match of text.matchAll(ALIAS_GLOBAL)) {
    const after = text.slice(match.index + match[0].length);
    const danger = after.match(DANGER_AFTER);
    if (danger) hits.push({ start: match.index, end: match.index + match[0].length + danger[0].length, aliases: [match[0]] });
  }
  // "can't live without peanut butter" / 冇花生醬唔得 want the food.
  const doubleNegative = hit => /(?:can['’]?t|cannot|couldn['’]?t)\s+(?:live|do|survive|go|cope)\s*$/iu.test(text.slice(0, hit.start))
    || /^\s*(?:我|佢)?\s*(?:都)?\s*(?:唔得|不行|唔掂|唔慣)/u.test(text.slice(hit.end));
  for (let index = hits.length - 1; index >= 0; index--) if (doubleNegative(hits[index])) hits.splice(index, 1);
  if (!hits.length) return text;
  hits.sort((a, b) => b.start - a.start);
  let lastStart = Infinity;
  for (const hit of hits) {
    if (hit.end > lastStart) continue;
    const found = readAllergens(hit.aliases.join(' '));
    if (!found.ids.length) continue;
    report.triggered = true;
    found.ids.forEach(id => { report.add(id); report.negationGuess.push(id); });
    if (found.generic) report.genericNuts = true;
    text = `${text.slice(0, hit.start)} ${text.slice(hit.end)}`;
    lastStart = hit.start;
  }
  return text;
}

function readClause(clause, report) {
  if (clause.continuation) {
    report.triggered = true;
    const before = report.unclear.length;
    const kept = readItems(clause.text, report, clause.hard).join(' ');
    // "allergic to peanuts, Garden": a bare list item may be an allergy or a brand; it is not searched, and the notice says so.
    if (clause.listOnly) report.listItems.push(...report.unclear.slice(before));
    return kept;
  }
  let text = readZhSymptom(clause.text, report);
  text = readZhSuffix(text, report);
  text = readZhPrefix(text, report);
  text = readZhEndRefusal(text, report);
  // "but not tree nuts" is read before the English rules consume "allergic to peanuts", so the allergy before it is still seen.
  text = readExcept(text, report, clause.following ?? '');
  text = readEnglish(text, report);
  text = readWeak(text, clause.question, report);
  return readNegatedLeftover(text, clause.question, report);
}

const EN_UNITS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 });
/** "twenty", "twenty-five", "a hundred and fifty" -> 20, 25, 150. */
function englishNumber(text) {
  let total = 0, current = 0, seen = false;
  for (const word of String(text).toLowerCase().split(/[\s-]+/).filter(Boolean)) {
    if (word === 'and') continue;
    if (word === 'a') { current = current || 1; continue; }
    if (Object.hasOwn(EN_UNITS, word)) { current += EN_UNITS[word]; seen = true; }
    else if (word === 'hundred') { total += (current || 1) * 100; current = 0; seen = true; }
    else return null;
  }
  return seen ? total + current || null : null;
}
const budgetValue = (kind, text) => kind === 'chinese' ? chineseNumber(text) : kind === 'english' ? englishNumber(text) : numeric(text);

function chineseNumber(text) {
  const digits = { 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, current = 0, afterHundred = false;
  for (const char of text) {
    if (char === '零') { current = 0; afterHundred = false; }
    else if (char in digits) current = digits[char];
    else if (char === '十') { total += (current || 1) * 10; current = 0; afterHundred = false; }
    else if (char === '廿') { total += 20; current = 0; afterHundred = false; }
    else if (char === '卅') { total += 30; current = 0; afterHundred = false; }
    else if (char === '百') { total += (current || 1) * 100; current = 0; afterHundred = true; }
    else return null;
  }
  // Cantonese 百二 / 一百五 means 120 / 150; 一百零五 is 105.
  if (afterHundred && current) return total + current * 10;
  return total + current || null;
}

/**
 * Small, transparent phrase parser; this is not generative AI or medical advice.
 * Explicit form fields remain the authoritative way to adjust the parsed request.
 */
export function parseRequest(text = '') {
  const request = typeof text === 'string' ? text.normalize('NFKC').trim().slice(0, 240) : '';
  const lower = clean(request);
  const result = {
    query: '', category: 'all', budget: null, allergens: [], store: 'all', origin: null,
    sort: 'relevance', notices: [], isRuleBased: true, allergyUnclear: false, unsupportedAllergens: [], unclearAllergyWords: [],
    avoidedFoods: [], otherRestrictions: [],
  };
  const report = {
    triggered: false, noAllergy: false, genericAllergy: false, listItems: [], exceptions: [], negationGuess: [], unclear: [], unsupported: [], sorts: [], other: [], avoidedFoods: [], genericNuts: false,
    add: id => { if (id && !result.allergens.includes(id)) result.allergens.push(id); },
  };
  // 無乳糖 (lactose-free) asks for a kind of milk drink; it is not plain "without milk". Non-dairy milk avoids milk.
  const lactoseFree = testPattern(LACTOSE_FREE, lower);
  const nonDairy = testPattern(NON_DAIRY_MILK, lower);
  // Coeliac disease names gluten even without an allergy word (I'm coeliac / 乳糜瀉).
  const coeliac = testPattern(COELIAC, lower);
  if (coeliac) { report.add('gluten'); report.triggered = true; }
  // 無殼花生 / peanuts without shells describe the food, not an allergy.
  const scan = lower.replace(/(?:無|冇|去|唔要|不要)殼|without\s+(?:the\s+)?shells?(?![a-z])|shell(?:ed|-less|less)(?![a-z])/giu, ' ').replace(LACTOSE_FREE, ` ${LACTOSE_TOKEN} `).replace(NON_DAIRY_MILK, ' ').replace(COELIAC, ' ');
  let rest = clausesOf(scan).map(clause => readClause(clause, report)).join(' ， ');
  if (coeliac) result.notices.push('你提到乳糜瀉：已避開含麩質穀物；網站只睇標籤聲明，請仍然睇清楚包裝。');
  if (nonDairy) { report.add('milk'); result.notices.push('非奶類奶（例如燕麥、豆、杏仁飲品）：已避開奶類，可以試吓搜「燕麥」或者「soy」。'); }
  if (report.genericNuts) {
    report.add('peanuts'); report.add('tree-nuts');
    result.notices.push('你寫咗「堅果」：日常講法可能包括花生，所以已同時避開花生同木本堅果；如果只需要避開其中一類，可以喺篩選取消。');
  }
  if (/shellfish|海鮮|seafood|貝/iu.test(scan) && result.allergens.some(id => id === 'crustaceans' || id === 'fish')) report.unsupported.push('軟體貝類');
  result.allergens.sort((a, b) => ALLERGENS.indexOf(a) - ALLERGENS.indexOf(b));
  result.unsupportedAllergens = [...new Set(report.unsupported)];
  if (result.unsupportedAllergens.length) result.notices.push(`網站篩唔到${result.unsupportedAllergens.join('、')}；請自己睇清楚包裝上嘅成分同警告。`);
  if (result.allergens.includes('milk') && /乳糖|lactose/iu.test(scan)) {
    result.notices.push('已當作避開奶類：無乳糖奶仍然含有奶類蛋白。如果你只係乳糖不耐，可以取消奶類篩選再搜「無乳糖」。');
  }
  result.unclearAllergyWords = [...new Set(report.unclear)];
  if (result.unclearAllergyWords.length) {
    result.allergyUnclear = true;
    result.notices.push(`你提到要避開「${result.unclearAllergyWords.join('、')}」，但網站認唔到係邊類過敏原；請喺篩選親手剔選（網站唔會自己估），亦唔會拎佢嚟搜尋。`);
    const listItems = [...new Set(report.listItems)];
    if (listItems.length) result.notices.push(`如果「${listItems.join('、')}」其實係牌子或者想買嘅食物，可以喺搜尋欄自己輸入。`);
  }
  if (report.genericAllergy && !result.allergyUnclear) {
    result.allergyUnclear = true;
    result.notices.push('你提到食物過敏，但冇講係邊種；請喺篩選親手剔選要避開嘅過敏原（網站唔會自己估）。');
  }
  const guessed = [...new Set(report.negationGuess)].filter(id => result.allergens.includes(id));
  if (guessed.length) result.notices.push(`句子有「唔／冇／not」之類嘅字，網站唔肯定你嘅意思，所以已當作避開${guessed.map(id => ALLERGEN_NAMES[id]).join('、')}；如果你其實想搵佢，請撳條件旁邊嘅 × 取消。`);
  const exceptions = [...new Set(report.exceptions)];
  if (exceptions.length) result.notices.push(`「${exceptions.join('、')}」當作可以食，冇加入過敏篩選；網站唔會因此取消其他篩選。`);
  result.otherRestrictions = [...new Set(report.other)];
  if (result.otherRestrictions.length) result.notices.push(`「${result.otherRestrictions.join('、')}」唔係包裝標籤上嘅過敏原，網站篩唔到；請自己睇成分。`);
  result.avoidedFoods = [...new Set(report.avoidedFoods)];
  if (result.avoidedFoods.length) result.notices.push(`網站唔可以排除指定食物（${result.avoidedFoods.join('、')}），所以冇拎佢嚟搜尋；請自己睇產品名稱。`);

  const sorts = [];
  for (const sort of report.sorts) if (!sorts.includes(sort)) sorts.push(sort);
  if (sorts.some(sort => sort !== 'price-asc')) result.notices.push('糖、鹽同碳水唔係過敏原：已改為由低至高排序，請自己睇每款嘅數字。');
  for (const [pattern, kind] of [...CURRENCY_BUDGETS, [EN_CURRENCY_BUDGET, 'english']]) {
    const match = rest.match(pattern);
    if (!match) continue;
    const value = budgetValue(kind, match[1]);
    if (value !== null) { result.budget = value; rest = rest.replace(match[0], ' '); break; }
  }
  let limited = false;
  for (const [sort, pattern] of NUTRIENT_LIMITS) {
    if (testPattern(pattern, rest)) { limited = true; if (!sorts.includes(sort)) sorts.push(sort); rest = rest.replace(pattern, ' '); }
  }
  if (limited) result.notices.push('網站暫時唔可以設定營養上限，已改為由低至高排序；請自己睇每款嘅數字。');
  if (result.budget === null) {
    for (const [pattern, kind] of KEYWORD_BUDGETS) {
      const match = rest.match(pattern);
      if (!match) continue;
      const value = budgetValue(kind, match[1]);
      if (value !== null) { result.budget = value; rest = rest.replace(match[0], ' '); break; }
    }
  }
  for (const [store, pattern] of STORE_CUES) {
    if (result.store === 'all' && testPattern(pattern, rest)) result.store = store;
    rest = rest.replace(pattern, ' ');
  }
  for (const [sort, pattern] of SORT_CUES) {
    if (testPattern(pattern, rest) && !sorts.includes(sort)) sorts.push(sort);
    rest = rest.replace(pattern, ' ');
  }
  if (sorts.length) result.sort = sorts[0];
  if (sorts.length > 1) result.notices.push(`你提到多於一個排序要求；網站一次只用一個，已用「${SORT_LABELS[sorts[0]]}」，可以喺「排序」再改。`);
  const hasBiscuitWord = BISCUIT_CUE.test(rest);
  let foodCategory = null;
  if (lactoseFree && rest.includes(LACTOSE_TOKEN)) { result.query = '無乳糖'; foodCategory = 'drinks'; }
  rest = rest.replaceAll(LACTOSE_TOKEN, ' ');
  for (const [pattern, query, category] of FOOD_CUES) {
    if (testPattern(pattern, rest) && !result.query) { result.query = query; foodCategory = category; }
    rest = rest.replace(pattern, ' ');
  }
  if (hasBiscuitWord) result.category = 'biscuits';
  else if (foodCategory) result.category = foodCategory;
  else {
    const category = CATEGORY_CUES.find(([, pattern]) => testPattern(pattern, rest));
    if (category) result.category = category[0];
    else if (nonDairy) result.category = 'drinks';
  }
  for (const [, pattern] of CATEGORY_CUES) rest = rest.replace(pattern, ' ');
  rest = rest.replace(new RegExp(BISCUIT_CUE.source, 'giu'), ' ');
  if (/藥|药|medicine|medication|insulin|胰島素|胰岛素|安全食|safe\s*to\s*eat|適合.*糖尿|适合.*糖尿|diabet/i.test(lower)) {
    result.notices.push('此工具只比較標籤及價格，不能判斷藥物相容性、個人安全食量或整日飲食是否合適。');
  }
  // Leftover words (often a brand such as 嘉頓) become the search only when no food word was recognised and
  // nothing in them still looks like allergy wording.
  const leftover = rest.replace(CONTEXT_WORDS, ' ').replace(FILLER_WORDS, ' ')
    .replace(/\d+\s*(?:包|件|個|盒|罐|支|樽|袋|片|粒)/gu, ' ')
    .replace(/(?:預算|预算|budget|唔好超過|唔超過|不超過|超過|少於|低於|以下|以內|以内|蚊|元|港元|hkd|\$|食|飲|買|要)/giu, ' ')
    .replace(/[\d\s\p{P}\p{S}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const meaningful = /[㐀-鿿]{2,}|[a-z]{3,}/iu.test(leftover) && leftover.split(' ').length <= 2;
  const medical = /藥|药|medicine|medication|insulin|胰島素|胰岛素/iu.test(lower);
  const allergyLeft = /過敏|过敏|敏感|allerg|不耐|intoleran/iu.test(leftover) || (report.triggered && testPattern(ALIAS_ANY, leftover));
  // A sentence that only made sense as a refusal ("花生對我嚟講好危險") never searches what is left of it.
  const refusalLeft = report.negationGuess.length > 0;
  if (!result.query && meaningful && !medical && !allergyLeft && !refusalLeft) result.query = leftover.slice(0, 30);
  // A sentence that clearly talks about an allergy but names nothing the site can use is flagged, never searched.
  const talksAboutAllergy = /過敏|过敏|allerg|anaphyla|不耐受|intoleran/iu.test(lower);
  if (talksAboutAllergy && !report.noAllergy && !result.allergens.length && !result.unsupportedAllergens.length && !result.allergyUnclear) {
    result.allergyUnclear = true;
    if (testPattern(ALIAS_ANY, result.query)) result.query = '';
    result.notices.push('你提到過敏，但系統認唔到係邊種；請喺篩選親手剔選要避開嘅過敏原（網站唔會自己估）。');
  }
  result.notices.push('以固定關鍵字解讀，並非 AI；請核對已填入的搜尋及篩選條件。');
  return result;
}
