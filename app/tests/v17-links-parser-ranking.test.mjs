import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts, parseRequest, rankingGroups } from '../engine.mjs';
import { filtersFromParams, paramsFromFilters } from '../url-state.mjs';

const base = () => ({ query: '', category: '', budget: null, store: '', allergens: [], origin: '', sort: 'relevance', dataScope: '', libraryScope: 'priced' });
const STORES = ['PARKNSHOP', 'WELLCOME', 'JASONS', 'AEON'];
const item = (id, unit, values = {}, extra = {}) => ({
  id, nameZh: id, category: 'drinks', prices: [{ store: 'WELLCOME', price: 10 }],
  nutrition: { basisUnit: unit, basisAmount: 100, carbohydrates: null, sugars: null, sodiumMg: null, protein: null, ...values },
  allergens: { status: 'unknown', contains: [], mayContain: [] }, ...extra,
});

test('AI/shared links apply only validated values and report what was ignored', () => {
  const state = filtersFromParams('?q=%E5%8D%B3%E9%A3%9F%E9%BA%B5&cat=meals&budget=20&store=wellcome&avoid=peanut,milk,mustard&sort=sodium-asc&src=ai', { storeIds: STORES, base: base() });
  assert.equal(state.present, true);
  assert.equal(state.source, 'ai');
  assert.equal(state.filters.query, '即食麵');
  assert.equal(state.filters.category, 'meals');
  assert.equal(state.filters.budget, 20);
  assert.equal(state.filters.store, 'WELLCOME');
  assert.deepEqual(state.filters.allergens, ['peanuts', 'milk']);
  assert.equal(state.filters.sort, 'sodium-asc');
  assert.deepEqual(state.unsupportedAllergens, ['芥末'], 'an allergy the site cannot filter is reported, never silently dropped');
  assert.deepEqual(state.ignoredAllergens, [], 'a known allergy is not misdescribed as an unrecognised word');
});

test('English food words in an AI link become the precise site search word; copied links keep typed words', () => {
  const read = (q, src = 'ai') => filtersFromParams(`?q=${encodeURIComponent(q)}${src ? `&src=${src}` : ''}`, { storeIds: STORES, base: base() }).filters.query;
  assert.equal(read('instant noodles'), '即食麵');
  assert.equal(read('soy milk'), 'soy');
  assert.equal(read('Garden'), 'garden');
  assert.equal(read('peanut butter'), 'peanut butter');
  assert.equal(read('朱古力餅', ''), '朱古力餅');
  const soy = filtersFromParams('?q=soy%20milk&src=ai', { storeIds: STORES, base: base() }).filters;
  assert.equal(soy.category, 'drinks', 'soy milk must not pull in soy sauce');
  const explicit = filtersFromParams('?q=soy%20milk&cat=dairy&src=ai', { storeIds: STORES, base: base() }).filters;
  assert.equal(explicit.category, 'dairy', 'an explicit category in the link wins');
});

test('common AI spelling variants for category, store and sort are accepted', () => {
  const state = filtersFromParams('?cat=%E9%A3%B2%E5%93%81&store=%E6%83%A0%E5%BA%B7&sort=low-sugar&src=ai', { storeIds: STORES, base: base() });
  assert.equal(state.filters.category, 'drinks');
  assert.equal(state.filters.store, 'WELLCOME');
  assert.equal(state.filters.sort, 'sugar-asc');
  assert.deepEqual(state.ignored, []);
});

test('invalid link values are ignored instead of guessed', () => {
  const state = filtersFromParams('?cat=sweets&budget=-5&store=SEVEN&sort=healthiest&data=everything&lib=secret', { storeIds: STORES, base: base() });
  assert.equal(state.present, true);
  assert.deepEqual({ ...state.filters }, { ...base(), allergens: [] });
  assert.equal(state.ignored.length, 6);
  assert.equal(filtersFromParams('?src=ai', { storeIds: STORES, base: base() }).present, false, 'src alone carries no conditions');
  assert.equal(filtersFromParams('?budget=1e3', { storeIds: STORES, base: base() }).filters.budget, null);
  assert.equal(filtersFromParams('?budget=20000', { storeIds: STORES, base: base() }).filters.budget, null);
});

test('link text is cleaned, capped and cannot inject markup', () => {
  const state = filtersFromParams(`?q=${encodeURIComponent('<img src=x onerror=alert(1)>' + 'x'.repeat(100))}`, { storeIds: STORES, base: base() });
  assert.ok(!state.filters.query.includes('<'));
  assert.ok(state.filters.query.length <= 60);
});

