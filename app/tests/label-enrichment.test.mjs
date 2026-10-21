import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCatalogue,mergeLabelSources} from '../catalogue.mjs';
import {filterProducts,getAllergenAssessment,getMinPrice,nutritionFor} from '../engine.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}`,import.meta.url),'utf8'));
const base=read('products.json'),off=read('off-hk-labels.json');
const dataset=buildCatalogue(mergeLabelSources(base,off),read('pricewatch-foods.json'),read('pricewatch-meta.json'));
const products=dataset.products,byId=id=>products.find(p=>p.id===id);
const nutrients=['energyKcal','carbohydrates','sugars','fat','saturatedFat','protein','fibre','sodiumMg'];

test('source enrichment keeps 1788 identities and original merchant-price coverage while increasing evidence',()=>{
  assert.equal(products.length,1788);
  assert.equal(new Set(products.map(p=>p.id)).size,1788);
  assert.equal(products.reduce((sum,p)=>sum+p.prices.length,0),4496);
  assert.equal(products.filter(p=>nutrients.some(k=>Number.isFinite(p.nutrition[k]))).length,41);
  assert.equal(products.filter(p=>p.allergens.status==='complete').length,35);
});
test('milk restriction has additional source-scoped Nissin choices but lactose-free milk remains excluded',()=>{
  const matches=filterProducts(products,{allergens:['milk']});
  assert.equal(matches.length,8);
  for(const id of ['P000000015','P000001128','P000000014'])assert.ok(matches.some(p=>p.id===id),id);
  for(const id of ['P000002531','P000000122','P000005253'])assert.equal(getAllergenAssessment(byId(id),['milk']).status,'conflict',id);
  assert.equal(byId('P000005253').origin,'中國');
  assert.equal(byId('P000005253').nutrition.sugars,4.6);
});
test('peanut and HKD20 now finds bread and noodles using exact dated merchant prices',()=>{
  assert.equal(filterProducts(products,{allergens:['peanuts']}).length,24);
  const matches=filterProducts(products,{allergens:['peanuts'],budget:20});
  assert.equal(matches.length,16);
  for(const id of ['P000000033','P000001338','P000000836','P000000015','P000002531'])assert.ok(matches.some(p=>p.id===id),id);
  assert.ok(matches.every(p=>getMinPrice(p)<=20));
  assert.equal(getAllergenAssessment(byId('P000000014'),['peanuts']).status,'conflict','manufacturer explicitly declares peanut in beef90g');
});
test('ingredient and factory warnings override incomplete automated allergen tags',()=>{
  assert.equal(getAllergenAssessment(byId('P000000015'),['sesame']).status,'conflict');
  assert.equal(getAllergenAssessment(byId('P000000836'),['fish']).status,'conflict','fish oil in honey/egg bread');
  assert.equal(getAllergenAssessment(byId('P000000037'),['sesame']).status,'conflict');
  const calbee=byId('P000000280');
  for(const a of ['gluten','crustaceans','eggs','fish','peanuts','soy','milk','tree-nuts'])assert.equal(getAllergenAssessment(calbee,[a]).status,'conflict',a);
  assert.ok(calbee.labelImages.some(image=>image.uploadedAt.startsWith('2020')));
  assert.match(calbee.sourceLimit,/2020/);
});
test('partial OFF photos stay excluded by allergy filters and corrected arithmetic uses actual label portions',()=>{
  for(const id of ['P000000130','P000000327']){
    assert.equal(byId(id).allergens.status,'partial');
    assert.equal(filterProducts([byId(id)],{allergens:['peanuts']}).length,0);
  }
  assert.equal(byId('P000000130').nutrition.sodiumMg,55.0847);
  assert.ok(Math.abs(nutritionFor(byId('P000000130'),'portion',236).sodiumMg-130)<0.001);
});
test('contradictory official fat values are not repaired from a different pack',()=>{
  const single=byId('P000000015'),five=byId('P000001128');
  assert.equal(single.nutrition.fat,null);
  assert.equal(single.nutrition.saturatedFat,null);
  assert.ok(Number.isFinite(five.nutrition.fat));
  assert.match(single.sourceLimit,/互相矛盾/);
  assert.ok(Math.abs(nutritionFor(single,'portion',91).carbohydrates-53.8)<0.001);
});
test('all added barcodes have valid check digits and manufacturer artwork is distinguished from physical photos',()=>{
  for(const product of products.filter(p=>p.barcode)){
    const barcode=String(product.barcode);
    assert.match(barcode,/^\d{13}$/);
    const sum=[...barcode.slice(0,12)].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0);
    assert.equal((10-sum%10)%10,Number(barcode[12]),product.id);
  }
  for(const id of ['P000000124','P000002531','P000000122','P000000891','P000001615','P000005253']){
    assert.equal(byId(id).labelEvidence.packageLabelImageInspected,true,id);
    assert.equal(byId(id).labelEvidence.physicalPackPhotoInspected,false,id);
    assert.equal(byId(id).physicalPackChecked,false,id);
  }
});
test('OFF changes and images retain machine-readable share-alike licence, original source, author and date',()=>{
  assert.equal(off.recordCount,4);
  assert.equal(off.databaseLicense.name,'ODbL-1.0');
  assert.equal(off.contentsLicense.name,'DbCL-1.0');
  assert.ok(off.mergeMethod.endsWith('catalogue.mjs'));
  for(const p of off.products){
    assert.ok(p.sources.some(s=>s.url.includes('openfoodfacts.org')),p.id);
    assert.ok(p.labelImages.length>0,p.id);
    for(const image of p.labelImages){assert.ok(image.author,p.id);assert.ok(image.uploadedAt,p.id);assert.match(image.licenseUrl,/creativecommons.org/);}
  }
});
test('documented nutrition remains internally plausible and unreported fields are not filled with zero',()=>{
  for(const p of products){
    const n=p.nutrition;
    if(Number.isFinite(n.saturatedFat)&&Number.isFinite(n.fat))assert.ok(n.saturatedFat<=n.fat+0.001,p.id);
    if(Number.isFinite(n.sugars)&&Number.isFinite(n.carbohydrates))assert.ok(n.sugars<=n.carbohydrates+0.001,p.id);
  }
  assert.equal(byId('P000000033').nutrition.carbohydrates,null);
  assert.equal(byId('P000000038').nutrition.energyKcal,null,'cropped OFF table remains unreadable');
  assert.equal(byId('P000002531').nutrition.fibre,null);
});
