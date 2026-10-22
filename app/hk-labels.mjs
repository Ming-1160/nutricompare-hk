import {hasNutrition,barcodeKey} from './enrichment.mjs';

/** A checked HK source is not a claim about the current physical batch. */
export function hasReviewedHkNutrition(product){
  if(!hasNutrition(product)||product.nutrition?.hkLabelVerified===false)return false;
  if(product.nutrition?.hkLabelVerified===true)return true;
  return product.dataStatus==='hk-retailer-label'&&product.nutrition?.region==='hk-retailer-online';
}
export function hkLabelCoverage(products){
  const original=products.filter(p=>p.libraryGroup!=='off-library');
  const reviewed=original.filter(hasReviewedHkNutrition);
  return {original:original.length,anyNutrition:original.filter(hasNutrition).length,reviewedNutrition:reviewed.length,
    completeAllergy:original.filter(p=>p.allergens?.status==='complete').length,
    fullCoreNutrition:reviewed.filter(p=>['energyKcal','carbohydrates','protein','fat','saturatedFat','transFat','sodiumMg','sugars'].every(k=>Number.isFinite(p.nutrition[k]))).length,
    target:1000};
}

export function applyHkLabelReview(dataset,overlay={}){
  const originalIds=new Set(dataset.products.filter(p=>p.libraryGroup!=='off-library').map(p=>p.id));
  const byId=new Map(dataset.products.map(p=>[p.id,p]));
  let nutritionAdded=0,nutritionUpgraded=0,allergyUpgraded=0;
  for(const row of overlay.products??[]){
    if(!originalIds.has(row.id))continue;
    const old=byId.get(row.id),next={...old};
    const validNutrition=hasNutrition(row)&&row.nutrition.hkLabelVerified===true&&['g','ml'].includes(row.nutrition.basisUnit);
    // A whole reviewed HK table can replace a community/overseas/secondary table.
    // Existing reviewed primary tables survive unless a separate future version review approves replacement.
    if(validNutrition&&!hasReviewedHkNutrition(old)){
      if(hasNutrition(old))nutritionUpgraded++;else nutritionAdded++;
      next.previousNutritionEvidence={nutrition:old.nutrition,sourceFamily:old.nutritionSourceFamily??old.dataStatus};
      next.nutrition={...row.nutrition};next.nutritionSourceFamily='hk-reviewed-label';
      next.dataStatus=row.dataStatus??'hk-retailer-label-photo';
      next.sourceLimit=row.sourceLimit??row.nutrition.sourceLimit;
      next.sourceNutrition=row.sourceNutrition;next.nutritionIdentityEvidence=row.identityEvidence;
      delete next.offMetadata;
      if(row.servingSize)next.servingSize=row.servingSize;
      if(row.packSize&&(!old.packSize||old.packSize==='規格見商品名稱'))next.packSize=row.packSize;
    }
    if(row.allergens?.status==='complete'&&old.allergens?.status!=='complete'){
      next.allergens={...row.allergens};allergyUpgraded++;
    }else if(row.allergens?.status==='partial'&&old.allergens?.status!=='complete'){
      next.allergens={...row.allergens,status:'partial',
        contains:[...new Set([...(old.allergens?.contains??[]),...(row.allergens.contains??[])])],
        mayContain:[...new Set([...(old.allergens?.mayContain??[]),...(row.allergens.mayContain??[])])]};
    }
    // Keep the ingredient text supporting an existing complete statement.
    if(old.allergens?.status!=='complete')for(const key of ['ingredientsSummary','ingredients'])if(row[key])next[key]=row[key];
    for(const key of ['labelImages','labelPhotos'])if(row[key])next[key]=[...new Map([...(old[key]??[]),...row[key]].map(image=>[typeof image==='string'?image:image.url,image])).values()];
    if(row.labelEvidence){
      next.previousLabelEvidence=old.labelEvidence;
      next.labelEvidence={...old.labelEvidence,...row.labelEvidence,
        photoDateNote:[old.labelEvidence?.photoDateNote,row.labelEvidence.photoDateNote].filter(Boolean).join(' ')};
    }
    if(!old.barcode&&row.barcode&&(row.identityEvidence?.physicalBarcodeRead===true||row.identityEvidence?.physicalBarcodeVisuallyVerified===true))next.barcode=row.barcode;
    next.sources=[...new Map([...(old.sources??[]),...(row.sources??[])].map(source=>[`${source.url}|${source.scope}`,source])).values()];
    next.hkReview={checkedAt:overlay.metadata?.checkedAt,sourceDateNote:row.labelEvidence?.photoDateNote??null};
    // Prices, name, store coverage and original identity are always owned by the original catalogue.
    next.prices=old.prices;next.id=old.id;next.libraryGroup=old.libraryGroup;
    byId.set(row.id,next);
  }
  // A newly read physical barcode can reveal an old unpriced library duplicate.
  const originalBarcodes=new Set([...byId.values()].filter(p=>p.libraryGroup!=='off-library').map(p=>barcodeKey(p.barcode)).filter(Boolean));
  const products=[...byId.values()].filter(p=>p.libraryGroup!=='off-library'||!originalBarcodes.has(barcodeKey(p.barcode)));
  const enrichment=dataset.enrichment?{...dataset.enrichment,
    pricedNutrition:products.filter(p=>p.libraryGroup!=='off-library'&&hasNutrition(p)).length,
    added:products.filter(p=>p.libraryGroup==='off-library').length,
    nutritionCount:products.filter(hasNutrition).length,
    explicitBasis:products.filter(p=>hasNutrition(p)&&['g','ml'].includes(p.nutrition?.basisUnit)).length}:undefined;
  const previous=dataset.hkLabelReview??{};
  return {...dataset,version:'1.5-original-hk-labels',products,...(enrichment?{enrichment}:{}),
    hkLabelReview:{...overlay.metadata,
      batches:[...(previous.batches??[]),overlay.metadata??{}],
      nutritionAdded:(previous.nutritionAdded??0)+nutritionAdded,
      nutritionUpgraded:(previous.nutritionUpgraded??0)+nutritionUpgraded,
      allergyUpgraded:(previous.allergyUpgraded??0)+allergyUpgraded,
      coverage:hkLabelCoverage(products)}};
}