test('a link only adds allergy exclusions; it never removes an existing one', () => {
  const start = { ...base(), allergens: ['sesame'] };
  const state = filtersFromParams('?avoid=peanuts', { storeIds: STORES, base: start });
  assert.deepEqual(state.filters.allergens, ['peanuts', 'sesame']);
});

test('current filters round-trip through a shareable link', () => {
  const filters = { ...base(), query: '夾心', category: 'biscuits', budget: 20, store: 'AEON', allergens: ['peanuts', 'sesame'], sort: 'sugar-asc', dataScope: 'hk-label', libraryScope: '' };
  const link = paramsFromFilters(filters);
  const back = filtersFromParams(link, { storeIds: STORES, base: base() }).filters;
  assert.deepEqual(back, filters);
  assert.equal(paramsFromFilters(base()), '', 'defaults produce an empty query string');
});

test('mixed 100ml and 100g values are ranked in separate blocks, unknown values last', () => {
  const products = [
    item('g-high', 'g', { sugars: 30 }, { category: 'drinks' }),
    item('ml-mid', 'ml', { sugars: 5 }),
    item('unknown-ml', 'ml'),
    item('ml-zero', 'ml', { sugars: 0 }),
    item('g-low', 'g', { sugars: 1 }),
    item('ml-high', 'ml', { sugars: 11 }),
    item('no-unit', null, { sugars: 0 }),
  ];
  assert.deepEqual(filterProducts(products, { sort: 'sugar-asc' }).map(p => p.id),
    ['ml-zero', 'ml-mid', 'ml-high', 'g-low', 'g-high', 'unknown-ml', 'no-unit']);
  assert.deepEqual(rankingGroups(products, 'sugar-asc'), [{ unit: 'ml', count: 3 }, { unit: 'g', count: 2 }]);
  assert.deepEqual(rankingGroups(products, 'relevance'), []);
});

test('sodium can be ranked from low to high', () => {
  const products = [item('salty', 'g', { sodiumMg: 900 }), item('mild', 'g', { sodiumMg: 300 }), item('unknown', 'g')];
  assert.deepEqual(filterProducts(products, { sort: 'sodium-asc' }).map(p => p.id), ['mild', 'salty', 'unknown']);
});

test('"cream crackers" and "ice cream" categories no longer match a 夾心 (filled biscuit) search', () => {
  const sandwich = { id: 'sandwich', nameZh: '檸檬夾心餅', tags: ['夾心餅 / 餡餅', 'Sandwich crackers'], prices: [] };
  const cracker = { id: 'cracker', nameZh: '梳打餅', tags: ['梳打餅 / 克力架', 'Saltine crackers / Soda crackers / Cream crackers'], prices: [] };
  const iceCream = { id: 'ice', nameZh: '雪糕杯', tags: ['冰凍甜點', 'Ice cream'], prices: [] };
  assert.deepEqual(filterProducts([sandwich, cracker, iceCream], { query: '夾心' }).map(p => p.id), ['sandwich']);
  assert.deepEqual(filterProducts([sandwich, cracker, iceCream], { query: 'cream crackers' }).map(p => p.id), ['cracker']);
});

test('offline parser understands sodium, no-sugar, instant noodle and brand wording', () => {
  const noodles = parseRequest('惠康有冇低鹽即食麵');
  assert.equal(noodles.query, '即食麵');
  assert.equal(noodles.category, 'meals');
  assert.equal(noodles.sort, 'sodium-asc');
  assert.equal(noodles.store, 'WELLCOME');
  assert.equal(parseRequest('想飲豆奶，唔要糖').sort, 'sugar-asc');
  assert.equal(parseRequest('低糖飲品 20蚊以下').budget, 20);
  const brand = parseRequest('嘉頓 30蚊以下');
  assert.equal(brand.query, '嘉頓');
  assert.equal(brand.budget, 30);
  assert.equal(parseRequest('I want low sugar biscuits under $15 with no milk').query, '');
  assert.equal(parseRequest('cream crackers').query, '克力架');
});

