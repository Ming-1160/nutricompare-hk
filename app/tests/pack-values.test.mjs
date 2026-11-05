import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue } from '../catalogue.mjs';
import { filterProducts, getMinPrice } from '../engine.mjs';
import { getPackSpec, getPackPrices, getPackNutrition } from '../pack-values.mjs';

const data = filename => JSON.parse(readFileSync(new URL(`../data/${filename}`, import.meta.url), 'utf8'));
const catalogue = buildCatalogue(data('products.json'), data('pricewatch-foods.json'), data('pricewatch-meta.json'));
const product = id => catalogue.products.find(row => row.id === id);

test('Indomie five-pack: HK$15 whole pack governs the store and budget filters', () => {
  const item = product('P000000939');
  const wholePrice = getMinPrice(item, { store:'PARKNSHOP' });
  const pack = getPackPrices(item, wholePrice);
  assert.equal(wholePrice, 15);
  assert.deepEqual(pack, {
    unit:'g', totalAmount:425, innerAmount:85, innerCount:5, source:'product-name',
    wholePrice:15, per100:15 / 425 * 100, perInner:3,
  });
  assert.equal(pack.per100.toFixed(2), '3.53');
  assert.deepEqual(filterProducts([item], { store:'PARKNSHOP', budget:10 }), []);
  assert.deepEqual(filterProducts([item], { store:'PARKNSHOP', budget:15 }), [item]);
  assert.equal(getPackNutrition(item).whole, null);
  assert.equal(getPackPrices({ ...item, offers:[{ textEn:'Buy 3 at $9' }] }, wholePrice).perInner, 3);
});

test('90g Demae Ramen uses 52.7g carbs per pack, preserving the distinct per-100g value', () => {
  const item = product('P000000014');
  const pack = getPackNutrition(item);
  assert.equal(item.nutrition.carbohydrates, 58.5556);
  assert.equal(pack.totalAmount, 90);
  assert.equal(pack.whole.carbohydrates, item.sourceNutrition.carbohydrates);
  assert.equal(pack.whole.carbohydrates, 52.7);
  assert.equal(pack.whole.sodiumMg, 1251);
  assert.equal(pack.whole.fibre, null);
  assert.equal(pack.inner, null);
  assert.equal(getPackNutrition(product('P000000015')).whole.fat, null);
});

test('declared bottle size and count produce distinct whole-pack and inner values', () => {
  const item = product('P000001260');
  const pack = getPackNutrition(item);
  assert.deepEqual(getPackSpec(item), { unit:'ml', totalAmount:1500, innerAmount:250, innerCount:6, source:'structured' });
  assert.equal(pack.whole.carbohydrates, 72);
  assert.equal(pack.inner.carbohydrates, 12);
  assert.equal(getPackPrices(item, 23).per100.toFixed(2), '1.53');
  assert.equal(getPackPrices(item, 23).perInner.toFixed(2), '3.83');
  const perPacket = { packSize:'0.18kg (30g x 6)', nutrition:{ basisUnit:'g', basisAmount:30, carbohydrates:12, sugars:0 } };
  assert.equal(getPackNutrition(perPacket).whole.carbohydrates, 72);
  assert.equal(getPackNutrition(perPacket).inner.sugars, 0);
  assert.equal(getPackSpec({ packSize:'３ × １公升' }).totalAmount, 3000);
});

test('unclear amounts, conflicting declarations and serving-only information cannot supply unit rates', () => {
  const rows = [
    { id:'P000000001', nameZh:'試食 85克或 100克', nameEn:'Sample 85g or 100g' },
    { id:'P000000001', nameZh:'飲品 250毫升 x 6', nameEn:'Drink 250ml x 5' },
    { id:'P000000001', nameZh:'飲品 250毫升', nameEn:'Drink 250g' },
    { id:'P000000001', nameEn:'Random weight 200g' },
    { id:'P000000001', nameZh:'產品每100克', nameEn:'Product per 100g' },
    { packSize:'80g x 5', quantity:80, quantityUnit:'g' },
    { packSize:'200g (80g x 5)' },
    { packSize:'20g + 80g' },
    { packSize:'2 x 3 x 80g' },
    { packSize:'6 slices', servingSize:30 },
    { servingSize:80, nutrition:{ basisUnit:'g', basisAmount:100, carbohydrates:42 }, offers:[{ textEn:'Buy 2 for $10' }] },
  ];
  for (const row of rows) {
    const result = getPackPrices(row, 15);
    assert.equal(result.wholePrice, 15, JSON.stringify(row));
    assert.equal(result.per100, null, JSON.stringify(row));
    assert.equal(result.perInner, null, JSON.stringify(row));
  }
  const countOnly = { id:'P000000001', nameZh:'飲品 250毫升', nameEn:'Drink 5-pack' };
  assert.equal(getPackPrices(countOnly, 15).per100, null);
  assert.equal(getPackPrices(countOnly, 15).perInner, 3);
  assert.equal(getPackPrices({ packSize:'300g' }, null).per100, null);
});

test('nutrition is withheld when the unit, preparation, assortment or formulation does not match', () => {
  const item = { packSize:'80g x 5', nutrition:{ basisUnit:'g', basisAmount:100, carbohydrates:42 } };
  const variants = [
    { ...item, nutrition:{ ...item.nutrition, basisUnit:'ml' } },
    { ...item, nutrition:{ ...item.nutrition, basisAmount:null } },
    { ...item, nutrition:{ ...item.nutrition, sourceBasisUnknown:true } },
    { ...item, nutrition:{ ...item.nutrition, basis:'as-prepared' } },
    { ...item, nutrition:{ ...item.nutrition, conversionNote:'Nutrition per 100g after cooking' } },
    { ...item, sourceNutrition:{ basis:'沖調後每100克' } },
    { ...item, nameEn:'Assorted flavours' },
    { ...item, dataStatus:'overseas-reference' },
    { ...item, dataStatus:'partial-reference' },
  ];
  for (const row of variants) {
    assert.equal(getPackNutrition(row).whole, null, JSON.stringify(row));
    assert.equal(getPackNutrition(row).inner, null, JSON.stringify(row));
    assert.equal(getPackPrices(row, 15).perInner, 3, JSON.stringify(row));
  }
});
