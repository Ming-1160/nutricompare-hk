import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue, mergeLabelSources } from '../catalogue.mjs';
import { enrichCatalogue } from '../enrichment.mjs';
import { applyHkLabelReview } from '../hk-labels.mjs';
import { nutritionFor } from '../engine.mjs';
import { findAlternatives, getComparisonPackNutrition, getNutrientEvidence, getNutritionSourceLabel } from '../nutrition-evidence.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const curated = mergeLabelSources(read('products'), read('off-hk-labels'));
const priced = buildCatalogue(curated, read('pricewatch-foods'), read('pricewatch-meta'));
let catalogue = enrichCatalogue(priced, read('hk-nutrition-expansion'), read('off-nutrition-library'));
for (const file of ['hk-reviewed-labels', 'off-hk-reviewed-labels', 'hk-reviewed-labels-extra', 'off-hk-reviewed-labels-extra']) {
  catalogue = applyHkLabelReview(catalogue, read(file));
}
const byId = id => catalogue.products.find(product => product.id === id);

test('A2: the five-pack and single-pack sesame Demae Ramen compare on one 91g pack each', () => {
  const multi = getComparisonPackNutrition(byId('P000001128'));
  const single = getComparisonPackNutrition(byId('P000000015'));
  assert.equal(multi.isInner, true);
  assert.equal(multi.innerCount, 5);
  assert.equal(single.isInner, false);
  for (const pack of [multi, single]) {
    assert.equal(pack.amount, 91);
    assert.equal(pack.unit, 'g');
    assert.equal(pack.values.carbohydrates, 53.8);
  }
  assert.equal(single.values.fat, null);
  assert.equal(getComparisonPackNutrition(byId('P000000939')).values, null);
});

test('A4: community, reviewed Hong Kong, overseas and unreviewed records retain distinct source badges', () => {
  assert.equal(getNutritionSourceLabel(byId('P000000939')), 'OFF 社群參考');
  assert.equal(getNutritionSourceLabel(byId('P000000014')), '香港標籤已讀');
  assert.equal(getNutritionSourceLabel(byId('P000000927')), '海外配方參考');
  assert.equal(getNutritionSourceLabel(byId('P000003983')), '標籤待補');
});

