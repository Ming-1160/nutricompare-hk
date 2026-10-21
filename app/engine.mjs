/** NutriCompare HK: deterministic search, conservative filters and label arithmetic. */

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
  'tree-nuts': ['tree-nuts', 'tree nuts', 'nuts', 'almond', 'almonds', 'hazelnut', 'hazelnuts', 'walnut', 'walnuts', 'cashew', 'cashews', 'pecan', 'pecans', 'pistachio', 'pistachios', 'macadamia', 'brazil nut', 'brazil nuts', '木本堅果', '堅果', '杏仁', '榛子', '核桃', '腰果', '碧根果', '開心果', '夏威夷果'],
  sesame: ['sesame', 'sesame seed', 'sesame seeds', '芝麻', '芝蔴'],
  sulphites: ['sulphites', 'sulfites', 'sulphite', 'sulfite', 'sulphur dioxide', 'sulfur dioxide', '亞硫酸鹽', '二氧化硫'],
};

const NUTRIENTS = Object.freeze([
  'energyKcal', 'carbohydrates', 'sugars', 'fat', 'saturatedFat', 'protein', 'fibre', 'sodiumMg',
]);

function clean(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en').normalize('NFKC') : '';
}

function searchText(value) {
  return clean(value)
    .replace(/朱古力/g, '巧克力')
    .replace(/餅乾|饼干|餅干/g, '餅')
    .replace(/花生醬/g, '花生')
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

function searchableProduct(product) {
  const brand = typeof product.brand === 'object'
    ? Object.values(product.brand ?? {}).join(' ')
    : product.brand;
  return searchText([
    product.nameZh, product.nameEn, brand, product.brandEn, product.brandZh, product.category, product.packSize,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].filter(Boolean).join(' '));
}

function matchesQuery(product, query) {
  const tokens = searchText(query).split(' ').filter(Boolean);
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
  if (amount === 0 || !basisUnit || !sourceAmount) amount = null;
  const factor = amount === null || !sourceAmount ? null : amount / sourceAmount;
  const values = Object.fromEntries(NUTRIENTS.map(key => {
    const value = numeric(nutrition[key]);
    return [key, factor === null || value === null ? null : Math.round(value * factor * 10000) / 10000];
  }));
  return { ...values, basisUnit, basisAmount: amount, amount, basis: basis === 'portion' ? 'portion' : '100' };
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
  const nutritionSort = {
    'carbs-asc': ['carbohydrates', false],
    'sugar-asc': ['sugars', false],
    'protein-desc': ['protein', true],
  }[filters.sort];
  if (nutritionSort) {
    const units = new Set(filtered.map(product => product.nutrition?.basisUnit).filter(unit => ['g', 'ml'].includes(unit)));
    // Mixed 100g and 100ml values cannot be treated as a like-for-like ranking.
    if (units.size > 1) return filtered;
    const [key, descending] = nutritionSort;
    return filtered.sort((a, b) => compareNullable(nutritionFor(a)[key], nutritionFor(b)[key], descending));
  }
  return filtered;
}

/**
 * Small, transparent phrase parser; this is not generative AI or medical advice.
 * Explicit form fields remain the authoritative way to adjust the parsed request.
 */
export function parseRequest(text = '') {
  const request = typeof text === 'string' ? text.normalize('NFKC').trim() : '';
  const lower = clean(request);
  const result = {
    query: '', category: 'all', budget: null, allergens: [], store: 'all', origin: null,
    sort: 'relevance', notices: [], isRuleBased: true,
  };
  const explicitBudget = lower.match(/(?:預算|budget|不超過|最多|under|below|up to|少於|以下|hk\$|hkd|\$)\s*[:：]?\s*(\d+(?:\.\d{1,2})?)/i)
    ?? lower.match(/(\d+(?:\.\d{1,2})?)\s*(?:蚊|元|港元|hkd|dollars?)(?:\s*(?:以下|以內|內))?/i);
  if (explicitBudget) result.budget = numeric(explicitBudget[1]);
  if (/百佳|parknshop|park.?n.?shop|\bpns\b/i.test(lower)) result.store = 'PARKNSHOP';
  else if (/惠康|wellcome/i.test(lower)) result.store = 'WELLCOME';
  else if (/market\s*place|jasons/i.test(lower)) result.store = 'JASONS';
  else if (/aeon|吉之島/i.test(lower)) result.store = 'AEON';
  if (/餅|饼|biscuits?|crackers?|cookies?/i.test(lower)) result.category = 'biscuits';
  else if (/飲品|飲料|飲|喝|drinks?|beverages?|豆奶|牛奶|coffee|咖啡|soy.?milk/i.test(lower)) result.category = 'drinks';
  else if (/零食|小食|snacks?/i.test(lower)) result.category = 'snacks';
  if (/夾心|夹心|忌廉|奶油|cream|sandwich/i.test(lower)) result.query = '夾心';
  else if (/朱古力|巧克力|chocolate/i.test(lower)) result.query = '巧克力';
  else if (/黑咖啡|black\s*coffee/i.test(lower)) result.query = 'black coffee';
  else if (/咖啡|coffee/i.test(lower)) result.query = 'coffee';
  else if (/豆奶|豆漿|豆浆|soy.?milk|soya.?milk/i.test(lower)) result.query = 'soy';
  // Only clear exclusion/allergy phrases alter safety filters; 'milk chocolate' does not.
  for (const id of ALLERGENS) {
    const aliases = ALLERGEN_ALIASES[id].filter(alias => alias.length > 1 || /[\u3400-\u9fff]/u.test(alias));
    const escaped = aliases.map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const allergy = new RegExp(`(?:(?:對|对)\\s*(?:${escaped})[^，。,.;；]{0,10}(?:敏感|過敏|过敏)|(?:${escaped})\\s*(?:allerg(?:y|ic)|過敏|过敏|敏感)|(?:allerg(?:y|ic)\\s*(?:to)?|無|无|不含|避開|避开|不要|no|without|avoid|free\\s*from)\\s*(?:${escaped})|(?:${escaped})[- ]free)`, 'i');
    if (allergy.test(lower)) result.allergens.push(id);
  }
  if (/低糖|少糖|less\s*sugar|low\s*sugar/i.test(lower)) result.sort = 'sugar-asc';
  else if (/低碳水|少碳水|low\s*carb/i.test(lower)) result.sort = 'carbs-asc';
  else if (/高蛋白|high\s*protein/i.test(lower)) result.sort = 'protein-desc';
  else if (/最平|便宜|cheap|lowest\s*price/i.test(lower)) result.sort = 'price-asc';
  if (/藥|药|medicine|medication|insulin|胰島素|胰岛素|安全食|safe\s*to\s*eat|適合.*糖尿|适合.*糖尿|diabet/i.test(lower)) {
    result.notices.push('此工具只比較標籤及價格，不能判斷藥物相容性、個人安全食量或整日飲食是否合適。');
  }
  if (!result.query && result.category === 'all' && !result.allergens.length && result.budget === null && result.store === 'all') {
    result.query = request;
  }
  result.notices.push('以固定關鍵字解讀，並非 AI；請核對已填入的搜尋及篩選條件。');
  return result;
}
