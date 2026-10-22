import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCatalogue,mergeLabelSources} from '../catalogue.mjs';
import {enrichCatalogue,barcodeKey} from '../enrichment.mjs';
import {applyHkLabelReview,hkLabelCoverage} from '../hk-labels.mjs';
import {filterProducts,getAllergenAssessment,getMinPrice,nutritionFor} from '../engine.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name,import.meta.url),'utf8'));
const hk=read('hk-reviewed-labels.json'),offHk=read('off-hk-reviewed-labels.json');
const base=buildCatalogue(mergeLabelSources(read('products.json'),read('off-hk-labels.json')),read('pricewatch-foods.json'),read('pricewatch-meta.json'));
const expanded=enrichCatalogue(base,read('hk-nutrition-expansion.json'),read('off-nutrition-library.json'));
const inputBefore=JSON.stringify(expanded),hkBefore=JSON.stringify(hk),offBefore=JSON.stringify(offHk);
const data=applyHkLabelReview(applyHkLabelReview(expanded,hk),offHk);
const original=data.products.filter(p=>p.libraryGroup!=='off-library');
const byId=id=>data.products.find(p=>p.id===id);
const originalById=new Map(expanded.products.filter(p=>p.libraryGroup!=='off-library').map(p=>[p.id,p]));
const unknown={contains:[],mayContain:[],status:'unknown'};
const fixture=(id,extra={})=>({id,nameZh:'Original named product',libraryGroup:'priced',prices:[{store:'WELLCOME',price:18.9,currency:'HKD'}],nutrition:{basisAmount:null,basisUnit:null,energyKcal:null},allergens:{...unknown},sources:[],...extra});
const label=(id,extra={})=>({id,nutrition:{basisAmount:100,basisUnit:'g',energyKcal:100,carbohydrates:null,sugars:0,protein:null,fat:null,saturatedFat:null,transFat:null,sodiumMg:null,hkLabelVerified:true},allergens:{...unknown},sources:[{url:'https://brand.example/label',scope:'HK package'}],...extra});

test('reviewed labels enrich only the original priced identities and preserve all merchant snapshots',()=>{
  assert.equal(original.length,1788);
  assert.deepEqual(new Set(original.map(p=>p.id)),new Set(originalById.keys()));
  for(const current of original){
    const old=originalById.get(current.id);
    for(const key of ['id','nameZh','nameEn','brand','brandEn','category','prices','libraryGroup'])assert.deepEqual(current[key],old[key],`${current.id}:${key}`);
  }
  assert.equal(original.reduce((sum,p)=>sum+p.prices.length,0),4496);
  assert.equal(data.products.length,3051);
  assert.equal(new Set(data.products.map(p=>p.id)).size,3051);
  assert.equal(data.enrichment.added,1263);
  for(const p of data.products.filter(p=>p.libraryGroup==='off-library'))assert.deepEqual(p.prices,[],p.id);
});

test('coverage separates any nutrition, HK-reviewed sources and full1+7 rather than reporting the goal as achieved',()=>{
  assert.deepEqual(hkLabelCoverage(data.products),{
    original:1788,anyNutrition:293,reviewedNutrition:140,completeAllergy:99,fullCoreNutrition:102,target:1000,
  });
  assert.equal(data.hkLabelReview.nutritionAdded,65);
  assert.equal(data.hkLabelReview.nutritionUpgraded,21);
  assert.equal(data.hkLabelReview.allergyUpgraded,62);
  assert.ok(data.hkLabelReview.coverage.reviewedNutrition<data.hkLabelReview.coverage.target);
  assert.equal(data.enrichment.pricedNutrition,293);
});

test('an overlay cannot introduce an unpriced food or relabel a community-library item as an original HK product',()=>{
  const priced=fixture('original');
  const community=fixture('off-only',{libraryGroup:'off-library',prices:[],barcode:'123'});
  const result=applyHkLabelReview({products:[priced,community]},{products:[label('new-id'),label('off-only')]});
  assert.deepEqual(result.products.map(p=>p.id),['original','off-only']);
  assert.deepEqual(result.products[0],priced);
  assert.deepEqual(result.products[1],community);
  assert.deepEqual(hkLabelCoverage(result.products),{original:1,anyNutrition:0,reviewedNutrition:0,completeAllergy:0,fullCoreNutrition:0,target:1000});
});