test('B2: Demae Ramen carbohydrate traces from 52.7g per 90g to 58.6g per 100g', () => {
  const item = byId('P000000014');
  const evidence = getNutrientEvidence(item, 'carbohydrates', nutritionFor(item));
  assert.equal(evidence.source.type, '香港官網');
  assert.match(evidence.source.label, /香港日清官方/);
  assert.match(evidence.source.url, /^https:\/\/www\.nissinfoods\.com\.hk\//);
  assert.equal(evidence.source.checkedAt, '2026-10-21');
  assert.equal(evidence.original.amount, 90);
  assert.equal(evidence.original.unit, 'g');
  assert.equal(evidence.original.value, 52.7);
  assert.equal(evidence.displayed.amount, 100);
  assert.equal(evidence.displayed.value.toFixed(1), '58.6');
  assert.equal(evidence.converted, true);
  assert.equal(getNutrientEvidence(item, 'carbohydrates', getComparisonPackNutrition(item).values).converted, false);
  const missing = getNutrientEvidence(item, 'fibre', nutritionFor(item));
  assert.equal(missing.original, null);
  assert.equal(missing.displayed.value, null);
  assert.match(missing.reason, /冇來源數值.*冇提供/);
});

test('B2: an unresolved source conflict stays unknown, with both URLs and declared values', () => {
  const item = byId('P000001141');
  const evidence = getNutrientEvidence(item, 'sodiumMg', nutritionFor(item));
  assert.equal(evidence.displayed.value, null);
  assert.equal(evidence.converted, null);
  assert.match(evidence.reason, /唔一致/);
  assert.deepEqual(evidence.conflictSources.map(source => source.value), [9255, 8500]);
  assert.ok(evidence.conflictSources.every(source => source.url.startsWith('https://')));
  const pasta = byId('P000000015');
  const ownLabel = getNutrientEvidence(pasta, 'saturatedFat', nutritionFor(pasta));
  assert.match(ownLabel.reason, /互相矛盾/);
  assert.equal(ownLabel.displayed.value, null);
});

test('B2: source evidence distinguishes HKNA, local label images and community records', () => {
  const hkna = byId('P000002528');
  const energy = getNutrientEvidence(hkna, 'energyKcal', nutritionFor(hkna));
  assert.match(energy.source.type, /HKNA/);
  assert.equal(energy.original.amount, 236);
  assert.equal(energy.original.value, 168);
  assert.equal(energy.converted, true);
  const cracker = byId('P000004227');
  const incompleteEnergy = getNutrientEvidence(cracker, 'energyKcal', nutritionFor(cracker));
  assert.equal(incompleteEnergy.original, null);
  assert.equal(incompleteEnergy.converted, true);
  assert.match(incompleteEnergy.reason, /19g 小包/);
  const retailer = byId('P000000298');
  assert.equal(getNutrientEvidence(retailer, 'sodiumMg', nutritionFor(retailer)).source.type, '香港零售商標籤圖');
  const off = byId('P000000939');
  assert.equal(getNutrientEvidence(off, 'sugars', nutritionFor(off)).source.type, 'OFF 社群參考');
  const offSodium = getNutrientEvidence(off, 'sodiumMg', nutritionFor(off));
  assert.equal(offSodium.original.valueUnit, 'g');
  assert.equal(offSodium.displayed.valueUnit, 'mg');
  assert.equal(offSodium.converted, true);
  const gum = byId('P000003311');
  const gumEnergy = getNutrientEvidence(gum, 'energyKcal', nutritionFor(gum));
  assert.equal(gumEnergy.original.valueUnit, 'kJ');
  assert.equal(gumEnergy.original.value, 1102);
  assert.equal(gumEnergy.converted, true);
  const realZero = getNutrientEvidence(gum, 'sugars', nutritionFor(gum));
  assert.equal(realZero.original.value, 0);
  assert.equal(realZero.displayed.value, 0);
});

test('B3: the real bowl noodle example includes the matching Wellcome prices and 20%+ sodium reduction', () => {
  const item = byId('P000000304');
  const options = findAlternatives(item, catalogue.products);
  const replacement = options.find(option => option.product.id === 'P000000298');
  assert.ok(replacement);
  assert.equal(replacement.store, 'WELLCOME');
  assert.equal(replacement.originalPrice, 10);
  assert.equal(replacement.alternativePrice, 8.5);
  assert.equal(replacement.unit, 'g');
  assert.equal(replacement.metrics[0].key, 'sodiumMg');
  assert.equal(Math.round(replacement.metrics[0].originalValue), 2092);
  assert.equal(Math.round(replacement.metrics[0].value), 1602);
  assert.ok(replacement.metrics[0].reduction >= .2);
  assert.ok(options.length <= 3);
  assert.ok(options.every(option => JSON.stringify(option.product.sourceCategory.pathZh) === JSON.stringify(item.sourceCategory.pathZh)));
});

test('B3: each failed criterion independently excludes a replacement; exact thresholds qualify', () => {
  const item = byId('P000000304');
  const accepted = { ...byId('P000000298'), prices:[{ store:'WELLCOME', price:8 }],
    nutrition:{ ...item.nutrition, sodiumMg:80, sugars:null },
    allergens:{ status:'complete', contains:[], mayContain:[] } };
  const baseline = { ...item, nutrition:{ ...item.nutrition, sodiumMg:100, sugars:null } };
  assert.equal(findAlternatives(baseline, [accepted], ['peanuts']).length, 1);
  const variants = [
    { sourceCategory:{ pathZh:['即食麵 / 快熟粉', '包裝'] } },
    { sourceCategory:{ pathZh:['其他', item.sourceCategory.pathZh.at(-1)] } },
    { nutrition:{ ...accepted.nutrition, hkLabelVerified:false } },
    { nutrition:{ ...accepted.nutrition, basisUnit:'ml' } },
    { nutrition:{ ...accepted.nutrition, sodiumMg:null } },
    { nutrition:{ ...accepted.nutrition, sodiumMg:80.1 } },
    { prices:[{ store:'AEON', price:10 }] },
    { prices:[{ store:'WELLCOME', price:7.99 }] },
    { allergens:{ ...accepted.allergens, contains:['peanuts'] } },
    { allergens:{ ...accepted.allergens, mayContain:['peanuts'] } },
    { allergens:{ ...accepted.allergens, status:'partial' } },
  ];
  for (const variant of variants) assert.deepEqual(findAlternatives(baseline, [{ ...accepted, ...variant }], ['peanuts']), [], JSON.stringify(variant));
  assert.deepEqual(findAlternatives({ ...baseline, nutrition:{ ...baseline.nutrition, hkLabelVerified:false } }, [accepted]), []);
  assert.deepEqual(findAlternatives({ ...baseline, nutrition:{ ...baseline.nutrition, sodiumMg:null } }, [accepted]), []);
  const lowerSugar = findAlternatives({ ...baseline, nutrition:{ ...baseline.nutrition, sodiumMg:null, sugars:10 } }, [
    { ...accepted, nutrition:{ ...accepted.nutrition, sodiumMg:null, sugars:0 } },
  ]);
  assert.deepEqual(lowerSugar[0].metrics, [{ key:'sugars', originalValue:10, value:0, reduction:1 }]);
});