test('allergy lists are read in full, and "有冇" (do you have) is never read as "without"', () => {
  assert.deepEqual(parseRequest('夾心餅 唔要芝麻 同 花生').allergens, ['peanuts', 'sesame']);
  assert.deepEqual(parseRequest('no peanuts or sesame cookies').allergens, ['peanuts', 'sesame']);
  assert.deepEqual(parseRequest('麩質同大豆都唔食得').allergens, ['gluten', 'soy']);
  assert.deepEqual(parseRequest('避開蛋同奶').allergens, ['eggs', 'milk']);
  assert.deepEqual(parseRequest('有冇花生醬？').allergens, []);
  assert.equal(parseRequest('有冇花生醬？').query, '花生醬');
  assert.deepEqual(parseRequest('peanuts allergy').allergens, ['peanuts'], 'peanuts must not also read as tree nuts');
  assert.deepEqual(parseRequest('對牛奶過敏，想搵零食').category, 'snacks', 'an allergy word does not pick the food category');
});

test('everyday "堅果 / nuts" wording avoids both peanuts and tree nuts and says so', () => {
  const parsed = parseRequest('我對堅果過敏');
  assert.deepEqual(parsed.allergens, ['peanuts', 'tree-nuts']);
  assert.ok(parsed.notices.some(notice => /同時避開花生同木本堅果/.test(notice)));
  assert.deepEqual(parseRequest('對杏仁過敏').allergens, ['tree-nuts'], 'a named tree nut does not add peanuts');
  assert.deepEqual(parseRequest('想食朱古力，但係對木本堅果敏感').allergens, ['tree-nuts']);
});

test('clinical wording never becomes a search term', () => {
  const parsed = parseRequest('我有糖尿病，正食藥，可以食幾多餅？');
  assert.equal(parsed.query, '');
  assert.match(parsed.notices[0], /不能判斷藥物相容性/);
});

// Safety regressions found in the independent review of v1.7 (each reproduced before the fix).
test('every repeated avoid parameter counts, and empty ones are reported', () => {
  const state = filtersFromParams('?avoid=peanuts&avoid=milk&q=chocolate&src=ai', { storeIds: STORES, base: base() });
  assert.deepEqual(state.filters.allergens, ['peanuts', 'milk']);
  const empty = filtersFromParams('?avoid=&avoid=milk', { storeIds: STORES, base: base() });
  assert.deepEqual(empty.filters.allergens, ['milk']);
  assert.ok(empty.notes.some(note => /空白/.test(note)));
});

test('allergy parameter spellings are accepted and unknown parameter names are reported', () => {
  for (const key of ['allergens', 'allergy', 'Avoid', 'EXCLUDE']) {
    assert.deepEqual(filtersFromParams(`?${key}=peanuts&src=ai`, { storeIds: STORES, base: base() }).filters.allergens, ['peanuts'], key);
  }
  const state = filtersFromParams('?q=milk&colour=red', { storeIds: STORES, base: base() });
  assert.ok(state.ignored.some(item => item.includes('colour')));
});

test('generic nuts in a link avoids peanuts and tree nuts; object keys are never allergens', () => {
  const nuts = filtersFromParams('?avoid=nuts&src=ai', { storeIds: STORES, base: base() });
  assert.deepEqual(nuts.filters.allergens, ['peanuts', 'tree-nuts']);
  for (const trap of ['__proto__', 'constructor', 'toString']) {
    const state = filtersFromParams(`?avoid=${trap}&cat=${trap}&store=${trap}&sort=${trap}`, { storeIds: STORES, base: base() });
    assert.deepEqual(state.filters.allergens, [], trap);
    assert.equal(state.filters.category, '', trap);
    assert.ok(state.ignoredAllergens.includes(trap), trap);
  }
});

test('allergy words inside an AI search are added as exclusions, never searched for', () => {
  const dairyFree = filtersFromParams('?q=dairy-free%20yogurt&src=ai', { storeIds: STORES, base: base() });
  assert.deepEqual(dairyFree.filters.allergens, ['milk']);
  assert.equal(dairyFree.filters.query, '乳酪');
  const chocolate = filtersFromParams('?q=no%20milk%20chocolate&src=ai', { storeIds: STORES, base: base() });
  assert.deepEqual(chocolate.filters.allergens, ['milk']);
  assert.equal(chocolate.filters.query, '巧克力');
  const allergyOnly = filtersFromParams('?q=peanut%20allergy&src=ai', { storeIds: STORES, base: base() });
  assert.deepEqual(allergyOnly.filters.allergens, ['peanuts']);
  assert.equal(allergyOnly.filters.query, '');
  assert.equal(filtersFromParams('?q=bread&src=ai', { storeIds: STORES, base: base() }).filters.query, 'bread');
});

