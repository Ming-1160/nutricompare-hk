import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFdcLibrary, normalizeFdcReference, isFdcReference, isInternationalReference } from '../international-library.mjs?v=112';
import { ALLERGENS, buildBrandIndex, filterProducts, getAllergenAssessment, nutritionFor } from '../engine.mjs?v=112';
import { hkLabelCoverage, applyHkLabelReview, hasReviewedHkNutrition } from '../hk-labels.mjs?v=112';
import { getNutrientEvidence, getNutritionSourceLabel } from '../nutrition-evidence.mjs?v=112';
import { ALL_DATA_FILES, DATA_FILES, FDC_LIBRARY_FILE, assembleDataset, loadDataFiles, resultsHold, comparingPaused } from '../data-loader.mjs?v=112';
import { dataset, dataFiles } from './helpers/catalogue.mjs';

const ids = values => values.map(product => product.id).sort();
const fixture = (fdcId = 900000001) => ({
  id:`FDC-${fdcId}`, fdcId, nameZh:'', nameEn:'Fixture USDA oat cereal', brand:'Fixture International Brand', category:'bakery',
  catalogueGroup:'fdc-library', marketCountry:'United States', origin:null, barcode:'0089782030092', prices:[],
  nutrition:{basisAmount:100,basisUnit:'g',energyKcal:100,carbohydrates:20,sugars:0,fat:1,saturatedFat:0,
    transFat:null,protein:3,fibre:2,sodiumMg:4,hkLabelVerified:false,status:'reference',region:'us-fdc-reference'},
  sourceNutrition:{basisAmount:100,basisUnit:'g',values:{energyKcal:100,carbohydrates:20,sugars:0,fat:1,protein:3,fibre:2,sodiumMg:4}},
  allergens:{contains:[],mayContain:[],status:'unknown'},
  sources:[{label:'USDA FoodData Central nutrition reference fixture',url:`https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`,checkedAt:'2026-11-13',scope:'Official foreign source; fixture for tests'}],
});
const library = products => ({metadata:{sourceName:'USDA FoodData Central',licence:'CC0',retrievedAt:'2026-11-13'},products});

test('material conflicts between USDA gram serving fields are held instead of publishing a suspect per-100g table', () => {
  const conflicting = {...fixture(),fdcMetadata:{rawServingSize:245,rawServingSizeUnit:'GRM',householdServingFullText:'1 Pack (36g)'}};
  assert.equal(normalizeFdcReference(conflicting),null,'245 g versus 36 g must not enter nutrition ranking');
  const result=appendFdcLibrary(dataset,library([conflicting]));
  assert.equal(result.nutritionLibraries.fdc.added,0);
  assert.equal(result.nutritionLibraries.fdc.rejected,1);
  assert.deepEqual(result.products,dataset.products,'holding a reference does not change HK records');
  for(const [raw,text] of [[36,'1 Pack (36g)'],[30,'3 Cookies (28g / 1 oz)'],[30.4,'1 portion (30 grams)']]){
    const record={...fixture(),fdcMetadata:{rawServingSize:raw,rawServingSizeUnit:'GRM',householdServingFullText:text}};
    const accepted=normalizeFdcReference(record);
    assert.ok(accepted,`${raw} / ${text} is an exact match or modest rounding`);
    assert.deepEqual(accepted.nutrition,{...record.nutrition},'no corrective nutrient rescaling is invented');
  }
});

test('missing, ranged or ambiguous household serving text does not invent an exact gram amount', () => {
  for(const text of [undefined,'1 pack','1 Pack (1 oz)','1 Pack (30-40g)','1 Pack (30 to 40 grams)',
    '1 Pack (30g or 40g)','2 x 18g','1 Pack (30/40g)','1 Pack (1/2g)']){
    const record={...fixture(),fdcMetadata:{rawServingSize:245,rawServingSizeUnit:'GRM',householdServingFullText:text}};
    assert.ok(normalizeFdcReference(record),`no exact inference from ${text}`);
  }
  assert.ok(normalizeFdcReference({...fixture(),fdcMetadata:{rawServingSize:245,rawServingSizeUnit:'MLT',householdServingFullText:'1 Pack (36g)'}}),
    'a volume serving is not treated as grams');
});

