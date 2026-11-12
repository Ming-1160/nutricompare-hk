import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLERGENS, getAllergenAssessment, nutritionFor } from '../engine.mjs?v=110';
import { buildCatalogue, mergeLabelSources } from '../catalogue.mjs?v=110';
import { enrichCatalogue } from '../enrichment.mjs?v=110';
import { applyHkLabelReview, hkLabelCoverage } from '../hk-labels.mjs?v=110';
import {
  DATA_FILES, LABEL_FILES, REQUIRED_FILE, OFF_LABEL_FILE, PRICE_FILES, HK_EXPANSION_FILE, OFF_LIBRARY_FILE, REVIEW_FILES,
  assembleDataset, comparingPaused, describeMissing, fetchJson, loadDataFiles, resultsHold,
} from '../data-loader.mjs?v=110';

const dataDirectory = new URL('../data/', import.meta.url);
const files = new Map(DATA_FILES.map(name => [name, JSON.parse(readFileSync(new URL(name, dataDirectory), 'utf8'))]));
const without = (...names) => new Map([...files].filter(([name]) => !names.includes(name)));
const passes = (product, allergen) => getAllergenAssessment(product, [allergen]).status === 'no-listed-match';

const full = assembleDataset(files);
const fullById = new Map(full.dataset.products.map(product => [product.id, product]));

test('with every file, the catalogue is exactly what the previous loader built', () => {
  let expected = buildCatalogue(mergeLabelSources(files.get(REQUIRED_FILE), files.get(OFF_LABEL_FILE)), files.get(PRICE_FILES[0]), files.get(PRICE_FILES[1]));
  expected = enrichCatalogue(expected, files.get(HK_EXPANSION_FILE), files.get(OFF_LIBRARY_FILE));
  for (const name of REVIEW_FILES) expected = applyHkLabelReview(expected, files.get(name));
  assert.equal(full.fatal, false);
  assert.deepEqual(full.missing, []);
  assert.deepEqual(full.dataset.products, expected.products);
  assert.equal(describeMissing(full.missing), null);
});

test('rebuilding from the same files gives the same catalogue and leaves the files untouched', () => {
  const before = JSON.stringify([...files]);
  const again = assembleDataset(files);
  assert.deepEqual(again.dataset.products, full.dataset.products);
  assert.equal(JSON.stringify([...files]), before);
});

test('the site cannot start without the core product file', () => {
  const result = assembleDataset(without(REQUIRED_FILE));
  assert.equal(result.fatal, true);
  assert.equal(result.dataset, null);
  assert.ok(result.missing.includes(REQUIRED_FILE));
  assert.equal(assembleDataset(new Map()).fatal, true);
});

const NUTRIENT_KEYS = ['energyKcal', 'carbohydrates', 'sugars', 'fat', 'saturatedFat', 'transFat', 'protein', 'fibre', 'sodiumMg'];
const knownFigure = value => value !== null && value !== undefined && Number.isFinite(Number(value));
/** Foods (also in the full catalogue) that show a figure the full catalogue does not show for them. */
function foodsWithOtherFigures(loaded) {
  return assembleDataset(loaded).dataset.products.filter(product => {
    const reference = fullById.get(product.id);
    if (!reference) return false;
    const shown = nutritionFor(product) ?? {};
    const expected = nutritionFor(reference) ?? {};
    return NUTRIENT_KEYS.some(key => knownFigure(shown[key]) && (!knownFigure(expected[key]) || Number(shown[key]) !== Number(expected[key])));
  }).length;
}

