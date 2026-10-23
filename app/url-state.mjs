/**
 * NutriCompare HK: shareable, validated filter links.
 * The EdUHK MaaS AI assistant (and test scripts) hand conditions to the site through these links.
 * Every value is checked against a fixed list; anything unknown is reported and ignored, never guessed.
 * A link can only add allergy exclusions. It can never weaken the deterministic allergy exclusion.
 */
import { ALLERGENS, parseRequest, readAllergenPhrase } from './engine.mjs?v=20261023-v17c';

export const CATEGORY_IDS = Object.freeze(['biscuits', 'snacks', 'drinks', 'bakery', 'dairy', 'pantry', 'meals']);
export const SORT_IDS = Object.freeze(['relevance', 'price-asc', 'carbs-asc', 'sugar-asc', 'sodium-asc', 'protein-desc']);
export const DATA_SCOPES = Object.freeze(['nutrition', 'hk-nutrition', 'comparable', 'hk-label']);
const LIBRARY_SCOPES = new Map([['priced', 'priced'], ['off-library', 'off-library'], ['all', '']]);

/** Parameter names, plus the spellings an AI or a person may use instead. Matching ignores letter case. */
const KEY_ALIASES = new Map([
  ['q', 'q'], ['query', 'q'], ['search', 'q'], ['keyword', 'q'], ['food', 'q'],
  ['cat', 'cat'], ['category', 'cat'],
  ['budget', 'budget'], ['max', 'budget'], ['maxprice', 'budget'], ['price', 'budget'],
  ['store', 'store'], ['shop', 'store'], ['merchant', 'store'], ['supermarket', 'store'],
  ['avoid', 'avoid'], ['allergens', 'avoid'], ['allergen', 'avoid'], ['allergy', 'avoid'], ['allergies', 'avoid'],
  ['exclude', 'avoid'], ['excludes', 'avoid'], ['without', 'avoid'], ['free', 'avoid'],
  ['sort', 'sort'], ['order', 'sort'], ['sortby', 'sort'],
  ['data', 'data'], ['lib', 'lib'], ['library', 'lib'], ['src', 'src'], ['source', 'src'],
]);
const KEY_LABELS = Object.freeze({ cat: '分類', budget: '預算', store: '商戶', sort: '排序', data: '資料範圍', lib: '資料庫', src: '來源' });

/** Small spelling differences an AI may produce; anything else is still rejected. */
const CATEGORY_ALIASES = new Map([
  ['biscuit', 'biscuits'], ['餅乾', 'biscuits'], ['餅', 'biscuits'], ['snack', 'snacks'], ['小食', 'snacks'], ['零食', 'snacks'],
  ['drink', 'drinks'], ['beverages', 'drinks'], ['飲品', 'drinks'], ['bread', 'bakery'], ['麵包', 'bakery'], ['蛋糕', 'bakery'],
  ['奶', 'dairy'], ['乳製品', 'dairy'], ['蛋', 'dairy'], ['糧油', 'pantry'], ['調味', 'pantry'], ['罐頭', 'pantry'],
  ['noodles', 'meals'], ['麵食', 'meals'],
]);
const STORE_ALIASES = new Map([
  ['百佳', 'PARKNSHOP'], ['PARK N SHOP', 'PARKNSHOP'], ["PARK'N SHOP", 'PARKNSHOP'], ['PNS', 'PARKNSHOP'], ['惠康', 'WELLCOME'],
  ['MARKET PLACE', 'JASONS'], ['MARKETPLACE', 'JASONS'], ['吉之島', 'AEON'],
]);
const SORT_ALIASES = new Map([
  ['sugar', 'sugar-asc'], ['low-sugar', 'sugar-asc'], ['carbs', 'carbs-asc'], ['low-carb', 'carbs-asc'], ['sodium', 'sodium-asc'],
  ['salt', 'sodium-asc'], ['low-sodium', 'sodium-asc'], ['protein', 'protein-desc'], ['price', 'price-asc'], ['cheap', 'price-asc'],
]);
const ALLERGEN_LABELS = Object.freeze({ gluten: '含麩質穀物', crustaceans: '甲殼類', eggs: '蛋類', fish: '魚類', peanuts: '花生', soy: '大豆', milk: '奶類', 'tree-nuts': '木本堅果', sesame: '芝麻', sulphites: '亞硫酸鹽' });
/** Everyday "shellfish / seafood" also covers molluscs (oysters, scallops, squid), which the label filter cannot cover. */
const SHELLFISH_WORDS = /shellfish|seafood|海鮮|貝/iu;
const MOLLUSC_NOTE = '「shellfish／海鮮」只會篩甲殼類同魚類；軟體貝類（例如蠔、帶子、魷魚）要自己睇包裝。';