test('FDC references append by their own ID without changing a Hong Kong table, price, identity or allergy', () => {
  const before = JSON.stringify(dataset.products);
  const result = appendFdcLibrary(dataset, library([fixture(),fixture(900000002)]));
  assert.equal(result.products.length, dataset.products.length + 2);
  assert.equal(JSON.stringify(dataset.products), before, 'input catalogue is unchanged');
  for (const original of dataset.products) assert.strictEqual(result.products.find(product=>product.id===original.id), original);
  assert.deepEqual(hkLabelCoverage(result.products), hkLabelCoverage(dataset.products));
  assert.equal(result.nutritionLibraries.fdc.added, 2);
  assert.equal(result.nutritionLibraries.fdc.rejected, 0);
  const fdc = result.products.find(product=>product.id==='FDC-900000001');
  assert.equal(fdc.barcode, '0089782030092', 'same GTIN does not merge or overwrite an existing HK identity');
  assert.equal(fdc.marketCountry, 'United States');
  assert.equal(fdc.origin, null, 'source market does not establish country of manufacture');
  assert.equal(isInternationalReference(fdc), true);
  assert.equal(hasReviewedHkNutrition(fdc), false);
  const nz = normalizeFdcReference({...fixture(900000003),marketCountry:'New Zealand'});
  assert.equal(nz.marketCountry,'New Zealand','the source market is not rewritten as the United States');
  assert.equal(nz.origin,null);
});

test('the original priced and legacy OFF scopes are unchanged while international and USDA scopes are separate', () => {
  const result = appendFdcLibrary(dataset, library([fixture(),fixture(900000002)])).products;
  assert.deepEqual(ids(filterProducts(result,{libraryScope:'priced'})), ids(filterProducts(dataset.products,{libraryScope:'priced'})));
  assert.deepEqual(ids(filterProducts(result,{libraryScope:'off-library'})), ids(filterProducts(dataset.products,{libraryScope:'off-library'})));
  assert.deepEqual(ids(filterProducts(result,{libraryScope:'fdc-library'})), ['FDC-900000001','FDC-900000002']);
  assert.equal(filterProducts(result,{libraryScope:'international'}).length, filterProducts(dataset.products,{libraryScope:'off-library'}).length+2);
  assert.equal(filterProducts(result,{libraryScope:'fdc-library',budget:20}).length, 0, 'unpriced references are never HK$0');
  assert.equal(filterProducts(result,{libraryScope:'fdc-library',store:'WELLCOME'}).length, 0, 'no HK retailer is invented');
  assert.equal(filterProducts(result,{libraryScope:'fdc-library',dataScope:'hk-nutrition'}).length, 0);
  assert.equal(filterProducts(result,{libraryScope:'fdc-library',dataScope:'hk-label'}).length, 0);
  assert.deepEqual([...buildBrandIndex(result)], [...buildBrandIndex(dataset.products)], 'foreign brand vocabulary cannot alter the original parser');
});

test('unknown foreign allergy statements cannot pass any of the ten original allergen filters', () => {
  const incoming = fixture();
  incoming.prices=[{store:'WELLCOME',price:0}];
  incoming.origin='United States';
  incoming.nutrition.hkLabelVerified=true;
  incoming.allergens={contains:[],mayContain:[],status:'complete'};
  const result = appendFdcLibrary(dataset,library([incoming]));
  const fdc = result.products.at(-1);
  assert.deepEqual(fdc.prices, []);
  assert.equal(fdc.origin, null);
  assert.equal(fdc.nutrition.hkLabelVerified, false);
  assert.equal(fdc.allergens.status, 'unknown');
  for (const allergen of ALLERGENS) {
    assert.notEqual(getAllergenAssessment(fdc,[allergen]).status,'no-listed-match',allergen);
    assert.deepEqual(ids(filterProducts(result.products,{allergens:[allergen]})),ids(filterProducts(dataset.products,{allergens:[allergen]})),allergen);
  }
  const falseReview={metadata:{},products:[{...fdc,nutrition:{...fdc.nutrition,hkLabelVerified:true},allergens:{contains:[],mayContain:[],status:'complete'}}]};
  const reviewed=applyHkLabelReview(result,falseReview);
  assert.equal(reviewed.products.find(product=>product.id===fdc.id).nutrition.hkLabelVerified,false,'HK review overlays only act on original identities');
});