test('the Hong Kong nutrition file is used without the OFF library, but the library never stands in for it', () => {
  const coverage = loaded => hkLabelCoverage(assembleDataset(loaded).dataset.products);
  const all = coverage(files);
  const neither = coverage(without(HK_EXPANSION_FILE, OFF_LIBRARY_FILE));
  const noOffLibrary = coverage(without(OFF_LIBRARY_FILE));
  assert.equal(all.original, 1788);
  assert.equal(noOffLibrary.original, 1788);
  // Before v1.10 a missing OFF library also discarded the Hong Kong file (the "neither" figure).
  assert.ok(noOffLibrary.anyNutrition > neither.anyNutrition, 'HK expansion still applied');
  assert.ok(all.anyNutrition >= noOffLibrary.anyNutrition);
  // Human-read HK label reviews do not depend on the community library.
  assert.equal(noOffLibrary.reviewedNutrition, all.reviewedNutrition);
  assert.equal(noOffLibrary.completeAllergy, all.completeAllergy);
  // The reverse is refused: Hong Kong figures outrank the library, so without them the library is not applied alone.
  assert.deepEqual(assembleDataset(without(HK_EXPANSION_FILE)).dataset.products,
    assembleDataset(without(HK_EXPANSION_FILE, OFF_LIBRARY_FILE)).dataset.products);
});

test('every state that still lists foods shows the complete catalogue\'s figures or "unknown", never a different figure', () => {
  // Foods are listed only while no label file is missing. That leaves the nutrition reference and price files:
  // every combination of those four being missing is checked here.
  const listable = [HK_EXPANSION_FILE, OFF_LIBRARY_FILE, ...PRICE_FILES];
  let states = 0;
  for (let mask = 1; mask < 2 ** listable.length; mask++) {
    const dropped = listable.filter((_, index) => mask & (1 << index));
    assert.equal(resultsHold(dropped, []), '', `foods are listed without ${dropped.join(' + ')}`);
    assert.equal(foodsWithOtherFigures(without(...dropped)), 0, `without ${dropped.join(' + ')}`);
    states++;
  }
  assert.equal(states, 15);
});

test('with a label file missing some foods would show other figures, so nothing is listed at all', () => {
  assert.equal(LABEL_FILES.length, 5);
  // The reason for the rule, measured on the data: every label file changes at least one food's figures or statement.
  for (const name of LABEL_FILES) {
    const subset = assembleDataset(without(name)).dataset.products;
    const changed = subset.filter(product => {
      const reference = fullById.get(product.id);
      return reference && (JSON.stringify(nutritionFor(product)) !== JSON.stringify(nutritionFor(reference)) || JSON.stringify(product.allergens) !== JSON.stringify(reference.allergens));
    }).length;
    assert.ok(changed > 0, `${name} changes ${changed} foods`);
    assert.equal(resultsHold([name], []), 'labels', name);
    assert.equal(resultsHold([name], ['milk']), 'labels', name);
    assert.equal(describeMissing([name]).labelsMissing, true);
    assert.match(describeMissing([name]).message, /暫時唔顯示食品/);
    assert.match(describeMissing([name]).note, /直接睇包裝上嘅標籤/);
  }
  assert.ok(foodsWithOtherFigures(without(REVIEW_FILES[0])) > 0, 'a missing review file really does leave different figures');
  // A label file together with anything else is still a full hold.
  assert.equal(resultsHold([OFF_LIBRARY_FILE, REVIEW_FILES[3]], []), 'labels');
  assert.equal(describeMissing([OFF_LIBRARY_FILE]).labelsMissing, false);
  assert.doesNotMatch(describeMissing([OFF_LIBRARY_FILE, HK_EXPANSION_FILE]).message, /暫時唔顯示食品/);
});

test('prices need both price files, and the notice says so plainly', () => {
  for (const name of PRICE_FILES) {
    const result = assembleDataset(without(name));
    assert.equal(result.fatal, false);
    assert.equal(result.priced, false);
    assert.ok(result.dataset.products.filter(product => product.libraryGroup !== 'off-library').length < 100);
    const summary = describeMissing(result.missing);
    assert.equal(summary.pricesMissing, true);
    assert.match(summary.message, /消委會價格目錄未能載入/);
  }
  const labelOnly = describeMissing([REVIEW_FILES[0], OFF_LIBRARY_FILE]);
  assert.equal(labelOnly.pricesMissing, false);
  assert.equal(labelOnly.count, 2);
  assert.deepEqual(labelOnly.kinds, ['營養參考資料', '標籤及過敏資料']);
  assert.match(labelOnly.message, /有 2 份資料未能載入/);
  const nutritionOnly = describeMissing([OFF_LIBRARY_FILE]);
  assert.match(nutritionOnly.message, /有 1 份資料未能載入（營養參考資料）。部分食品嘅營養數字同過敏資料會顯示為未知。/);
  assert.match(nutritionOnly.note, /唔會顯示過敏篩選結果，亦暫停比較/);
});

