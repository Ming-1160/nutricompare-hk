
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { ALLERGENS, filterProducts, getAllergenAssessment, parseRequest } from '../engine.mjs?v=110';
import { getExclusionReasons } from '../exclusion-reasons.mjs?v=110';
import { buildCatalogue, mergeLabelSources } from '../catalogue.mjs';
import { enrichCatalogue } from '../enrichment.mjs';
import { applyHkLabelReview } from '../hk-labels.mjs';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/v18-allergen-baseline.json', import.meta.url), 'utf8'));
const dataDirectory = new URL('../data/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name + '.json', dataDirectory), 'utf8'));
const ids = products => products.map(product => product.id).sort();

let catalogue = buildCatalogue(mergeLabelSources(read('products'), read('off-hk-labels')), read('pricewatch-foods'), read('pricewatch-meta'));
catalogue = enrichCatalogue(catalogue, read('hk-nutrition-expansion'), read('off-nutrition-library'));
for (const overlay of ['hk-reviewed-labels', 'off-hk-reviewed-labels', 'hk-reviewed-labels-extra', 'off-hk-reviewed-labels-extra']) {
  catalogue = applyHkLabelReview(catalogue, read(overlay));
}

test('v1.9 data files match the v1.8 ZIP byte for byte', () => {
  const filenames = readdirSync(dataDirectory).sort();
  assert.deepEqual(filenames, Object.keys(baseline.dataSha256));
  for (const name of filenames) {
    const actual = createHash('sha256').update(readFileSync(new URL(name, dataDirectory))).digest('hex');
    assert.equal(actual, baseline.dataSha256[name], name);
  }
});

test('all ten v1.9 allergen exclusion sets match the v1.8 ZIP catalogue exactly', t => {
  const allProducts = filterProducts(catalogue.products);
  const allIds = ids(allProducts);
  assert.deepEqual(allIds, baseline.catalogueIds);
  assert.equal(ALLERGENS.length, 10);
  assert.deepEqual(ALLERGENS, Object.keys(baseline.allergens));

  for (const allergen of ALLERGENS) {
    const expected = baseline.allergens[allergen];
    const expectedAllowedIds = new Set(expected.allowedIds);
    const actualAllowedIds = new Set(ids(filterProducts(catalogue.products, { allergens: [allergen] })));
    const expectedExcluded = baseline.catalogueIds.filter(id => !expectedAllowedIds.has(id));
    const actualExcluded = allIds.filter(id => !actualAllowedIds.has(id));
    assert.equal(actualExcluded.length, expected.excludedCount, allergen);
    assert.deepEqual(actualExcluded, expectedExcluded, allergen);

    const assessments = allProducts.map(product => [product.id, getAllergenAssessment(product, [allergen]).status]);
    const actualConflictIds = assessments.filter(([, status]) => status === 'conflict').map(([id]) => id).sort();
    const actualClearIds = assessments.filter(([, status]) => status === 'no-listed-match').map(([id]) => id).sort();
    assert.deepEqual(actualConflictIds, expected.conflictIds, allergen);
    assert.deepEqual(actualClearIds, expected.allowedIds, allergen);
    t.diagnostic(`${allergen}: ${actualExcluded.length} exact excluded IDs (${actualConflictIds.length} conflict, ${actualExcluded.length - actualConflictIds.length} unknown)`);
  }
});

test('the v1.9 peanut and filled-biscuit quick request has zero results and the v1.8 exclusion groups', () => {
  const request = parseRequest('我對花生過敏，想食夾心餅，20蚊以下');
  const filters = { ...request, libraryScope: 'priced' };
  assert.deepEqual(filters.allergens, ['peanuts']);
  assert.deepEqual(filterProducts(catalogue.products, filters), []);
  const { conflicts, unknown } = getExclusionReasons(catalogue.products, filters);
  assert.deepEqual(ids(conflicts.map(({product})=>product)), ['P000000037', 'P000000652', 'P000000793', 'P000003649']);
  assert.deepEqual(ids(unknown), [
    'P000000945', 'P000001605', 'P000001804', 'P000001807', 'P000003648',
    'P000003651', 'P000003978', 'P000003980', 'P000004170', 'P000004171',
  ]);
  for (const { product, contains, mayContain } of conflicts) {
    assert.deepEqual(contains, product.id === 'P000000037' ? ['peanuts'] : [], product.id);
    assert.deepEqual(mayContain, product.id === 'P000000037' ? [] : ['peanuts'], product.id);
  }
});

