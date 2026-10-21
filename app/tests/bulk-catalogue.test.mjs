import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCatalogue} from '../catalogue.mjs';
import {filterProducts,getAllergenAssessment,getMinPrice,nutritionFor} from '../engine.mjs';

const load=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}`,import.meta.url),'utf8'));
const curated=load('products.json');
const input=load('pricewatch-foods.json');
const meta=load('pricewatch-meta.json');
const rows=Array.isArray(input)?input:input.products;
const catalogue=buildCatalogue(curated,rows,meta);
const byId=new Map(catalogue.products.map(product=>[product.id,product]));
const curatedIds=new Set(curated.products.map(product=>product.id));
const added=catalogue.products.filter(product=>!curatedIds.has(product.id));
const nutrients=['energyKcal','carbohydrates','sugars','fat','saturatedFat','protein','fibre','sodiumMg'];
const sourceUrl='https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json';

test('product words rank ahead of broad shared category matches in relevance search',()=>{
  const tea={id:'tea',nameZh:'綠茶茶包',nameEn:'Green Tea',tags:['茶 / 咖啡'],prices:[]};
  const coffee={id:'coffee',nameZh:'即溶咖啡',nameEn:'Instant Coffee',tags:['茶 / 咖啡'],prices:[]};
  const input=[tea,coffee];
  assert.deepEqual(filterProducts(input,{query:'咖啡',sort:'relevance'}).map(p=>p.id),['coffee','tea']);
  assert.deepEqual(input.map(p=>p.id),['tea','coffee']);
});

test('entire bundled food feed is searchable once, with all curated enrichments retained',()=>{
  assert.ok(rows.length>1000,'bulk catalogue must go beyond the curated demonstration');
  assert.ok(rows.every(row=>typeof row.id==='string'&&row.id.trim()),'each food needs a nonempty stable UI identifier');
  assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);
  const expectedIds=new Set([...rows.map(row=>row.id),...curatedIds]);
  assert.equal(byId.size,expectedIds.size);
  assert.equal(catalogue.products.length,expectedIds.size);
  assert.deepEqual(new Set(byId.keys()),expectedIds);
  assert.equal(catalogue.imports.pricewatch.importedCount,rows.length);
});

test('every new price-only food stays unknown for nutrition, origin, barcode and allergies',()=>{
  assert.ok(added.length>1000);
  for(const product of added){
    assert.equal(product.origin,null,product.id);
    assert.equal(product.barcode,null,product.id);
    assert.equal(product.nutrition.basisUnit,null,product.id);
    for(const key of nutrients)assert.equal(nutritionFor(product)[key],null,`${product.id}:${key}`);
    assert.equal(product.allergens.status,'unknown',product.id);
    assert.equal(getAllergenAssessment(product,['milk']).status,'unknown',product.id);
    assert.equal(product.physicalPackChecked,false,product.id);
    assert.ok(product.sources.some(source=>source.url===sourceUrl&&source.checkedAt),product.id);
  }
  assert.equal(filterProducts(added,{allergens:['milk']}).length,0);
  assert.equal(filterProducts(added,{allergens:['fish','peanuts']}).length,0);
});

test('bulk feed never expands the source-scoped allergy matches by treating missing facts as absent',()=>{
  for(const allergens of [['milk'],['peanuts'],['gluten'],['milk','soy']]){
    const before=new Set(filterProducts(curated.products,{allergens}).map(product=>product.id));
    const after=new Set(filterProducts(catalogue.products,{allergens}).map(product=>product.id));
    assert.deepEqual(after,before,allergens.join(','));
  }
});

test('nutrition and complete-HK-label views expose only documented data, while full catalogue retains price-only foods',()=>{
  const nutritionExpected=curated.products.filter(product=>nutrients.some(key=>Number.isFinite(product.nutrition?.[key])&&product.nutrition[key]>=0));
  const labelExpected=curated.products.filter(product=>product.allergens.status==='complete');
  const nutrition=filterProducts(catalogue.products,{dataScope:'nutrition'});
  const labels=filterProducts(catalogue.products,{dataScope:'hk-label'});
  assert.deepEqual(new Set(nutrition.map(product=>product.id)),new Set(nutritionExpected.map(product=>product.id)));
  assert.deepEqual(new Set(labels.map(product=>product.id)),new Set(labelExpected.map(product=>product.id)));
  assert.equal(filterProducts(added,{dataScope:'nutrition'}).length,0);
  assert.equal(filterProducts(added,{dataScope:'hk-label'}).length,0);
  assert.equal(filterProducts(catalogue.products,{dataScope:''}).length,catalogue.products.length);
  assert.ok(nutrition.length>0&&labels.length>0);
  assert.equal(filterProducts(labels,{dataScope:'hk-label',allergens:['milk']}).length,filterProducts(curated.products,{allergens:['milk']}).length);
});

test('unknown comparison bases stay null for both per-100 and user-entered portions',()=>{
  const unknown=added[0];
  for(const [basis,portion] of [['100',null],['portion',20]]){
    const values=nutritionFor(unknown,basis,portion);
    assert.equal(values.basisUnit,null);
    assert.equal(values.basisAmount,null);
    for(const nutrient of nutrients)assert.equal(values[nutrient],null,nutrient);
  }
  const invalid={id:'invalid',nutrition:{basisUnit:null,basisAmount:100,sugars:0}};
  assert.equal(nutritionFor(invalid).sugars,null,'even a numeric zero needs a confirmed measurement basis');
});

test('all curated label evidence and nutrition survive exact-code price enrichment',()=>{
  for(const product of curated.products){
    const merged=byId.get(product.id);
    for(const key of ['nutrition','allergens','ingredients','ingredientsSummary','labelEvidence','labelImages']){
      assert.deepEqual(merged[key],product[key],`${product.id}:${key}`);
    }
    assert.equal(merged.physicalPackChecked??false,product.physicalPackChecked??false,product.id);
    const independent=(product.prices??[]).filter(price=>!String(price.sourceUrl??'').includes('online-price-watch.consumer.org.hk'));
    for(const price of independent)assert.ok(merged.prices.some(candidate=>JSON.stringify(candidate)===JSON.stringify(price)),`${product.id}:${price.store} provenance`);
  }
});

test('all approved food source categories are complete and every excluded category stays outside the food catalogue',()=>{
  assert.equal(rows.length,meta.foodRecordCount);
  assert.equal(catalogue.products.length,meta.combinedUniqueRecordCount);
  assert.equal(rows.reduce((sum,row)=>sum+row.prices.length,0),meta.priceObservationCount);
  const categories=new Map();
  for(const row of rows){
    assert.ok(row.sourceCategory?.en,row.id);
    categories.set(row.sourceCategory.en,(categories.get(row.sourceCategory.en)??0)+1);
  }
  for(const group of meta.sourceCategories){
    assert.equal(categories.get(group.en)??0,group.included?group.count:0,group.en);
  }
  assert.equal(meta.sourceCategories.reduce((sum,group)=>sum+group.count,0),meta.rawRecordCount);
  assert.equal(meta.sourceCategories.filter(group=>!group.included).reduce((sum,group)=>sum+group.count,0),meta.excludedRecordCount);
});

const rawSourceUrl=new URL('../../../../work/itc2010/build-data/pricewatch-current.json',import.meta.url);
test('bundled import includes every approved code and exact merchant price from the locally retained official snapshot',{skip:!fs.existsSync(rawSourceUrl)},()=>{
  const raw=JSON.parse(fs.readFileSync(rawSourceUrl,'utf8'));
  const approved=new Set(meta.sourceCategories.filter(group=>group.included).map(group=>group.en));
  const expected=raw.filter(row=>approved.has(row.cat1Name.en));
  assert.equal(expected.length,rows.length);
  const bundled=new Map(rows.map(row=>[row.id,row]));
  for(const row of expected){
    const sourceCode=String(row.code??'').trim();
    const imported=sourceCode?bundled.get(sourceCode):rows.find(product=>product.nameEn===row.name.en&&product.nameZh===row.name['zh-Hant']&&product.brandEn===row.brand.en);
    assert.ok(imported,row.code);
    assert.equal(imported.nameZh,row.name['zh-Hant'],row.code);
    for(const price of row.prices){
      assert.equal(imported.prices.find(candidate=>candidate.store===price.supermarketCode)?.price,Number(price.price),`${row.code}:${price.supermarketCode}`);
    }
  }
});

test('bulk prices retain exact source amounts and do not turn retrieval dates into effective dates',()=>{
  for(const row of rows){
    const merged=byId.get(row.id);
    const original=curated.products.find(product=>product.id===row.id);
    const independentStores=new Set((original?.prices??[]).filter(price=>!String(price.sourceUrl??'').includes('online-price-watch.consumer.org.hk')).map(price=>price.store));
    for(const price of row.prices){
      if(independentStores.has(price.store))continue;
      const actual=merged.prices.find(candidate=>candidate.store===price.store);
      assert.ok(actual,`${row.id}:${price.store}`);
      assert.equal(actual.price,price.price,`${row.id}:${price.store}`);
      assert.equal(actual.sourceUrl,sourceUrl,row.id);
      assert.equal(actual.currency,'HKD',row.id);
      assert.equal(actual.priceDate,null,row.id);
      assert.ok(actual.checkedAt,row.id);
      assert.match(actual.url,/^https:\/\//,row.id);
    }
  }
});

test('an additional food can be searched in both languages and filtered by its actual merchant price',()=>{
  const row=rows.find(row=>!curatedIds.has(row.id)&&row.nameZh&&row.nameEn&&row.prices.length);
  assert.ok(row);
  const product=byId.get(row.id);
  for(const query of [row.nameZh,row.nameEn])assert.ok(filterProducts(catalogue.products,{query}).some(candidate=>candidate.id===row.id),query);
  const price=row.prices[0];
  assert.equal(getMinPrice(product,{store:price.store}),price.price);
  assert.ok(filterProducts(catalogue.products,{query:row.nameEn,store:price.store,budget:price.price}).some(candidate=>candidate.id===row.id));
  if(price.price>0)assert.equal(filterProducts([product],{store:price.store,budget:price.price-0.01}).length,0);
  assert.equal(filterProducts([product],{store:'NOT-A-REAL-MERCHANT'}).length,0);
});

test('similar names never transfer labels or prices across different source codes, and inputs are unchanged',()=>{
  const source=curated.products.find(product=>product.allergens.status==='complete');
  const first={...source,id:'verified-pack',prices:[{store:'PARKNSHOP',price:11,sourceUrl:'https://retailer.example/verified-pack'}]};
  const row={id:'different-pack',nameZh:first.nameZh,nameEn:first.nameEn,brand:first.brand,category:first.category,prices:[{store:'PARKNSHOP',price:8}]};
  const base={products:[first],stores:{PARKNSHOP:{name:'百佳',url:'https://www.pns.hk/'}}};
  const before=JSON.stringify({base,row});
  const result=buildCatalogue(base,[row],{retrievedAt:'2026-10-21',sourceUrl});
  assert.equal(result.products.length,2);
  assert.equal(result.products.find(product=>product.id==='different-pack').allergens.status,'unknown');
  assert.equal(result.products.find(product=>product.id==='verified-pack').prices[0].price,11);
  assert.equal(JSON.stringify({base,row}),before);
});

test('same-store independent retailer facts keep their own provenance when a Pricewatch code matches',()=>{
  const source=curated.products[0];
  const independent={store:'PARKNSHOP',price:12.5,sourceUrl:'https://retailer.example/exact-pack',checkedAt:'2026-10-20',priceDate:null};
  const first={...source,id:'exact-pack',prices:[independent,{store:'WELLCOME',price:9,sourceUrl}]};
  const row={id:'exact-pack',nameZh:'source name',category:first.category,prices:[{store:'PARKNSHOP',price:13},{store:'WELLCOME',price:10}]};
  const result=buildCatalogue({products:[first]},[row],{retrievedAt:'2026-10-21',sourceUrl}).products[0];
  assert.deepEqual(result.prices.find(price=>price.store==='PARKNSHOP'),independent);
  assert.equal(result.prices.find(price=>price.store==='WELLCOME').price,10);
  assert.equal(result.prices.find(price=>price.store==='WELLCOME').checkedAt,'2026-10-21');
  assert.deepEqual(result.allergens,first.allergens);
});