test('allergy hold: with any file missing, results for a person avoiding allergens are held back', () => {
  for (const name of DATA_FILES) assert.notEqual(resultsHold([name], ['peanuts']), '', name);
  for (const name of [HK_EXPANSION_FILE, OFF_LIBRARY_FILE, ...PRICE_FILES]) assert.equal(resultsHold([name], ['peanuts']), 'allergy', name);
  assert.equal(resultsHold([OFF_LIBRARY_FILE, PRICE_FILES[0]], ['milk', 'eggs']), 'allergy');
  // Nothing missing: no hold, whatever is chosen. A reference file missing and no allergen chosen: foods are listed.
  assert.equal(resultsHold([], ['peanuts']), '');
  assert.equal(resultsHold([OFF_LIBRARY_FILE], []), '');
  assert.equal(resultsHold(), '');
});

test('comparing is paused whenever any file is missing', () => {
  for (const name of DATA_FILES) assert.equal(comparingPaused([name]), true, name);
  assert.equal(comparingPaused([]), false);
  assert.equal(comparingPaused(), false);
});

test('second check on the data: in all 511 combinations of missing files, no food passes an allergen filter that it fails with all files', () => {
  // The page does not rely on this (it holds results back whenever a file is missing). It is here so that a future
  // data change which would break the property is noticed.
  const optional = DATA_FILES.filter(name => name !== REQUIRED_FILE);
  assert.equal(optional.length, 9);
  // Fingerprint of everything the allergy decision reads, so identical records are only assessed once.
  const verdicts = new Map();
  const passSet = product => {
    const key = JSON.stringify([product.allergens, product.ingredients, product.ingredientsSummary, product.additionalWarnings]);
    if (!verdicts.has(key)) verdicts.set(key, ALLERGENS.filter(allergen => passes(product, allergen)));
    return verdicts.get(key);
  };
  const fullPasses = new Map([...fullById].map(([id, product]) => [id, new Set(passSet(product))]));
  // Either price file missing gives the same catalogue, so the 511 combinations fall into 255 different catalogues.
  const seen = new Set();
  let combinations = 0;
  let foodsOnlyInSubsets = 0;
  for (let mask = 1; mask < 2 ** optional.length; mask++) {
    const dropped = optional.filter((_, index) => mask & (1 << index));
    combinations++;
    const state = JSON.stringify([PRICE_FILES.some(name => dropped.includes(name)), ...optional.filter(name => !PRICE_FILES.includes(name)).map(name => dropped.includes(name))]);
    if (seen.has(state)) continue;
    seen.add(state);
    const result = assembleDataset(without(...dropped));
    assert.equal(result.fatal, false);
    for (const product of result.dataset.products) {
      const reference = fullPasses.get(product.id);
      if (!reference) {
        // A food that only exists with files missing has no full record to compare with, so it must pass nothing.
        foodsOnlyInSubsets++;
        assert.deepEqual(passSet(product), [], `${product.id} only exists without ${dropped.join(', ')} and would pass an allergen filter`);
        continue;
      }
      for (const allergen of passSet(product)) {
        assert.ok(reference.has(allergen), `${product.id} would pass "${allergen}" without ${dropped.join(', ')}`);
      }
    }
  }
  assert.equal(combinations, 511);
  assert.equal(seen.size, 255);
  assert.ok(foodsOnlyInSubsets > 0, 'the check really met foods that only exist with files missing');
});

