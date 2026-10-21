import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterProducts, getEligiblePrices, getMinPrice, getAllergenAssessment, nutritionFor, parseRequest,
} from '../engine.mjs';

const product = (id, overrides = {}) => ({
  id, nameZh: '原味夾心餅乾', nameEn: 'Original cream biscuits', brand: 'Example',
  category: 'biscuits', tags: ['夾心', 'cream'], origin: null, servingSize: 25,
  prices: [{ store: 'PARKNSHOP', price: 30 }, { store: 'WELLCOME', price: 20 }],
  nutrition: { basisUnit: 'g', basisAmount: 100, energyKcal: 400, carbohydrates: 60, sugars: 15, fat: 10, saturatedFat: 5, protein: 4, fibre: null, sodiumMg: 80 },
  allergens: { status: 'complete', contains: ['gluten'], mayContain: [] },
  ...overrides,
});

test('full-pack budget follows the selected store, including exact boundary', () => {
  const p = product('a');
  assert.equal(getMinPrice(p), 20);
  assert.equal(getMinPrice(p, { store: 'PARKNSHOP' }), 30);
  assert.equal(filterProducts([p], { budget: 20 }).length, 1);
  assert.equal(filterProducts([p], { budget: 20, store: 'PARKNSHOP' }).length, 0);
  assert.equal(filterProducts([p], { budget: 30, store: 'PARKNSHOP' }).length, 1);
});

test('unknown prices cannot pass a budget and do not become zero', () => {
  const p = product('unknown', { prices: [{ store: 'PARKNSHOP', price: null }, { store: 'WELLCOME', price: '' }] });
  assert.equal(getMinPrice(p), null);
  assert.deepEqual(getEligiblePrices(p), []);
  assert.equal(filterProducts([p], { budget: 100 }).length, 0);
  assert.equal(filterProducts([p], {}).length, 1);
});

test('numeric zero is retained while invalid, blank, negative and infinite prices are excluded', () => {
  const p = product('price', { prices: [
    { store: 'PARKNSHOP', price: '0' }, { store: 'WELLCOME', price: '  ' },
    { store: 'AEON', price: -1 }, { store: 'JASONS', price: Infinity },
  ] });
  assert.equal(getMinPrice(p), 0);
  assert.equal(filterProducts([p], { budget: 0 }).length, 1);
  assert.equal(getEligiblePrices(p).length, 1);
});

test('unknown selected merchant does not borrow another store price', () => {
  const p = product('a');
  assert.equal(getMinPrice(p, { store: 'AEON' }), null);
  assert.equal(filterProducts([p], { store: 'AEON' }).length, 0);
});

test('contains and may-contain declarations both exclude matching allergens', () => {
  const p = product('a', { allergens: { status: 'complete', contains: ['wheat'], mayContain: ['milk'] } });
  assert.equal(getAllergenAssessment(p, ['gluten']).status, 'conflict');
  assert.equal(getAllergenAssessment(p, ['牛奶']).status, 'conflict');
  assert.equal(filterProducts([p], { allergens: ['milk'] }).length, 0);
  assert.equal(getAllergenAssessment(p, ['peanuts']).status, 'no-listed-match');
});

test('incomplete or missing allergy data never passes an active allergy filter', () => {
  for (const allergens of [undefined, { status: 'unknown', contains: [], mayContain: [] }, { status: 'partial', contains: [], mayContain: [] }, { status: 'complete' }]) {
    const p = product('a', { allergens });
    assert.equal(getAllergenAssessment(p, ['milk']).status, 'unknown');
    assert.equal(filterProducts([p], { allergens: ['milk'] }).length, 0);
  }
});

test('allergy conflicts take priority over incomplete status', () => {
  const p = product('a', { allergens: { status: 'partial', contains: ['milk'], mayContain: [] } });
  assert.equal(getAllergenAssessment(p, ['milk']).status, 'conflict');
});

test('normalizes cereal and tree-nut aliases conservatively, with no guarantee language', () => {
  const p = product('a', { allergens: { status: 'complete', contains: ['小麥', 'almonds'], mayContain: [] } });
  assert.equal(getAllergenAssessment(p, ['麩質']).status, 'conflict');
  assert.equal(getAllergenAssessment(p, ['tree-nuts']).status, 'conflict');
  assert.equal(getAllergenAssessment(p, ['mustard']).status, 'unknown');
  assert.equal(getAllergenAssessment(p, []).status, 'not-selected');
  assert.match(getAllergenAssessment(p, ['milk']).message, /不代表保證安全/);
});

test('label arithmetic preserves unknowns and converts specified portions', () => {
  const p = product('a');
  const portion = nutritionFor(p, 'portion', 20);
  assert.equal(portion.carbohydrates, 12);
  assert.equal(portion.sugars, 3);
  assert.equal(portion.fibre, null);
  assert.equal(portion.sodiumMg, 16);
  assert.equal(portion.basisUnit, 'g');
  assert.equal(portion.amount, 20);
  assert.equal(nutritionFor(p, 'portion').carbohydrates, 15);
  assert.equal(nutritionFor(p).carbohydrates, 60);
});