test('foreign nutrition retains explicit basis, source figures, zeros and unknowns with USDA attribution', () => {
  const fdc=normalizeFdcReference(fixture());
  assert.equal(nutritionFor(fdc).sugars,0);
  assert.equal(nutritionFor(fdc).transFat,null);
  assert.equal(nutritionFor(fdc,'portion',25).carbohydrates,5);
  assert.equal(getNutritionSourceLabel(fdc),'USDA 海外品牌營養參考');
  const evidence=getNutrientEvidence(fdc,'sodiumMg',nutritionFor(fdc));
  assert.equal(evidence.original.value,4);
  assert.equal(evidence.original.amount,100);
  assert.match(evidence.source.type,/USDA/);
  assert.match(evidence.source.url,/fdc\.nal\.usda\.gov/);
});

test('invalid identities, negative or implicit-basis tables are rejected and duplicate FDC IDs are not appended twice', () => {
  const valid=fixture();
  const records=[valid,{...valid}, {...valid,id:'P000000033'}, {...valid,id:'FDC-3',fdcId:4},
    {...valid,id:'FDC-5',fdcId:5,nutrition:{...valid.nutrition,basisUnit:null}},
    {...valid,id:'FDC-6',fdcId:6,nutrition:{...valid.nutrition,basisAmount:1}},
    {...valid,id:'FDC-7',fdcId:7,nutrition:{...valid.nutrition,sugars:-1}},
    {...valid,id:'FDC-8',fdcId:8,marketCountry:''}];
  const result=appendFdcLibrary(dataset,library(records));
  assert.equal(result.nutritionLibraries.fdc.added,1);
  assert.equal(result.nutritionLibraries.fdc.duplicateIds,1);
  assert.equal(result.nutritionLibraries.fdc.rejected,6);
  assert.equal(isFdcReference(result.products.at(-1)),true);
  assert.strictEqual(appendFdcLibrary(dataset,{products:[]}),dataset,'malformed optional payload does not touch the HK catalogue');
});

test('a missing optional FDC file is reported separately and cannot block or change existing HK comparisons', () => {
  const absent=assembleDataset(new Map(dataFiles));
  assert.deepEqual(absent.missing,[]);
  assert.deepEqual(absent.optionalMissing,[FDC_LIBRARY_FILE]);
  assert.equal(resultsHold(absent.missing,['peanuts']),'');
  assert.equal(comparingPaused(absent.missing),false);
  const loaded=new Map([...dataFiles,[FDC_LIBRARY_FILE,library([fixture()])]]);
  const available=assembleDataset(loaded);
  assert.deepEqual(available.optionalMissing,[]);
  assert.deepEqual(available.missing,[]);
  assert.deepEqual(ids(filterProducts(available.dataset.products,{libraryScope:'priced'})),ids(filterProducts(absent.dataset.products,{libraryScope:'priced'})));
  loaded.delete('hk-reviewed-labels.json');
  const held=assembleDataset(loaded);
  assert.equal(resultsHold(held.missing,[]),'labels','all previous required-label holds remain');
  assert.equal(comparingPaused(held.missing),true);
});

test('optional fetch failures and malformed payloads retry without refetching successful required files', async () => {
  const calls=[];
  const first=await loadDataFiles(async name=>{calls.push(name);if(name===FDC_LIBRARY_FILE)throw new Error('HTTP404');return dataFiles.get(name);});
  assert.equal(calls.length,ALL_DATA_FILES.length);
  assert.equal(first.loaded.size,DATA_FILES.length);
  assert.deepEqual(first.failures.map(item=>item.file),[FDC_LIBRARY_FILE]);
  assert.deepEqual(assembleDataset(first.loaded).missing,[]);
  calls.length=0;
  const invalid=await loadDataFiles(async name=>{calls.push(name);return {metadata:{}};},first.loaded);
  assert.deepEqual(calls,[FDC_LIBRARY_FILE]);
  assert.equal(invalid.loaded.has(FDC_LIBRARY_FILE),false);
  assert.deepEqual(assembleDataset(invalid.loaded).optionalMissing,[FDC_LIBRARY_FILE]);
  calls.length=0;
  const retry=await loadDataFiles(async name=>{calls.push(name);return library([fixture()]);},invalid.loaded);
  assert.deepEqual(calls,[FDC_LIBRARY_FILE]);
  assert.deepEqual(retry.failures,[]);
  assert.equal(assembleDataset(retry.loaded).dataset.nutritionLibraries.fdc.added,1);
});