test('files are fetched together, failures are reported, and a retry only asks for what is missing', async () => {
  const calls = [];
  let libraryAttempts = 0;
  const read = async name => {
    calls.push(name);
    if (name === OFF_LIBRARY_FILE && libraryAttempts++ === 0) throw new Error('HTTP 503');
    if (name === REVIEW_FILES[1]) return null;
    return files.get(name);
  };
  const first = await loadDataFiles(read);
  assert.equal(calls.length, DATA_FILES.length);
  assert.deepEqual(first.failures.map(failure => failure.file).sort(), [OFF_LIBRARY_FILE, REVIEW_FILES[1]].sort());
  assert.equal(first.failures.find(failure => failure.file === OFF_LIBRARY_FILE).reason, 'HTTP 503');
  const degraded = assembleDataset(first.loaded);
  assert.deepEqual(degraded.missing.sort(), [OFF_LIBRARY_FILE, REVIEW_FILES[1]].sort());

  calls.length = 0;
  const second = await loadDataFiles(async name => { calls.push(name); return files.get(name); }, first.loaded);
  assert.deepEqual(calls.sort(), [OFF_LIBRARY_FILE, REVIEW_FILES[1]].sort());
  assert.deepEqual(second.failures, []);
  assert.deepEqual(assembleDataset(second.loaded).dataset.products, full.dataset.products);
});

test('a request that never answers is abandoned, and HTTP errors are failures', async () => {
  const hanging = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(fetchJson('x.json', { timeoutMs: 20, fetchImpl: hanging }), /no data for/);
  await assert.rejects(fetchJson('x.json', { fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  await assert.rejects(fetchJson('x.json', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), /Failed to fetch/);
  assert.deepEqual(await fetchJson('x.json', { fetchImpl: async () => ({ ok: true, json: async () => ({ products: [] }) }) }), { products: [] });
  // A real Response object is read through its stream.
  assert.deepEqual(await fetchJson('x.json', { fetchImpl: async () => new Response('{"products":[1,2]}') }), { products: [1, 2] });
  await assert.rejects(fetchJson('x.json', { fetchImpl: async () => new Response('<html>not found</html>') }), /JSON|Unexpected/);
});

test('a slow file is not cut off while data keeps arriving, but a stalled one is', async () => {
  const bytes = new TextEncoder().encode('{"名":"餅乾","值":[1,2,3,4,5,6,7,8,9,10,11,12]}');
  // 15 small pieces, 20 ms apart: about 300 ms in total, longer than the 200 ms limit. A piece even cuts a Chinese character in half.
  const pieces = Array.from({ length: 15 }, (_, index) => bytes.slice(index * 4, index === 14 ? bytes.length : (index + 1) * 4));
  const steady = async () => ({ ok: true, body: { getReader() {
    let index = 0;
    return { read: () => new Promise(resolve => setTimeout(() => resolve(index < pieces.length ? { done: false, value: pieces[index++] } : { done: true }), 20)) };
  } } });
  const started = Date.now();
  assert.deepEqual(await fetchJson('slow.json', { timeoutMs: 200, fetchImpl: steady }), { 名: '餅乾', 值: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  assert.ok(Date.now() - started >= 250, 'the transfer really took longer than the limit');

  // Headers arrive, one piece arrives, then nothing: abandoned after the limit, not left hanging.
  const stalled = async (url, { signal }) => ({ ok: true, body: { getReader() {
    let sent = false;
    return { read: () => sent
      ? new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
      : Promise.resolve((sent = true, { done: false, value: pieces[0] })) };
  } } });
  await assert.rejects(fetchJson('stalled.json', { timeoutMs: 40, fetchImpl: stalled }), /no data for/);
});

test('data requests carry no Referer, because the page address can hold the chosen allergens', async () => {
  let options;
  await fetchJson('x.json', { fetchImpl: async (url, init) => { options = init; return { ok: true, json: async () => ({}) }; } });
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.cache, 'no-cache');
  for (const page of ['../../index.html', '../index.html']) {
    assert.match(readFileSync(new URL(page, import.meta.url), 'utf8'), /<meta name="referrer" content="no-referrer">/, page);
  }
});
