import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue, mergeLabelSources } from '../catalogue.mjs';
import { enrichCatalogue } from '../enrichment.mjs';
import { applyHkLabelReview } from '../hk-labels.mjs';
import { buildBrandIndex, filterProducts, getAllergenAssessment, getMinPrice, nutritionFor, parseRequest, searchQueryLimitations } from '../engine.mjs';
import { filtersFromParams, paramsFromFilters } from '../url-state.mjs';

const read = name => JSON.parse(readFileSync(new URL('../data/' + name + '.json', import.meta.url), 'utf8'));
let catalogue = buildCatalogue(mergeLabelSources(read('products'), read('off-hk-labels')), read('pricewatch-foods'), read('pricewatch-meta'));
catalogue = enrichCatalogue(catalogue, read('hk-nutrition-expansion'), read('off-nutrition-library'));
for (const overlay of ['hk-reviewed-labels', 'off-hk-reviewed-labels', 'hk-reviewed-labels-extra', 'off-hk-reviewed-labels-extra']) {
  catalogue = applyHkLabelReview(catalogue, read(overlay));
}
const products = catalogue.products;
const brandIndex = buildBrandIndex(products);
const byId = new Map(products.map(product => [product.id, product]));
const priced = { libraryScope: 'priced' };
const search = (query, filters = {}) => filterProducts(products, { ...priced, query, ...filters });
const ids = rows => rows.map(product => product.id);

test('sandwich biscuits and cream dairy stay separate when the biscuit category is cleared', () => {
  const request = parseRequest('cream sandwich biscuits');
  assert.equal(request.category, 'biscuits');
  for (const hits of [search('cream sandwich biscuits'), search('忌廉餅'), search(request.query, { category: 'all' })]) {
    assert.ok(hits.some(product => product.id === 'P000001318'), 'lemon sandwich biscuit');
    assert.ok(hits.some(product => product.id === 'P000000793'), 'chocolate cream wafer');
    assert.ok(hits.every(product => product.category === 'biscuits'));
    assert.ok(!hits.some(product => product.id === 'P000003676'), 'plain cream crackers');
  }
  assert.ok(ids(search('full cream evaporated milk')).includes('P000000245'));
  assert.ok(ids(search(parseRequest('全脂淡奶').query)).includes('P000000245'));
  assert.ok(!ids(search('full cream evaporated milk')).includes('P000001318'));
  assert.ok(ids(search('cream')).includes('P000003695'), 'a direct cream search can still match named full-cream milk');
  assert.equal(byId.get('P000003695').category, 'drinks');
});

test('legacy AI cream links still mean filled biscuits, including after category relaxation', () => {
  const state = filtersFromParams('?q=cream&cat=biscuits&src=ai', { base: priced });
  assert.equal(state.filters.query, '夾心');
  assert.equal(state.filters.category, 'biscuits');
  const relaxed = { ...state.filters, category: '' };
  const copied = filtersFromParams(paramsFromFilters(relaxed), { base: priced }).filters;
  const hits = filterProducts(products, copied);
  assert.ok(hits.some(product => product.id === 'P000001318'));
  assert.ok(hits.every(product => product.category === 'biscuits'));
});

test('代糖 finds named sweeteners and never plain sugar in the shared source category', () => {
  const expected = ['P000002735', 'P000002736'];
  for (const query of ['代糖', 'sweetener', 'sugar substitute', parseRequest('想買代糖').query]) {
    assert.deepEqual(ids(search(query)).sort(), expected);
  }
  assert.ok(byId.get('P000002738').tags.some(tag => tag.includes('代糖')), 'the plain sugar fixture has the misleading source tag');
});

test('低糖乳酪 compares yoghurt without returning cheese or claiming a low-sugar classification', () => {
  const request = parseRequest('低糖乳酪');
  assert.equal(request.query, '乳酪');
  assert.equal(request.sort, 'sugar-asc');
  assert.match(request.notices.join(' '), /未判定是否低糖/);
  const ranked = filterProducts(products, { ...request, ...priced });
  for (const results of [ranked, search('低糖乳酪'), search('low-sugar yoghurt')]) {
    assert.ok(results.some(product => product.id === 'P000002616'));
    assert.ok(results.every(product => /乳酪|yogh?urt/i.test(product.nameZh + ' ' + product.nameEn)));
    assert.ok(!ids(results).includes('P000000729'), 'cheddar from the cheese/yoghurt source group');
  }
  const sugars = ranked.map(product => nutritionFor(product).sugars);
  const measured = sugars.filter(value => value !== null);
  assert.ok(measured.length > 1);
  assert.deepEqual(sugars, [...measured.sort((a, b) => a - b), ...sugars.filter(value => value === null)]);
  assert.match(searchQueryLimitations('低糖乳酪').join(' '), /未判定是否低糖/);
});