test('a checked HK table replaces a whole community table without filling its unknown fields from another formulation',()=>{
  const old=fixture('food',{
    nutrition:{basisAmount:100,basisUnit:'g',energyKcal:999,carbohydrates:90,sodiumMg:777,hkLabelVerified:false},
    nutritionSourceFamily:'off-community-reference',offMetadata:{countryTag:'en:hong-kong'},
    ingredients:'Old community formulation',sources:[{url:'https://off.example/old',scope:'community nutrition'}],
  });
  const incoming=label('food',{nameZh:'Wrong replacement name',prices:[{store:'invented',price:0}],ingredients:'HK source ingredients',sourceNutrition:{basisAmount:5,basisUnit:'g',energyKcal:5}});
  const result=applyHkLabelReview({products:[old]},{products:[incoming]}).products[0];
  assert.deepEqual(result.nutrition,incoming.nutrition);
  assert.equal(result.nutrition.carbohydrates,null);
  assert.equal(result.nutrition.sodiumMg,null);
  assert.deepEqual(result.previousNutritionEvidence,{nutrition:old.nutrition,sourceFamily:'off-community-reference'});
  assert.equal(result.ingredients,'HK source ingredients');
  assert.deepEqual(result.sourceNutrition,incoming.sourceNutrition);
  assert.equal(result.nutritionSourceFamily,'hk-reviewed-label');
  assert.equal(result.offMetadata,undefined);
  assert.equal(result.nameZh,old.nameZh);
  assert.deepEqual(result.prices,old.prices);
  assert.equal(result.sources.length,2);
});

test('new label evidence preserves an already-reviewed HK formulation and the ingredients supporting its complete allergy statement',()=>{
  const old=fixture('reviewed',{
    nutrition:{basisAmount:100,basisUnit:'ml',energyKcal:44,sodiumMg:8500,hkLabelVerified:true},
    allergens:{contains:['milk'],mayContain:['peanuts'],status:'complete',text:'Existing full HK statement'},
    ingredients:'Milk and existing source ingredients',ingredientsSummary:'Existing ingredient summary',
  });
  const incoming=label('reviewed',{
    allergens:{contains:[],mayContain:[],status:'complete',text:'Different source formulation'},
    ingredients:'Different formula',ingredientsSummary:'Different summary',
  });
  const result=applyHkLabelReview({products:[old]},{products:[incoming]}).products[0];
  for(const key of ['nutrition','allergens','ingredients','ingredientsSummary'])assert.deepEqual(result[key],old[key],key);
  assert.equal(getAllergenAssessment(result,['milk']).status,'conflict');
  assert.equal(getAllergenAssessment(result,['peanuts']).status,'conflict');
  for(const before of base.products){
    const after=byId(before.id);
    if(before.nutrition?.hkLabelVerified===true)assert.deepEqual(after.nutrition,before.nutrition,before.id);
    if(before.allergens?.status==='complete'){
      assert.deepEqual(after.allergens,before.allergens,before.id);
      assert.equal(after.ingredients,before.ingredients,before.id);
    }
  }
});

test('partial labels retain previously known hazards and never pass a selected allergy restriction',()=>{
  const old=fixture('partial',{allergens:{contains:['peanuts'],mayContain:['milk'],status:'partial'}});
  const result=applyHkLabelReview({products:[old]},{products:[label('partial',{allergens:{contains:['gluten'],mayContain:[],status:'partial'}})]}).products[0];
  assert.deepEqual(new Set(result.allergens.contains),new Set(['peanuts','gluten']));
  assert.deepEqual(result.allergens.mayContain,['milk']);
  assert.equal(getAllergenAssessment(result,['peanuts']).status,'conflict');
  assert.equal(getAllergenAssessment(result,['fish']).status,'unknown');
  assert.equal(filterProducts([result],{allergens:['fish']}).length,0);
  for(const id of ['P000002999','P000000130']){
    assert.equal(byId(id).allergens.status,'partial',id);
    assert.equal(filterProducts([byId(id)],{allergens:['peanuts']}).length,0,id);
  }
});

test('Maggi200ml conflicting published sodium values remain unknown in comparisons with both exact sources retained',()=>{
  const p=byId('P000001141'),conflict=p.nutrition.sourceConflict;
  assert.equal(p.nutrition.sodiumMg,null);
  assert.equal(nutritionFor(p).sodiumMg,null);
  assert.equal(nutritionFor(p,'portion',5).sodiumMg,null);
  assert.equal(p.nutrition.energyKcal,44);
  assert.equal(conflict.status,'unresolved-published-source-conflict');
  assert.equal(conflict.retailerPhotoValue,9255);
  assert.equal(conflict.brandOfficialValue,8500);
  assert.match(conflict.retailerPhoto,/20201222/);
  assert.match(conflict.brandOfficialImage,/MaggiSeasoning200mL/);
  assert.equal(p.sourceNutrition.sodiumMg,9255,'original photographed value is retained as source evidence, not the chosen comparison value');
  assert.equal(byId('P000001142').nutrition.sodiumMg,9255,'the400ml product remains independent');
});

