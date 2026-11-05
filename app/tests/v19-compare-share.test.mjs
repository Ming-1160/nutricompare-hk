import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue, mergeLabelSources } from '../catalogue.mjs';
import { enrichCatalogue } from '../enrichment.mjs';
import { applyHkLabelReview } from '../hk-labels.mjs';
import { comparisonShareUrl, qrSvg, shareComparison, whatsappShareUrl } from '../compare-share.mjs?v=19';
import { filtersFromParams } from '../url-state.mjs?v=19';

const read = name => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
let catalogue = buildCatalogue(mergeLabelSources(read('products'), read('off-hk-labels')), read('pricewatch-foods'), read('pricewatch-meta'));
catalogue = enrichCatalogue(catalogue, read('hk-nutrition-expansion'), read('off-nutrition-library'));
for (const overlay of ['hk-reviewed-labels', 'off-hk-reviewed-labels', 'hk-reviewed-labels-extra', 'off-hk-reviewed-labels-extra']) {
  catalogue = applyHkLabelReview(catalogue, read(overlay));
}
const products = catalogue.products;
const ids = ['P000000014', 'P000000939', 'P000001128'];
const page = 'https://ming-1160.github.io/nutricompare-hk/app/?previous=1#old';

test('comparison URL reopens the exact ordered catalogue items and preserves validated conditions', () => {
  const url = new URL(comparisonShareUrl(page, { query: '即食麵', budget: 20 }, ids));
  assert.equal(url.pathname, '/nutricompare-hk/app/');
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.has('previous'), false);
  assert.equal(url.searchParams.get('compare'), ids.join(','));
  const result = filtersFromParams(url.search, { products });
  assert.deepEqual(result.compareIds, ids);
  assert.equal(result.filters.query, '即食麵');
  assert.equal(result.filters.budget, 20);
  assert.deepEqual(result.notes, ['已還原 3 款比較食品。']);
  const whatsapp = new URL(whatsappShareUrl(url.href));
  assert.equal(whatsapp.origin + whatsapp.pathname, 'https://wa.me/');
  assert.equal(whatsapp.searchParams.get('text'), url.href);
});

test('unknown, malformed, repeated and surplus comparison IDs are ignored and explained', () => {
  const input = new URLSearchParams();
  input.append('compare', ['UNKNOWN', `<${ids[0]}>`, ids[0], ids[0]].join(','));
  input.append('compare', [ids[1], ids[2], 'P000000304'].join(','));
  const result = filtersFromParams(input, { products });
  assert.deepEqual(result.compareIds, ids);
  assert.match(result.notes.join(' '), /有 4 項比較資料已略過/);
  assert.match(result.notes.join(' '), /UNKNOWN.*未能辨認/);
  assert.match(result.notes.join(' '), /重複/);
  assert.match(result.notes.join(' '), /超出 3 款上限/);
  assert.equal(filtersFromParams('compare=', { products }).compareIds.length, 0);
});

test('a shared comparison cannot bypass the existing allergy rule for known products', () => {
  const input = new URLSearchParams({ avoid: 'gluten', compare: ids.join(',') });
  const result = filtersFromParams(input, { products });
  assert.deepEqual(result.filters.allergens, ['gluten']);
  assert.deepEqual(result.compareIds, []);
  assert.match(result.notes.join(' '), /有 3 項比較資料已略過.*未能符合過敏條件/);
});

test('browser share prefers the native share sheet, then clipboard and a manual fallback', async () => {
  const url = comparisonShareUrl(page, {}, ids);
  const calls = [];
  const clip = { writeText: async text => calls.push(['clipboard', text]) };
  const native = { share: async data => calls.push(['share', data.url]), clipboard: clip };
  assert.equal(await shareComparison(url, native), 'shared');
  assert.equal(await shareComparison(url, { clipboard: clip }), 'copied');
  const cancelled = { share: async () => { throw new DOMException('Cancelled', 'AbortError'); }, clipboard: clip };
  assert.equal(await shareComparison(url, cancelled), 'cancelled');
  assert.equal(await shareComparison(url, {}), 'manual');
  assert.deepEqual(calls, [['share', url], ['clipboard', url]]);
});

test('the local QR SVG has an accessible name, quiet zone and payload-dependent modules', () => {
  const first = qrSvg(comparisonShareUrl(page, {}, ids));
  const second = qrSvg(comparisonShareUrl(page, {}, [...ids].reverse()));
  assert.match(first, /^<svg[^>]+role="img"/);
  assert.match(first, /<title[^>]*>比較連結 QR code<\/title>/);
  assert.match(first, /viewBox="0 0 (\d+) \1"/);
  assert.match(first, /<path d="M4,4l1,0/);
  assert.doesNotMatch(first, /(?:href|src)=/);
  assert.notEqual(first, second);
});
