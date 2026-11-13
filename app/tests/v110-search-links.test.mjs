import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBrandIndex, filterProducts, getMinPrice, parseRequest, parseRequestWithBrandFallback } from '../engine.mjs?v=111';
import { SORT_IDS, filtersFromParams, paramsFromFilters } from '../url-state.mjs?v=111';
import { getPackPrices, rankByUnitPrice } from '../pack-values.mjs?v=111';
import { assistantState, expiryInstant } from '../assistant-state.mjs?v=111';
import { products } from './helpers/catalogue.mjs';

const brandIndex = buildBrandIndex(products);
const base = { query: '', category: '', budget: null, store: '', allergens: [], origin: '', sort: 'relevance', dataScope: '', libraryScope: 'priced' };
const brandOf = product => (typeof product.brand === 'object' ? Object.values(product.brand ?? {}).join(' ') : String(product.brand ?? ''));
const aiLink = q => filtersFromParams(new URLSearchParams({ q, src: 'ai' }), { base, products, brandIndex });

test('a brand name that is also an everyday word no longer empties an AI link (pure orange juice)', () => {
  const state = aiLink('pure orange juice');
  const results = filterProducts(products, state.filters);
  // v1.8 gave 30 foods for this link; v1.9 batch 1 gave 0 because PURE is an olive-oil brand.
  assert.equal(results.length, 30);
  assert.equal(state.filters.query, parseRequest('pure orange juice').query);
  assert.ok(state.notes.some(note => /搵唔到「PURE」牌子嘅呢類食品，所以改為搜尋所有牌子嘅「果汁」/.test(note)), 'the person is told the brand was not used and what was searched instead');
});

test('the sentence filter uses the same safeguard and says what it did', () => {
  const parsed = parseRequestWithBrandFallback('維他 蠔油', { brandIndex, products });
  assert.equal(parsed.brandDropped, '維他');
  assert.equal(parsed.query, '蠔油');
  assert.match(parsed.notices[0], /搵唔到「維他」牌子嘅呢類食品，所以改為搜尋所有牌子嘅「.+」/);
  assert.ok(filterProducts(products, { ...base, query: parsed.query }).length > 0);
});

test('a brand that has matching foods is always kept', () => {
  for (const [text, pattern, minimum] of [['Vita lemon tea', /維他|vita/i, 2], ['Lee Kum Kee oyster sauce', /李錦記|lee kum kee/i, 1], ['嘉頓 梳打餅', /嘉頓|garden/i, 1], ['PURE', /./, 1]]) {
    const parsed = parseRequestWithBrandFallback(text, { brandIndex, products });
    assert.equal(parsed.brandDropped, undefined, text);
    assert.ok(parsed.brand, text);
    const results = filterProducts(products, { ...base, query: parsed.query, category: parsed.category === 'all' ? '' : parsed.category });
    assert.ok(results.length >= minimum, text);
    if (text !== 'PURE') assert.ok(results.every(product => pattern.test(brandOf(product))), `${text}: every result is that brand`);
  }
  const vita = aiLink('Vita lemon tea');
  assert.ok(!vita.notes.some(note => /牌子/.test(note)));
  assert.ok(filterProducts(products, vita.filters).every(product => /維他|vita/i.test(brandOf(product))));
});

test('budget and allergy conditions never cause a brand to be dropped', () => {
  const cheap = parseRequestWithBrandFallback('維他 檸檬茶 1蚊以下', { brandIndex, products });
  assert.equal(cheap.brandDropped, undefined);
  assert.equal(cheap.budget, 1);
  assert.match(cheap.query, /維他/);
  // No reading has results: the brand stays, and the ordinary empty state explains the rest.
  const none = parseRequestWithBrandFallback('pure 火星餅', { brandIndex, products });
  assert.equal(none.brandDropped, undefined);
});

test('allergy wording is read the same with or without the brand list, and the fallback never drops an allergen', () => {
  const brands = ['pure', '維他', 'Vita', 'Select', '嘉頓', 'Nissin', 'Lee Kum Kee'];
  const foods = ['orange juice', '蠔油', '檸檬茶', '牛奶', '梳打餅', '即食麵', '火星餅'];
  const allergyParts = ['我對花生過敏，', '避開奶類同蛋，', 'no peanuts or sesame ', '我對堅果敏感，', '對芥末過敏，', ''];
  let fallbacks = 0;
  for (const brand of brands) for (const food of foods) for (const allergy of allergyParts) {
    const text = `${allergy}${brand} ${food}`;
    const strict = parseRequest(text, { brandIndex });
    const plain = parseRequest(text);
    assert.deepEqual([...strict.allergens].sort(), [...plain.allergens].sort(), text);
    const final = parseRequestWithBrandFallback(text, { brandIndex, products });
    if (final.brandDropped) fallbacks++;
    for (const id of strict.allergens) assert.ok(final.allergens.includes(id), `${text}: keeps ${id}`);
    assert.equal(final.allergyUnclear || false, strict.allergyUnclear || plain.allergyUnclear || false, text);
    for (const word of strict.unsupportedAllergens) assert.ok(final.unsupportedAllergens.includes(word), `${text}: keeps unsupported ${word}`);
  }
  assert.ok(fallbacks > 5, 'the combinations include real fallbacks');
});

test('without a product list the parser behaves exactly as before', () => {
  for (const text of ['pure orange juice', '維他 蠔油', 'Vita lemon tea', '我對花生過敏，想食夾心餅，20蚊以下']) {
    assert.deepEqual(parseRequestWithBrandFallback(text, { brandIndex }), parseRequest(text, { brandIndex }));
  }
});