test('native5ml oil label arithmetic preserves nonzero trans fat and never converts between grams and millilitres',()=>{
  const p=byId('P000001874');
  assert.equal(p.sourceNutrition.basisAmount,5);
  assert.equal(p.sourceNutrition.basisUnit,'ml');
  assert.equal(p.sourceNutrition.transFat,0.1);
  assert.equal(p.nutrition.basisUnit,'ml');
  assert.equal(p.nutrition.transFat,2);
  assert.equal(nutritionFor(p,'portion',5).transFat,0.1);
  assert.equal(nutritionFor(p,'portion',5).energyKcal,39);
  assert.equal(getAllergenAssessment(p,['sesame']).status,'conflict');
  assert.equal(getAllergenAssessment(p,['soy']).status,'conflict');
});

test('the236ml milk table is read as one labelled portion rather than misreported as per100ml',()=>{
  const raw=offHk.products.find(p=>p.id==='P000000130').labelNutritionOriginal;
  assert.equal(raw.basisAmount,236);
  assert.equal(raw.basisUnit,'ml');
  assert.equal(raw.sodiumMg,130);
  assert.equal(raw.energyKcal,136);
  const p=byId('P000000130'),portion=nutritionFor(p,'portion',236);
  assert.ok(Math.abs(portion.sodiumMg-130)<0.001);
  assert.ok(Math.abs(portion.energyKcal-136)<0.001);
  assert.ok(Math.abs(nutritionFor(p).sodiumMg-130*100/236)<0.001);
  assert.equal(p.physicalPackChecked,false);
  assert.equal(p.allergens.status,'partial','a complete nutrition panel does not imply a complete allergy statement');
});

test('more source-scoped allergy choices retain whole-pack budget filtering and complete data requirements',()=>{
  assert.equal(filterProducts(data.products,{allergens:['milk']}).length,47);
  assert.equal(filterProducts(data.products,{allergens:['peanuts']}).length,71);
  const choices=filterProducts(data.products,{allergens:['peanuts'],budget:20});
  assert.equal(choices.length,49);
  for(const p of choices){
    assert.equal(p.libraryGroup,'priced',p.id);
    assert.equal(p.allergens.status,'complete',p.id);
    assert.ok(getMinPrice(p)<=20,p.id);
  }
});

test('newly read physical barcodes remove only duplicate unpriced references and accept equivalent leading-zero codes',()=>{
  const priced=fixture('original');
  const duplicate=fixture('off-duplicate',{libraryGroup:'off-library',prices:[],barcode:'00012345'});
  const unrelated=fixture('off-other',{libraryGroup:'off-library',prices:[],barcode:'999'});
  const result=applyHkLabelReview({products:[priced,duplicate,unrelated]},{products:[label('original',{barcode:'12345',identityEvidence:{physicalBarcodeVisuallyVerified:true}})]});
  assert.deepEqual(result.products.map(p=>p.id),['original','off-other']);
  assert.equal(result.products[0].barcode,'12345');
  assert.deepEqual(result.products[0].prices,priced.prices);
  const noPhoto=applyHkLabelReview({products:[priced,duplicate]},{products:[label('original',{barcode:'12345',identityEvidence:{physicalBarcodeVisuallyVerified:false}})]});
  assert.equal(noPhoto.products.length,2,'an unverified retailer item number cannot trigger physical-barcode deduplication');
  const pricedCodes=new Set(original.map(p=>barcodeKey(p.barcode)).filter(Boolean));
  for(const p of data.products.filter(p=>p.libraryGroup==='off-library'))assert.ok(!pricedCodes.has(barcodeKey(p.barcode)),p.id);
});

test('review metadata keeps the two independent source batches and OFF photo credits rather than claiming current physical checks',()=>{
  assert.deepEqual(data.hkLabelReview.batches,[hk.metadata,offHk.metadata]);
  assert.equal(hk.metadata.recordCount,74);
  assert.equal(offHk.metadata.recordCount,14);
  assert.match(hk.metadata.scope,/1788/);
  assert.match(offHk.metadata.databaseLicense,/odbl/);
  assert.match(offHk.metadata.contentsLicense,/dbcl/);
  assert.equal(offHk.metadata.sourceIsCurrentVerified,false);
  for(const p of offHk.products){
    assert.equal(p.physicalPackChecked,false,p.id);
    assert.equal(p.sourceIsCurrentVerified??offHk.metadata.sourceIsCurrentVerified,false,p.id);
    for(const image of p.labelImages){
      assert.ok(image.author,p.id);
      assert.ok(image.uploadedAt,p.id);
      assert.match(image.licenceUrl??image.licenseUrl,/creativecommons.org\/licenses\/by-sa\/3.0/,p.id);
    }
  }
});

test('review operations do not mutate their source catalogue or either independent overlay',()=>{
  assert.equal(JSON.stringify(expanded),inputBefore);
  assert.equal(JSON.stringify(hk),hkBefore);
  assert.equal(JSON.stringify(offHk),offBefore);
});
