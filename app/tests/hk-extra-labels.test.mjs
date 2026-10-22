import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCatalogue,mergeLabelSources} from '../catalogue.mjs';
import {enrichCatalogue,barcodeKey} from '../enrichment.mjs';
import {applyHkLabelReview,hasReviewedHkNutrition} from '../hk-labels.mjs';
import {nutritionFor,getAllergenAssessment,filterProducts,ALLERGENS} from '../engine.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name,import.meta.url),'utf8'));
let previous=enrichCatalogue(buildCatalogue(mergeLabelSources(read('products.json'),read('off-hk-labels.json')),read('pricewatch-foods.json'),read('pricewatch-meta.json')),read('hk-nutrition-expansion.json'),read('off-nutrition-library.json'));
for(const f of ['hk-reviewed-labels.json','off-hk-reviewed-labels.json'])previous=applyHkLabelReview(previous,read(f));
const extra=read('hk-reviewed-labels-extra.json'),offExtra=read('off-hk-reviewed-labels-extra.json');
const data=applyHkLabelReview(applyHkLabelReview(previous,extra),offExtra);
const byId=id=>data.products.find(p=>p.id===id);

test('additional original HK labels never create new catalogue products, prices or duplicate nutrition-library barcodes',()=>{
  const old=new Map(previous.products.filter(p=>p.libraryGroup!=='off-library').map(p=>[p.id,p]));
  assert.equal(old.size,1788);
  assert.equal(data.products.filter(p=>p.libraryGroup!=='off-library').length,1788);
  assert.equal(data.products.reduce((s,p)=>s+p.prices.length,0),4496);
  for(const row of extra.products){
    assert.ok(old.has(row.id),row.id);assert.deepEqual(byId(row.id).prices,old.get(row.id).prices,row.id);
    assert.ok(hasReviewedHkNutrition(byId(row.id)),row.id);
    for(const allergen of ALLERGENS)if(getAllergenAssessment(old.get(row.id),[allergen]).status==='conflict')assert.equal(getAllergenAssessment(byId(row.id),[allergen]).status,'conflict',row.id+':prior-'+allergen);
  }
  const priced=new Set(data.products.filter(p=>p.libraryGroup!=='off-library').map(p=>barcodeKey(p.barcode)).filter(Boolean));
  for(const p of data.products.filter(p=>p.libraryGroup==='off-library'))assert.ok(!priced.has(barcodeKey(p.barcode)),p.id);
});
test('Fuku five-pack nutrients stay per90g inner pack, not multiplied into a five-pack serving',()=>{
  const p=byId('P000000114');
  assert.equal(p.nutrition.basisAmount,90);assert.equal(p.nutrition.energyKcal,407);assert.equal(p.nutrition.sodiumMg,1944);
  assert.ok(Math.abs(nutritionFor(p).sodiumMg-2160)<0.001);
  assert.equal(nutritionFor(p,'portion',90).energyKcal,407);
  assert.equal(getAllergenAssessment(p,['peanuts']).status,'conflict');
});
test('dessert440g uses labelled220g serving and retains coconut separately from an explicit tree-nut declaration',()=>{
  const p=byId('P000003313');
  assert.equal(p.nutrition.basisAmount,220);assert.equal(p.sourceNutrition.energyKcal,241);
  assert.ok(Math.abs(nutritionFor(p).sugars-23.3/2.2)<0.001);
  assert.ok(p.allergens.additionalAllergens.includes('coconut'));
  assert.equal(getAllergenAssessment(p,['tree-nuts']).status,'conflict');
});
test('ingredients add sesame exclusions even when the official headline allergy statement lists only soy',()=>{
  for(const id of ['P000001942','P000000396']){
    const p=byId(id);assert.match(p.ingredients,/芝麻油/);
    assert.equal(getAllergenAssessment(p,['sesame']).status,'conflict');
  }
  const tofu=byId('P000003124');
  assert.equal(tofu.allergens.status,'partial');
  assert.equal(filterProducts([tofu],{allergens:['milk']}).length,0);
});
test('new HK tables have explicit native units and keep unavailable nutrients unknown',()=>{
  for(const row of extra.products){
    assert.ok(['g','ml'].includes(row.nutrition.basisUnit),row.id);
    assert.ok(row.nutrition.basisAmount>0,row.id);
    for(const key of ['energyKcal','carbohydrates','sugars','protein','fat','saturatedFat','transFat','sodiumMg','fibre']){
      const n=row.nutrition[key];assert.ok(n===null||n===undefined||Number.isFinite(n)&&n>=0,row.id+':'+key);
    }
    assert.equal(row.physicalPackChecked,false,row.id);
    assert.ok(row.sources.every(s=>s.url.startsWith('https://')),row.id);
  }
});
test('HK sugar-free gum retains polyol carbohydrate, real kJ conversion, source warnings and partial allergy status',()=>{
  const p=byId('P000003311');
  assert.equal(p.nutrition.sugars,0);assert.equal(p.nutrition.carbohydrates,64.8);
  assert.ok(Math.abs(p.nutrition.energyKcal-1102/4.184)<0.000001);
  assert.equal(p.sourceNutrition.energyKj,1102);
  assert.ok(p.additionalWarnings.some(w=>/phenylalanine/.test(w)));
  assert.ok(p.additionalWarnings.some(w=>/laxative/.test(w)));
  assert.equal(p.allergens.status,'partial');assert.equal(filterProducts([p],{allergens:['peanuts']}).length,0);
  assert.ok(p.labelImages.every(image=>image.author&&image.licenseUrl));
});