test('ranking by unit price keeps grams and millilitres apart and puts unknown last', () => {
  const priceOf = product => getMinPrice(product, {});
  const unit = product => getPackPrices(product, priceOf(product));
  for (const query of ['即食麵', '牛奶', '']) {
    const found = filterProducts(products, { ...base, query });
    const ranked = rankByUnitPrice(found, priceOf);
    assert.equal(ranked.products.length, found.length);
    assert.deepEqual(ranked.products.map(product => product.id).sort(), found.map(product => product.id).sort());
    const rows = ranked.products.map(unit);
    const known = rows.filter(row => row.per100 !== null);
    // Unknown unit prices are never placed among known ones.
    assert.ok(rows.slice(known.length).every(row => row.per100 === null));
    assert.equal(ranked.groups.reduce((sum, group) => sum + group.count, 0), known.length);
    let position = 0;
    for (const group of ranked.groups) {
      const block = rows.slice(position, position + group.count);
      assert.ok(block.every(row => row.unit === group.unit), `${query}: one unit per block`);
      for (let index = 1; index < block.length; index++) assert.ok(block[index - 1].per100 <= block[index].per100, `${query}: ascending`);
      position += group.count;
    }
  }
  const milk = rankByUnitPrice(filterProducts(products, { ...base, query: '牛奶' }), priceOf);
  assert.deepEqual(milk.groups.map(group => group.unit), ['ml', 'g']);
  assert.deepEqual(rankByUnitPrice([], priceOf), { products: [], groups: [] });
  // A food with no price has no unit price: it is never ranked as HK$0, it goes last.
  const unpriced = products.filter(product => product.libraryGroup === 'off-library').slice(0, 3);
  const mixed = rankByUnitPrice([...unpriced, ...filterProducts(products, { ...base, query: '即食麵' }).slice(0, 5)], priceOf);
  assert.deepEqual(mixed.products.slice(-3).map(product => product.id).sort(), unpriced.map(product => product.id).sort());
  assert.equal(mixed.groups.reduce((sum, group) => sum + group.count, 0), 5);
  for (const empty of [null, undefined, '']) assert.equal(getPackPrices(products[0], empty).per100, null);
});

test('unit-price ranking does not change which foods the allergy filter lets through', () => {
  const filters = { ...base, query: '即食麵', allergens: ['peanuts'], budget: 20 };
  const plain = filterProducts(products, filters).map(product => product.id).sort();
  const ranked = rankByUnitPrice(filterProducts(products, { ...filters, sort: 'unit-price-asc' }), product => getMinPrice(product, filters));
  assert.deepEqual(ranked.products.map(product => product.id).sort(), plain);
});

test('links accept the new ranking and reject anything unknown', () => {
  assert.ok(SORT_IDS.includes('unit-price-asc'));
  assert.equal(filtersFromParams('?sort=unit-price-asc', { base }).filters.sort, 'unit-price-asc');
  assert.equal(filtersFromParams('?sort=unit-price', { base }).filters.sort, 'unit-price-asc');
  assert.equal(paramsFromFilters({ ...base, sort: 'unit-price-asc' }), 'sort=unit-price-asc');
  const bad = filtersFromParams('?sort=cheapest-ever', { base });
  assert.equal(bad.filters.sort, 'relevance');
  assert.equal(bad.ignored.length, 1);
});

test('the search box and shared links allow the same length, so a shared search is never cut short', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const limit = Number(/id="food-search"[^>]*maxlength="(\d+)"/.exec(html)[1]);
  assert.equal(limit, 60);
  const longest = '低'.repeat(limit);
  const shared = paramsFromFilters({ ...base, query: longest });
  assert.equal(filtersFromParams(`?${shared}`, { base }).filters.query, longest);
});

test('the AI assistant button follows the link and its expiry date', () => {
  const noon = Date.UTC(2026, 10, 20, 4, 0, 0); // 20 Nov 2026, 12:00 in Hong Kong
  assert.equal(assistantState({ url: '' }, noon).state, 'pending');
  assert.equal(assistantState({ url: 'http://example.org/agent' }, noon).state, 'pending', 'only https links are used');
  assert.equal(assistantState({ url: 'javascript:alert(1)' }, noon).state, 'pending');
  const open = assistantState({ url: 'https://example.org/agent', linkExpires: '2026-11-30' }, noon);
  assert.equal(open.state, 'ready');
  assert.equal(open.daysLeft, 11);
  // Valid through the whole expiry day in Hong Kong, expired from midnight.
  assert.equal(assistantState({ url: 'https://example.org/agent', linkExpires: '2026-11-20' }, Date.UTC(2026, 10, 20, 15, 59)).state, 'ready');
  assert.equal(assistantState({ url: 'https://example.org/agent', linkExpires: '2026-11-20' }, Date.UTC(2026, 10, 20, 16, 0)).state, 'expired');
  assert.equal(assistantState({ url: 'https://example.org/agent', linkExpires: '2026-11-19' }, noon).state, 'expired');
  const noDate = assistantState({ url: 'https://example.org/agent', linkExpires: '' }, noon);
  assert.deepEqual([noDate.state, noDate.expiryUnreadable], ['ready', false]);
  const odd = assistantState({ url: 'https://example.org/agent', linkExpires: '30/11/2026' }, noon);
  assert.deepEqual([odd.state, odd.expiryUnreadable], ['ready', true]);
  assert.equal(expiryInstant('2026-02-30'), null);
  assert.equal(expiryInstant('2026-11-30'), Date.UTC(2026, 10, 30, 16));
});