test('檸茶 and 凍檸茶 find named drinks, including from the quick parser, without plain tea bags or citron mix', () => {
  const expected = ids(search('檸檬茶')).sort();
  assert.ok(expected.includes('P000005391'));
  assert.ok(expected.includes('HK-VITA-ZERO-LEMON-500'));
  assert.ok(!expected.includes('P000004732'), 'honey citron tea mix');
  for (const query of ['檸茶', '凍檸茶', 'lemon tea', '檸檬茶']) {
    assert.deepEqual(ids(search(query)).sort(), expected);
    assert.deepEqual(ids(filterProducts(products, { ...parseRequest(query), ...priced })).sort(), expected);
  }
  assert.ok(products.some(product => /茶包|tea\s*bags?/i.test(product.nameZh + ' ' + product.nameEn)));
  assert.ok(search('檸茶').every(product => !/茶包|tea\s*bags?/i.test(product.nameZh + ' ' + product.nameEn)));
});

test('蘇打餅 works in both search boxes and 嘉頓 stays attached to the biscuit in an offline or AI request', () => {
  assert.deepEqual(ids(search('蘇打餅')), ids(search('梳打餅')));
  assert.ok(ids(search(parseRequest('想搵蘇打餅').query)).includes('P000001187'));
  const expected = ['P000000651', 'P000001187'];
  for (const request of [
    { query: '嘉頓梳打餅' },
    parseRequest('嘉頓 梳打餅', { brandIndex }),
    filtersFromParams('?q=Garden%20soda%20crackers&src=ai', { base: priced, brandIndex }).filters,
  ]) {
    assert.match(request.query, /嘉頓|garden/i);
    assert.deepEqual(ids(filterProducts(products, { ...request, ...priced })).sort(), expected);
  }
});

test('v1.9 AI links keep the catalogue brand alongside the food, including multi-word brands', () => {
  const cases = [
    ['Vita lemon tea', /^vita /i, /^vita$/i, ['P000000125', 'P000005059']],
    ['Lee Kum Kee oyster sauce', /^lee kum kee /i, /^lee kum kee$/i, ['P000000071']],
    ['Nissin cup noodles', /^nissin /i, /^nissin$/i, ['P000000660']],
    ['Nestle coffee', /^nestle /i, /^nestle(?: |$)/i, ['P000002282']],
  ];
  for (const [q, expectedQuery, expectedBrand, expectedIds] of cases) {
    const state = filtersFromParams(new URLSearchParams({ q, src: 'ai' }), { base: priced, brandIndex });
    assert.match(state.filters.query, expectedQuery);
    const hits = filterProducts(products, state.filters);
    assert.ok(expectedIds.every(id => ids(hits).includes(id)), q);
    assert.ok(hits.every(product => expectedBrand.test(product.brandEn)), q);
    if (q === 'Lee Kum Kee oyster sauce') assert.equal(hits[0].id, 'P000000071');
  }
});

test('main search retains v1.8 result counts for words that resemble brands', t => {
  for (const [query, expected] of [
    ['fresh milk', 63],
    ['雀巢 咖啡', 9],
    ['extra virgin olive oil', 17],
    ['粟米 片', 24],
    ['lemon cake', 3],
    ['藍莓 乳酪', 2],
  ]) {
    const count = search(query).length;
    assert.equal(count, expected, query);
    t.diagnostic(`${query}: ${count} (v1.8: ${expected})`);
  }
});

test('AI fresh milk link retains the v1.8 count of 96', () => {
  const state = filtersFromParams('?q=fresh%20milk&src=ai', { base: priced, brandIndex });
  assert.equal(state.filters.query, '牛奶');
  assert.equal(filterProducts(products, state.filters).length, 96);
});

test('brand lookup excludes OFF-only brands and produce placeholders', () => {
  for (const alias of ['fresh', 'extra', '番茄', '粟米', '檸檬']) {
    assert.equal(brandIndex.has(alias), false, alias);
  }
  for (const alias of ['vita', '維他', 'lee kum kee', '李錦記', 'nissin', 'nestle']) {
    assert.ok(brandIndex.has(alias), alias);
  }
});

