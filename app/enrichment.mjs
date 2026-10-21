/** Keep source-specific nutrition, exact identities, and unpriced community records distinct. */
const FIELDS=['energyKcal','carbohydrates','sugars','fat','saturatedFat','protein','fibre','sodiumMg'];
export const hasNutrition=product=>FIELDS.some(key=>Number.isFinite(product?.nutrition?.[key]));
export const barcodeKey=value=>String(value??'').replace(/^0+(?=\d)/,'');
const sourceUnion=(a=[],b=[])=>[...new Map([...a,...b].map(source=>[`${source.url}|${source.scope}`,source])).values()];

function applyRecord(existing,record,family){
  // Never splice two formulations or reference bases into a single nutrition table.
  const useNutrition=!hasNutrition(existing)&&hasNutrition(record);
  const result={...existing,sources:sourceUnion(existing.sources,record.sources)};
  if(useNutrition){
    result.nutrition={...record.nutrition};
    result.nutritionSourceFamily=family;
    result.sourceLimit=record.sourceLimit??record.nutrition.sourceLimit;
    result.dataStatus=record.dataStatus??family;
    result.nutritionIdentityEvidence=record.identityEvidence;
    if(record.offMetadata)result.offMetadata=record.offMetadata;
    if(record.sourceNutrition)result.sourceNutrition=record.sourceNutrition;
    if(record.servingSize)result.servingSize=record.servingSize;
    if(record.packSize&&(!existing.packSize||existing.packSize==='規格見商品名稱'))result.packSize=record.packSize;
    if(!existing.quantity&&record.quantity){result.quantity=record.quantity;result.quantityUnit=record.quantityUnit;}
    if(!result.ingredients&&!result.ingredientsSummary&&record.ingredients)result.ingredients=record.ingredients;
  }
  if(existing.allergens?.status!=='complete'){
    if(record.allergens?.status==='complete'){
      result.allergens={...record.allergens};
      for(const key of ['labelEvidence','labelImages','labelPhotos','ingredientsSummary','ingredients'])if(record[key])result[key]=record[key];
    }else if(record.allergens?.status==='partial'){
      const previous=existing.allergens??{};
      result.allergens={...record.allergens,
        contains:[...new Set([...(previous.contains??[]),...(record.allergens.contains??[])])],
        mayContain:[...new Set([...(previous.mayContain??[]),...(record.allergens.mayContain??[])])],
        status:'partial'};
      if(!result.ingredientsSummary&&record.ingredientsSummary)result.ingredientsSummary=record.ingredientsSummary;
    }
  }
  // A barcode from an independently checked OFF identity is a source claim, not an inspected HK label.
  if(!result.barcode&&record.barcode)result.barcode=record.barcode;
  return result;
}

export function enrichCatalogue(catalogue,local={},off={}){
  const byId=new Map((catalogue.products??[]).map(product=>[product.id,{...product,libraryGroup:'priced'}]));
  for(const record of local.products??[]){
    const existing=byId.get(record.id);
    if(existing)byId.set(record.id,applyRecord(existing,record,record.sourceFamily??'hk-source-reference'));
  }
  let offApplied=0;
  for(const record of off.matches??[]){
    const existing=byId.get(record.id);
    if(!existing)continue;
    if(!hasNutrition(existing)&&hasNutrition(record))offApplied++;
    byId.set(record.id,applyRecord(existing,record,'off-community-reference'));
  }
  const existingBarcodes=new Set([...byId.values()].map(p=>barcodeKey(p.barcode)).filter(Boolean));
  let added=0,duplicates=0;
  for(const record of off.expansion??[]){
    const key=barcodeKey(record.barcode);
    if(byId.has(record.id)||(key&&existingBarcodes.has(key))){duplicates++;continue;}
    if(!hasNutrition(record))continue;
    byId.set(record.id,{...record,libraryGroup:'off-library',nutritionSourceFamily:'off-community-reference',prices:[],physicalPackChecked:false});
    if(key)existingBarcodes.add(key);
    added++;
  }
  const products=[...byId.values()];
  return {...catalogue,version:'1.4-nutrition-library',products,
    enrichment:{local:local.metadata??{},off:off.metadata??{},offApplied,added,duplicates,
      pricedCount:products.filter(p=>p.libraryGroup==='priced').length,
      pricedNutrition:products.filter(p=>p.libraryGroup==='priced'&&hasNutrition(p)).length,
      nutritionCount:products.filter(hasNutrition).length,
      explicitBasis:products.filter(p=>hasNutrition(p)&&['g','ml'].includes(p.nutrition.basisUnit)).length}};
}
