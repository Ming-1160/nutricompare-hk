import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts } from '../engine.mjs?v=111';
import { filtersFromParams, paramsFromFilters } from '../url-state.mjs?v=111';
import { comparisonShareUrl } from '../compare-share.mjs?v=111';
import { products } from './helpers/catalogue.mjs';

const base = { query: '', category: '', budget: null, store: '', allergens: [], origin: '', sort: 'relevance', dataScope: '', libraryScope: 'priced' };
const origins = [...new Set(products.map(product => product.origin).filter(origin => typeof origin === 'string' && origin.trim()))];
const ids = filters => filterProducts(products, filters).map(product => product.id).sort();

test('sharing every catalogue origin restores the same filtered foods instead of the full catalogue', () => {
  assert.ok(origins.length > 0, 'the real catalogue provides origin values to exercise');
  for (const origin of origins) {
    const filters = { ...base, origin };
    const before = ids(filters);
    assert.ok(before.length > 0, `${origin}: there are matching foods`);
    assert.ok(before.length < ids(base).length, `${origin}: the filter narrows the catalogue`);
    const query = paramsFromFilters(filters);
    assert.equal(new URLSearchParams(query).get('origin'), origin);
    const restored = filtersFromParams(query, { base, products });
    assert.equal(restored.filters.origin, origin);
    assert.ok(restored.applied.includes('origin'));
    assert.deepEqual(restored.ignored, []);
    assert.deepEqual(ids(restored.filters), before, `${origin}: identical result IDs after sharing`);
  }
});

test('comparison links retain origin, comparison IDs and existing allergy exclusions together', () => {
  const origin = origins[0];
  const filters = { ...base, origin, allergens: ['peanuts'] };
  const matches = filterProducts(products, filters);
  assert.ok(matches.length > 0, 'a real origin-and-allergen selection has a food to share');
  const compareIds = matches.slice(0, 3).map(product => product.id);
  const shared = comparisonShareUrl('https://example.org/nutricompare-hk/', filters, compareIds);
  const restored = filtersFromParams(new URL(shared).search, { base, products });
  assert.equal(restored.filters.origin, origin);
  assert.deepEqual(restored.filters.allergens, ['peanuts']);
  assert.deepEqual(restored.compareIds, compareIds);
  assert.deepEqual(ids(restored.filters), ids(filters));
});

test('an unsupported or untranslated origin is reported and never replaces an existing origin', () => {
  const existing = { ...base, origin: origins[0], allergens: ['milk'] };
  for (const origin of ['火星', 'Hong Kong', '香港／日本']) {
    assert.ok(!origins.includes(origin), `${origin}: deliberately absent from the catalogue`);
    const state = filtersFromParams(new URLSearchParams({ origin, avoid: 'peanuts' }), { base: existing, products });
    assert.equal(state.filters.origin, existing.origin);
    assert.ok(state.ignored.some(message => message.startsWith('產地「')));
    assert.ok(!state.applied.includes('origin'));
    assert.deepEqual(new Set(state.filters.allergens), new Set(['milk', 'peanuts']));
    assert.deepEqual(existing.allergens, ['milk'], 'the caller\'s base is not changed');
  }
  const withoutCatalogue = filtersFromParams(new URLSearchParams({ origin: origins[0] }), { base });
  assert.equal(withoutCatalogue.filters.origin, '');
  assert.equal(withoutCatalogue.ignored.length, 1, 'no catalogue means no origin can be verified');
});

test('repeated origins use the first value with a visible note and empty defaults stay out of links', () => {
  const known = origins[0];
  const state = filtersFromParams(new URLSearchParams([['origin', known], ['origin', '火星']]), { base, products });
  assert.equal(state.filters.origin, known);
  assert.ok(state.notes.some(note => note.includes('多於一個產地')));
  assert.equal(new URLSearchParams(paramsFromFilters(base)).has('origin'), false);
  assert.equal(new URLSearchParams(paramsFromFilters({ ...base, origin: ' ' })).has('origin'), false);
  assert.equal(filtersFromParams('?origin=', { base, products }).filters.origin, '');
});
