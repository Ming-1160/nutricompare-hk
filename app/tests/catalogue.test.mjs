import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {filterProducts,getAllergenAssessment,nutritionFor,getMinPrice} from '../engine.mjs';
const catalogue=JSON.parse(fs.readFileSync(new URL('../data/products.json',import.meta.url),'utf8'));
const products=catalogue.products;
const byId=id=>products.find(p=>p.id===id);

test('every complete allergy record has HK evidence, full ingredients, dated sources and no physical-batch claim',()=>{
  const records=products.filter(p=>p.allergens.status==='complete');
  assert.ok(records.length>=10);
  for(const p of records){
    assert.ok(p.ingredients||p.ingredientsSummary,p.id);
    assert.ok(p.sources.some(s=>s.checkedAt&&s.url.startsWith('https://')),p.id);
    assert.ok(p.allergens.coverage||p.allergens.evidenceScope,p.id);
    assert.equal(p.physicalPackChecked,false,p.id);
    assert.equal(p.labelEvidence.physicalPackChecked??false,false,p.id);
    assert.ok(p.sourceLimit.includes('實物')||p.sourceLimit.includes('包裝'),p.id);
    if(p.labelEvidence.physicalPackPhotoInspected)assert.ok(p.labelImages.length>0,p.id);
  }
});
test('unknown older catalogue entries cannot pass an enabled allergy restriction',()=>{
  const unknown=products.filter(p=>p.allergens.status!=='complete');
  assert.ok(unknown.length>=12);
  assert.equal(filterProducts(unknown,{allergens:['fish']}).length,0);
});
test('milk restriction has real sourced matches but excludes soy drinks and may-contain dairy',()=>{
  const matches=filterProducts(products,{allergens:['milk']});
  assert.ok(matches.some(p=>p.id==='HK-GFHK-SCHAR-DIGESTIVE-150'));
  assert.ok(!matches.some(p=>/VITASOY|P000001260|P000000426|P000000124|VITA-ZERO/.test(p.id)));
  assert.equal(getAllergenAssessment(byId('HK-GFHK-WASA-CRISPBREAD-240'),['milk']).status,'conflict');
});
test('peanut plus HKD20 uses a real inexpensive HK-labelled product, not expensive biscuits or factory warnings',()=>{
  const matches=filterProducts(products,{allergens:['peanuts'],budget:20});
  assert.deepEqual(matches.map(p=>p.id),['P000000124']);
  assert.equal(getAllergenAssessment(byId('HK-GFHK-LEPAIN-BUCKWHEAT-75'),['peanuts']).status,'conflict');
  assert.equal(getAllergenAssessment(byId('HK-VITA-ZERO-LEMON-500'),['peanuts']).status,'conflict');
});
test('HK milk serving arithmetic uses the actual 236ml label and keeps missing fibre unknown',()=>{
  const milk=byId('P000000124');
  assert.equal(milk.quantity,236);
  assert.equal(milk.nutrition.energyKcal,62);
  const n=nutritionFor(milk,'portion',236);
  assert.equal(n.carbohydrates,10.856);
  assert.equal(n.fibre,null);
  assert.equal(getMinPrice(milk,{store:'PARKNSHOP'}),9);
});
test('retailer salt-to-sodium conversions and partial nutrition stay distinct',()=>{
  const cracker=byId('HK-GFHK-TERRASANA-BLACK-SESAME-60');
  assert.equal(cracker.nutrition.sourceSaltG,1.1);
  assert.equal(cracker.nutrition.sodiumMg,440);
  assert.equal(byId('P000004227').nutrition.carbohydrates,null);
});
test('mixed g/ml label records are not placed into a misleading nutrition ranking',()=>{
  const subset=[byId('HK-GFHK-SCHAR-DIGESTIVE-150'),byId('P000000124')];
  assert.deepEqual(filterProducts(subset,{sort:'carbs-asc'}).map(p=>p.id),subset.map(p=>p.id));
});
test('Bonchi unmatched pack price is unknown and cannot pass budget filters',()=>{
  const bonchi=byId('HK-4902450140175');
  assert.equal(bonchi.quantity,80);
  assert.equal(getMinPrice(bonchi),null);
  assert.equal(filterProducts([bonchi],{budget:100}).length,0);
  assert.equal(getAllergenAssessment(bonchi,['milk']).status,'no-listed-match');
});
test('all public catalogue identifiers are unique and numeric facts never contain negative or invalid values',()=>{
  assert.equal(new Set(products.map(p=>p.id)).size,products.length);
  for(const p of products){
    for(const key of ['energyKcal','carbohydrates','sugars','fat','saturatedFat','protein','fibre','sodiumMg']){
      const value=p.nutrition[key];assert.ok(value===null||(Number.isFinite(value)&&value>=0),`${p.id}:${key}`);
    }
    for(const price of p.prices)assert.ok(Number.isFinite(price.price)&&price.price>=0,`${p.id}:price`);
  }
});