test('unknown units, invalid portions, and invalid source amounts do not fabricate values', () => {
  const p = product('a');
  assert.equal(nutritionFor(p, 'portion', 0).sugars, null);
  assert.equal(nutritionFor(p, 'portion', -5).sugars, null);
  assert.equal(nutritionFor(product('b', { servingSize: null }), 'portion').sugars, null);
  assert.equal(nutritionFor(product('c', { nutrition: { sugars: 10 } })).sugars, null);
  assert.equal(nutritionFor(product('d', { nutrition: { sugars: 10, basisAmount: 0, basisUnit: 'g' } })).sugars, null);
});

test('search matches Chinese/English and cream synonyms, with independent filters', () => {
  const p = product('a');
  assert.equal(filterProducts([p], { query: 'cream biscuits' }).length, 1);
  assert.equal(filterProducts([p], { query: '忌廉 餅乾' }).length, 1);
  assert.equal(filterProducts([p], { category: 'drinks' }).length, 0);
  assert.equal(filterProducts([p], { origin: 'Japan' }).length, 0);
});

test('search includes English and Chinese alternate brand fields', () => {
  const products = [
    product('digestive', { brand: '麥維他', brandEn: "McVitie's", nameZh: '消化餅', nameEn: 'Digestive biscuits' }),
    product('timtam', { brand: '雅樂思', brandEn: "Arnott's Tim Tam", nameZh: '原味巧克力三文治餅', nameEn: 'Original Chocolate Biscuits' }),
    product('garden', { brand: 'Garden', brandZh: '嘉頓', nameZh: '威化餅', nameEn: 'Wafer' }),
  ];
  assert.deepEqual(filterProducts(products, { query: 'McVitie' }).map(p => p.id), ['digestive']);
  assert.deepEqual(filterProducts(products, { query: 'Tim Tam' }).map(p => p.id), ['timtam']);
  assert.deepEqual(filterProducts(products, { query: '嘉頓' }).map(p => p.id), ['garden']);
});

test('sesame and Chinese sesame aliases exclude both ingredient and precaution matches', () => {
  const ingredient = product('ingredient', { allergens: { status: 'complete', contains: ['sesame'], mayContain: [] } });
  const precaution = product('precaution', { allergens: { status: 'complete', contains: [], mayContain: ['芝蔴'] } });
  assert.equal(getAllergenAssessment(ingredient, ['芝麻']).status, 'conflict');
  assert.equal(getAllergenAssessment(precaution, ['sesame seeds']).status, 'conflict');
  assert.deepEqual(filterProducts([ingredient, precaution], { allergens: ['sesame'] }), []);
  assert.deepEqual(parseRequest('sesame-free biscuits').allergens, ['sesame']);
});

test('sorting is stable, puts unknown last and never mutates source', () => {
  const values = [
    product('unknown', { prices: [] }), product('expensive', { prices: [{ store: 'PARKNSHOP', price: 50 }] }), product('cheap'),
  ];
  assert.deepEqual(filterProducts(values, { sort: 'price-asc' }).map(p => p.id), ['cheap', 'expensive', 'unknown']);
  assert.deepEqual(values.map(p => p.id), ['unknown', 'expensive', 'cheap']);
  const nutrition = [product('null', { nutrition: { basisUnit: 'g', sugars: null } }), product('high'), product('low', { nutrition: { basisUnit: 'g', sugars: 2 } })];
  assert.deepEqual(filterProducts(nutrition, { sort: 'sugar-asc' }).map(p => p.id), ['low', 'high', 'null']);
});

test('nutrition sorting does not rank grams against millilitres', () => {
  const values = [product('food'), product('drink', { category: 'drinks', nutrition: { basisUnit: 'ml', sugars: 2 } })];
  assert.deepEqual(filterProducts(values, { sort: 'sugar-asc' }).map(p => p.id), ['food', 'drink']);
});

test('phrase parser transparently sets budget, store, category and explicit milk allergy', () => {
  const parsed = parseRequest('我想食夾心餅，預算30蚊，對牛奶過敏，百佳買');
  assert.equal(parsed.category, 'biscuits');
  assert.equal(parsed.query, '夾心');
  assert.equal(parsed.budget, 30);
  assert.equal(parsed.store, 'PARKNSHOP');
  assert.deepEqual(parsed.allergens, ['milk']);
  assert.equal(parsed.isRuleBased, true);
  assert.match(parsed.notices.at(-1), /並非 AI/);
});

test('English phrase parser avoids treating an ordinary food mention as an allergy', () => {
  const parsed = parseRequest('cream biscuits under HK$25 without milk');
  assert.equal(parsed.budget, 25);
  assert.deepEqual(parsed.allergens, ['milk']);
  assert.deepEqual(parseRequest('milk chocolate biscuits').allergens, []);
  assert.equal(parseRequest('black coffee under 15').category, 'drinks');
});

test('clinical request provides limits, never individual treatment recommendations', () => {
  const parsed = parseRequest('我有糖尿病，正食藥，可以食幾多餅？');
  assert.match(parsed.notices[0], /不能判斷藥物相容性/);
  assert.equal(parsed.budget, null);
});
