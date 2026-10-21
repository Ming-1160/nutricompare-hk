import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCatalogue,mergeLabelSources} from '../catalogue.mjs';
import {enrichCatalogue,hasNutrition,barcodeKey} from '../enrichment.mjs';
import {filterProducts,nutritionFor,getAllergenAssessment} from '../engine.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name,import.meta.url),'utf8'));
const local=read('hk-nutrition-expansion.json'),off=read('off-nutrition-library.json');
const base=buildCatalogue(mergeLabelSources(read('products.json'),read('off-hk-labels.json')),read('pricewatch-foods.json'),read('pricewatch-meta.json'));
const original=JSON.stringify(base);
const data=enrichCatalogue(base,local,off),products=data.products;
const byId=id=>products.find(p=>p.id===id);

test('priced coverage and separate unpriced nutrition library are counted without duplicate barcodes',()=>{
  assert.equal(data.enrichment.pricedCount,1788);
  assert.equal(data.enrichment.pricedNutrition,228);
  assert.equal(data.enrichment.added,1267);
  assert.equal(data.enrichment.nutritionCount,1495);
  assert.equal(data.enrichment.explicitBasis,789);
  assert.equal(products.length,3055);
  assert.equal(new Set(products.map(p=>p.id)).size,3055);
  assert.equal(JSON.stringify(base),original,'source catalogue not mutated');
  assert.equal(products.reduce((n,p)=>n+p.prices.length,0),4496);
  const existing=new Set(products.filter(p=>p.libraryGroup==='priced').map(p=>barcodeKey(p.barcode)).filter(Boolean));
  for(const p of products.filter(p=>p.libraryGroup==='off-library')){
    assert.equal(p.prices.length,0,p.id);
    assert.equal(p.origin,null,p.id);
    assert.ok(!existing.has(barcodeKey(p.barcode)),p.id);
  }
});
test('all previously reviewed nutrition, full statements and merchant prices survive expansion exactly',()=>{
  for(const old of base.products){
    const current=byId(old.id);
    assert.deepEqual(current.prices,old.prices,old.id);
    if(hasNutrition(old))assert.deepEqual(current.nutrition,old.nutrition,old.id);
    if(old.allergens.status==='complete')assert.deepEqual(current.allergens,old.allergens,old.id);
  }
  assert.equal(byId('P000000015').nutrition.fat,null);
  assert.equal(byId('P000000130').nutrition.sodiumMg,55.0847);
  assert.match(byId('P000001302').ingredients,/BLUEBERRIES/);
  assert.equal(byId('P000001302').allergens.status,'unknown','ingredient text alone never completes allergy evidence');
});
test('unknown basis can display original per100 reference values but never portion arithmetic or ranking',()=>{
  const sample=products.find(p=>p.nutrition.referenceBasis==='100g-or-100ml'&&Number.isFinite(p.nutrition.sugars));
  assert.ok(sample);
  assert.equal(nutritionFor(sample).sugars,sample.nutrition.sugars);
  assert.equal(nutritionFor(sample).referenceOnly,true);
  assert.equal(nutritionFor(sample,'portion',20).sugars,null);
  const known={id:'known',nutrition:{basisUnit:'g',basisAmount:100,sugars:100}};
  assert.deepEqual(filterProducts([sample,known],{sort:'sugar-asc'}).map(p=>p.id),['known',sample.id]);
  assert.equal(filterProducts([sample],{dataScope:'comparable'}).length,0);
});
test('community nutrition does not add any allergy matches, local complete cereal statements preserve may-contain milk',()=>{
  for(const p of products.filter(p=>p.libraryGroup==='off-library')){
    assert.equal(p.allergens.status,'unknown',p.id);
    assert.equal(getAllergenAssessment(p,['peanuts']).status,'unknown',p.id);
    assert.equal(p.nutrition.hkLabelVerified,false,p.id);
  }
  assert.equal(products.filter(p=>p.allergens.status==='complete').length,37);
  assert.equal(filterProducts(products,{allergens:['milk']}).length,8);
  assert.equal(filterProducts(products,{allergens:['peanuts']}).length,26);
  assert.equal(filterProducts(products,{allergens:['peanuts'],budget:20}).length,16);
  assert.equal(getAllergenAssessment(byId('P000003491'),['milk']).status,'conflict');
  assert.equal(getAllergenAssessment(byId('P000003314'),['milk']).status,'conflict');
});
test('budget and library scope do not give expanded references invented HK prices or stores',()=>{
  assert.equal(filterProducts(products,{libraryScope:'priced'}).length,1788);
  assert.equal(filterProducts(products,{libraryScope:'off-library'}).length,1267);
  assert.equal(filterProducts(products,{libraryScope:'off-library',budget:10000}).length,0);
  assert.equal(filterProducts(products,{libraryScope:'off-library',store:'WELLCOME'}).length,0);
});
test('audited variant conflicts, test records, alcohol and supplements stay outside imported OFF candidates',()=>{
  assert.equal(off.matches.length,134);
  assert.equal(off.expansion.length,1299);
  for(const id of off.metadata.auditHeldIds)assert.ok(!off.matches.some(p=>p.id===id),id);
  for(const code of off.metadata.auditExcludedExpansion)assert.ok(!off.expansion.some(p=>p.barcode===code),code);
  for(const p of off.matches)assert.ok(p.identityEvidence.independentTotalPackConsistent,p.id);
});
test('HKNA secondary values never supply missing carbohydrate or use school classifications as patient advice',()=>{
  const samples=products.filter(p=>p.nutritionSourceFamily==='hkna-reference');
  assert.equal(samples.length,37);
  for(const p of samples){
    assert.equal(p.nutrition.carbohydrates,null,p.id);
    assert.equal(p.nutrition.protein,null,p.id);
    assert.equal(p.allergens.status,'partial',p.id);
    assert.ok(p.sources.some(s=>/hkna.org.hk/.test(s.url)),p.id);
  }
  const cereal=byId('P000003491');
  assert.ok(Math.abs(nutritionFor(cereal,'portion',30).carbohydrates-23)<0.001);
});