test('v1.9 the quick parser keeps Chinese brands and catalogue punctuation', () => {
  for (const [q, expectedQuery, expectedId] of [
    ['維他 檸檬茶', '維他 檸檬茶', 'P000000125'],
    ['想買維他檸檬茶', '維他 檸檬茶', 'P000005059'],
    ['李錦記 蠔油', '李錦記 蠔油', 'P000000071'],
    ['嘉頓 梳打餅', '嘉頓 克力架', 'P000001187'],
    ['Baker’s Choice sandwich bread', "Baker's Choice 夾心麵包", 'P000003983'],
  ]) {
    const request = parseRequest(q, { brandIndex });
    assert.equal(request.query, expectedQuery);
    assert.ok(ids(filterProducts(products, { ...priced, ...request })).includes(expectedId), q);
  }
});

test('v1.9 奶油曲奇 is a butter-cookie search in both boxes', () => {
  const quick = parseRequest('奶油曲奇', { brandIndex });
  const direct = search('奶油曲奇');
  assert.deepEqual(ids(filterProducts(products, { ...priced, ...quick })), ids(direct));
  assert.ok(ids(direct).includes('P000000967'), 'Kjeldsens');
  assert.ok(ids(direct).includes('P000003211'), 'Walkers');
  assert.ok(!ids(direct).includes('P000001318'), 'Lemon Puff sandwich biscuit');
});

test('v1.9 low GI bread uses the same 96 hits in both searches and discloses the limitation', () => {
  const query = '低GI 麵包';
  const quick = parseRequest(query, { brandIndex });
  const direct = search(query);
  assert.equal(direct.length, 96);
  assert.deepEqual(ids(filterProducts(products, { ...priced, ...quick })), ids(direct));
  assert.match(quick.notices.join(' '), /冇升糖指數（GI）資料/);
});

test('v1.9 named soda crackers rank ahead of products matching only by category', () => {
  const direct = ids(search('蘇打餅'));
  const quick = parseRequest('蘇打餅', { brandIndex });
  assert.deepEqual(ids(filterProducts(products, { ...priced, ...quick })), direct);
  for (const named of ['P000000366', 'P000001187', 'P000000651']) {
    assert.ok(direct.includes(named) && direct.includes('P000003660'));
    assert.ok(direct.indexOf(named) < direct.indexOf('P000003660'), 'named cracker before almond crisp');
  }
});

test('v1.9 sandwich bread and cream cake keep the bakery category', () => {
  for (const [query, expectedId] of [['夾心麵包', 'P000003983'], ['忌廉蛋糕', 'P000005408']]) {
    const quick = parseRequest(query, { brandIndex });
    assert.equal(quick.category, 'bakery');
    const hits = filterProducts(products, { ...priced, ...quick });
    assert.ok(ids(hits).includes(expectedId));
    assert.ok(hits.every(product => product.category === 'bakery'));
  }
});

test('unsupported low GI never defaults to the catalogue; any matching food results disclose the limitation', () => {
  for (const query of ['低GI', '低 ＧＩ 食品', 'low GI foods', 'low-glycaemic index']) {
    assert.deepEqual(search(query), []);
    assert.match(searchQueryLimitations(query).join(' '), /冇升糖指數/);
    const parsed = parseRequest(query);
    assert.deepEqual(ids(filterProducts(products, { ...priced, ...parsed })), []);
    assert.match(parsed.notices.join(' '), /冇升糖指數/);
  }
  const mixed = parseRequest('想買低GI凍檸茶');
  assert.deepEqual(ids(filterProducts(products, { ...priced, ...mixed })), ids(search('檸茶')));
  assert.match(mixed.notices.join(' '), /未能篩選低 GI/);
  for (const params of [
    new URLSearchParams({ q: '低GI' }),
    new URLSearchParams({ q: 'low-GI food', src: 'ai' }),
  ]) {
    const state = filtersFromParams(params, { base: priced });
    assert.match(state.notes.join(' '), /冇升糖指數/);
    assert.deepEqual(filterProducts(products, state.filters), []);
    assert.ok(paramsFromFilters(state.filters).includes('q='), 'a copied link keeps the unsupported request');
  }
});

test('the filled-biscuit allergy demo can be empty and the noodle example retains all conservative conditions', () => {
  const empty = parseRequest('想搵夾心餅，20蚊以下，避開花生');
  assert.deepEqual(filterProducts(products, { ...priced, ...empty }), []);
  const request = parseRequest('想搵即食麵，20蚊以下，避開花生，少鈉');
  assert.deepEqual(request.allergens, ['peanuts']);
  assert.equal(request.sort, 'sodium-asc');
  const results = filterProducts(products, { ...priced, ...request });
  assert.ok(ids(results).includes('P000000015'));
  assert.ok(ids(results).includes('P000001128'));
  assert.ok(results.every(product => getAllergenAssessment(product, ['peanuts']).status === 'no-listed-match' && getMinPrice(product) <= 20));
});