function cleanText(value, max = 60) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
const shown = value => { const text = cleanText(value, 200); return text.length > 24 ? `${text.slice(0, 24)}…` : text; };

/**
 * Reads ?q=&cat=&budget=&store=&avoid=&sort=&data=&lib=&src= into the app's filter shape.
 * ignoredAllergens are avoid words the site could not recognise; unsupportedAllergens are allergies it recognises but cannot filter.
 * @returns {{present:boolean, source:'ai'|'link'|null, filters:object, applied:string[], ignored:string[], ignoredAllergens:string[], unsupportedAllergens:string[], notes:string[]}}
 */
export function filtersFromParams(input, { storeIds = [], base = {} } = {}) {
  const raw = input instanceof URLSearchParams ? input : new URLSearchParams(String(input ?? ''));
  const values = new Map();
  const unknownKeys = [];
  for (const [name, value] of raw) {
    const key = KEY_ALIASES.get(name.trim().toLowerCase());
    if (!key) { unknownKeys.push(name); continue; }
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  const first = key => values.get(key)?.[0] ?? '';
  const present = [...values.keys()].some(key => key !== 'src') || unknownKeys.length > 0;
  const filters = { ...base, allergens: [...(base.allergens ?? [])] };
  const applied = [];
  const ignored = unknownKeys.map(name => `參數「${shown(name)}」`);
  const ignoredAllergens = [];
  const unsupportedAllergens = [];
  const notes = [];
  if (!present) return { present: false, source: null, filters, applied, ignored, ignoredAllergens, unsupportedAllergens, notes };
  const source = /^(?:ai|maas)$/i.test(first('src')) ? 'ai' : 'link';
  const addAllergen = id => { if (!filters.allergens.includes(id)) filters.allergens.push(id); };
  // Single-value parameters use the first value; a different repeated value is reported, never silently dropped.
  for (const [key, label] of Object.entries(KEY_LABELS)) {
    const list = (values.get(key) ?? []).map(value => cleanText(value).toLowerCase());
    if (new Set(list).size > 1) notes.push(`連結有多於一個${label}，只用第一個「${shown(values.get(key)[0])}」。`);
  }

  // English food words from the AI ("instant noodles", "soy milk") become the site's precise search words (即食麵, soy).
  // A link copied from the site keeps the exact words the person typed. Allergy wording inside any q is never dropped.
  const queries = (values.get('q') ?? []).map(value => cleanText(value)).filter(Boolean);
  let impliedCategory = '';
  if (queries.length) {
    if (source === 'ai') {
      const parsedList = queries.map(query => ({ query, parsed: parseRequest(query) }));
      const named = new Set();
      for (const [index, { query, parsed }] of parsedList.entries()) {
        const allergyWords = parsed.allergens.length || parsed.unsupportedAllergens.length || parsed.allergyUnclear || parsed.avoidedFoods.length || parsed.otherRestrictions.length;
        // Raw words are kept as the search only when they carry no allergy or "without" wording ("bread", "wafer").
        const search = parsed.query || (allergyWords ? '' : query);
        if (index === 0 || !filters.query) filters.query = search || filters.query || '';
        if (!impliedCategory && parsed.category && parsed.category !== 'all') impliedCategory = parsed.category;
        parsed.allergens.forEach(id => { addAllergen(id); named.add(id); });
        unsupportedAllergens.push(...parsed.unsupportedAllergens);
        if (parsed.allergyUnclear) notes.push(parsed.unclearAllergyWords.length
          ? `搜尋字詞提到要避開「${parsed.unclearAllergyWords.join('、')}」，網站認唔到係邊類過敏原；請喺篩選親手揀。`
          : '搜尋字詞提到過敏，但認唔到係邊種；請喺篩選親手揀。');
        if (parsed.avoidedFoods.length) notes.push(`搜尋字詞話唔要「${parsed.avoidedFoods.join('、')}」：網站唔可以排除指定食物，冇拎佢嚟搜尋。`);
        if (parsed.otherRestrictions.length) notes.push(`「${parsed.otherRestrictions.join('、')}」唔係標籤過敏原，網站篩唔到。`);
      }
      if (named.size) notes.push(`搜尋字詞入面提到要避開${[...named].sort((a, b) => ALLERGENS.indexOf(a) - ALLERGENS.indexOf(b)).map(id => ALLERGEN_LABELS[id]).join('、')}，已經加入過敏條件。`);
      if (queries.length > 1) notes.push(`連結有 ${queries.length} 個搜尋字詞（q）：只用一個做搜尋，其餘只用嚟讀過敏條件。`);
    } else {
      filters.query = queries[0];
      if (queries.length > 1) notes.push(`連結有多於一個搜尋字詞，只用第一個「${shown(queries[0])}」；冇用「${queries.slice(1).map(shown).join('、')}」。`);
    }
    applied.push('q');
  }

  const categoryText = cleanText(first('cat'), 20).toLowerCase();
  const category = CATEGORY_ALIASES.get(categoryText) ?? (categoryText || impliedCategory);
  if (category) {
    if (CATEGORY_IDS.includes(category)) { filters.category = category; applied.push('cat'); } else ignored.push(`分類「${shown(category)}」`);
  }

  const budgetText = cleanText(first('budget'), 12).replace(/^(?:hk)?\$/i, '');
  if (budgetText) {
    const budget = Number(budgetText);
    if (/^\d{1,5}(?:\.\d{1,2})?$/.test(budgetText) && budget <= 10000) { filters.budget = budget; applied.push('budget'); }
    else ignored.push(`預算「${shown(budgetText)}」`);
  }

  const storeText = cleanText(first('store'), 20).toUpperCase();
  const store = STORE_ALIASES.get(storeText) ?? storeText;
  if (store) {
    if (storeIds.includes(store)) { filters.store = store; applied.push('store'); } else ignored.push(`商戶「${shown(store)}」`);
  }

  // Every avoid value counts, including repeated ?avoid=…&avoid=… parameters.
  const avoidValues = values.get('avoid') ?? [];
  const avoidParts = avoidValues.flatMap(value => cleanText(value, 200).split(/[,，、|/;；]+/)).map(part => part.trim()).filter(Boolean);
  for (const part of avoidParts) {
    // The engine's alias table is used, so the page labels (蛋類, 含麩質穀物) and words like 牛奶製品 or "tree nuts" all work.
    const read = readAllergenPhrase(part);
    read.ids.forEach(addAllergen);
    unsupportedAllergens.push(...read.unsupported);
    ignoredAllergens.push(...read.unknown.map(shown));
    if (read.generic) notes.push(`「${shown(part)}」已同時避開花生同木本堅果。`);
  }
  if (avoidValues.some(value => !cleanText(value))) notes.push('連結有一個空白嘅過敏條件，已略過。');
  const shellfishWords = [...avoidParts, ...(source === 'ai' ? queries : [])].some(text => SHELLFISH_WORDS.test(text));
  if (shellfishWords && filters.allergens.some(id => id === 'crustaceans' || id === 'fish')) {
    unsupportedAllergens.push('軟體貝類');
    notes.push(MOLLUSC_NOTE);
  }
  filters.allergens.sort((a, b) => ALLERGENS.indexOf(a) - ALLERGENS.indexOf(b));
  if (filters.allergens.length) applied.push('avoid');

  const sortText = cleanText(first('sort'), 20).toLowerCase();
  const sort = SORT_ALIASES.get(sortText) ?? sortText;
  if (sort) {
    if (SORT_IDS.includes(sort)) { filters.sort = sort; applied.push('sort'); } else ignored.push(`排序「${shown(sort)}」`);
  }

  const data = cleanText(first('data'), 20).toLowerCase();
  if (data) {
    if (DATA_SCOPES.includes(data)) { filters.dataScope = data; applied.push('data'); } else ignored.push(`資料範圍「${shown(data)}」`);
  }

  const library = cleanText(first('lib'), 20).toLowerCase();
  if (library) {
    if (LIBRARY_SCOPES.has(library)) { filters.libraryScope = LIBRARY_SCOPES.get(library); applied.push('lib'); }
    else ignored.push(`資料庫「${shown(library)}」`);
  }

  return {
    present: true, source, filters, applied, ignored,
    ignoredAllergens: [...new Set(ignoredAllergens)], unsupportedAllergens: [...new Set(unsupportedAllergens)], notes: [...new Set(notes)],
  };
}

/** The shortest link that reproduces the current filters (defaults are left out). */
export function paramsFromFilters(filters = {}) {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', cleanText(filters.query));
  if (filters.category && CATEGORY_IDS.includes(filters.category)) params.set('cat', filters.category);
  if (filters.budget !== null && filters.budget !== undefined && Number.isFinite(Number(filters.budget))) params.set('budget', String(Math.round(Number(filters.budget) * 100) / 100));
  if (filters.store) params.set('store', filters.store);
  if (Array.isArray(filters.allergens) && filters.allergens.length) params.set('avoid', filters.allergens.join(','));
  if (filters.sort && filters.sort !== 'relevance' && SORT_IDS.includes(filters.sort)) params.set('sort', filters.sort);
  if (filters.dataScope && DATA_SCOPES.includes(filters.dataScope)) params.set('data', filters.dataScope);
  if (filters.libraryScope !== undefined && filters.libraryScope !== 'priced') params.set('lib', filters.libraryScope === '' ? 'all' : filters.libraryScope);
  return params.toString();
}