test('a typed budget with more decimals still round-trips through a link', () => {
  const link = paramsFromFilters({ ...base(), budget: 12.345 });
  assert.equal(filtersFromParams(link, { storeIds: STORES, base: base() }).filters.budget, 12.35);
});

test('allergy sentences the parser used to miss are read as exclusions, not searches', () => {
  const read = text => parseRequest(text);
  assert.ok(read('花生醬過敏').allergens.includes('peanuts'));
  assert.notEqual(read('花生醬過敏').query, '花生醬');
  for (const text of ['allergies: peanuts, milk', 'I have peanut and milk allergies', 'please exclude peanuts and milk']) {
    assert.deepEqual(read(text).allergens, ['peanuts', 'milk'], text);
    assert.notEqual(read(text).query, '牛奶', text);
  }
  for (const text of ["I'm allergic to cow's milk", '唔飲得牛奶', '唔好有牛奶', '唔含牛奶', '避免牛奶', "can't drink milk", '芝士過敏', '乳糖過敏']) {
    assert.ok(read(text).allergens.includes('milk'), text);
    assert.notEqual(read(text).query, '牛奶', text);
  }
  for (const text of ["I can't eat peanuts", 'cannot eat peanuts', '所有無花生嘅餅乾', '只有無花生嘅餅乾先啱']) {
    assert.ok(read(text).allergens.includes('peanuts'), text);
  }
  assert.deepEqual(read('海鮮過敏').allergens, ['crustaceans', 'fish']);
  assert.ok(read('海鮮過敏').unsupportedAllergens.includes('軟體貝類'));
  assert.deepEqual(read('我對豆漿過敏').allergens, ['soy']);
  assert.equal(read('我對豆漿過敏').query, '');
});

test('an allergy the parser cannot name never becomes a product search', () => {
  const unclear = parseRequest('我有食物過敏，想搵零食');
  assert.equal(unclear.allergyUnclear, true);
  assert.equal(unclear.query, '');
  assert.equal(unclear.category, 'snacks');
  const mustard = parseRequest('我對芥末過敏，想買薯片');
  assert.deepEqual(mustard.unsupportedAllergens, ['芥末']);
  assert.equal(mustard.query, '薯片');
  assert.ok(mustard.notices.some(notice => /篩唔到芥末/.test(notice)));
});

test('lactose-free milk is a kind of milk, not "without milk"', () => {
  const parsed = parseRequest('無乳糖牛奶');
  assert.deepEqual(parsed.allergens, []);
  assert.equal(parsed.query, '無乳糖');
  assert.equal(parseRequest('oat milk').query, '燕麥');
});

test('biscuit wording, Chinese numerals and nutrient limits no longer corrupt the search or budget', () => {
  assert.equal(parseRequest('嘉頓餅乾').query, '嘉頓');
  assert.equal(parseRequest('二十蚊以下嘅餅').budget, 20);
  assert.equal(parseRequest('二十蚊以下嘅餅').query, '');
  const limit = parseRequest('糖唔超過5克，20蚊以下');
  assert.equal(limit.budget, 20);
  assert.equal(limit.sort, 'sugar-asc');
  const english = parseRequest('sugar less than 5g, under $20');
  assert.equal(english.budget, 20);
  assert.equal(english.query, '');
  assert.equal(parseRequest('20蚊以下 最高 2 包').budget, 20);
});

test('single-concept top-level groups such as 飲品 stay searchable', () => {
  const cola = { id: 'cola', nameZh: '可樂 330毫升', tags: ['飲品', 'Drinks', '汽水', '罐裝'], sourceCategory: { zh: '飲品', en: 'Drinks' }, prices: [] };
  const milk = { id: 'milk', nameZh: '鮮牛奶', tags: ['奶類及乳製品 / 大豆製品 / 蛋類', 'Dairy products / Soy products / Eggs', '鮮奶 / 低溫冷藏鮮奶'], sourceCategory: { zh: '奶類及乳製品 / 大豆製品 / 蛋類', en: 'Dairy products / Soy products / Eggs' }, prices: [] };
  assert.deepEqual(filterProducts([cola, milk], { query: '飲品' }).map(p => p.id), ['cola']);
  assert.deepEqual(filterProducts([cola, milk], { query: 'soy' }).map(p => p.id), []);
});
