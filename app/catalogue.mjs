/** Expand shared Pricewatch provenance without inventing nutrition or label facts. */
const PRICEWATCH='https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json';
const NUTRIENTS=['energyKcal','carbohydrates','sugars','fat','saturatedFat','protein','fibre','sodiumMg'];

function storeRecord(meta, curated, id){
  const record=meta.stores?.[id]??curated.stores?.[id]??{};
  return typeof record==='string'?{name:record}:record;
}

/** OFF-derived facts remain separately published and attributed under ODbL/DbCL. */
export function mergeLabelSources(curated, overlay={}){
  const rows=Array.isArray(overlay)?overlay:overlay.products??[];
  const byId=new Map((curated.products??[]).map(product=>[product.id,product]));
  for(const record of rows){
    const existing=byId.get(record.id);
    // Never replace an already complete source-scoped record with a crowdsourced alternative.
    if(existing?.allergens?.status==='complete')continue;
    byId.set(record.id,{...existing,...record,prices:record.prices?.length?record.prices:existing?.prices??[],
      sources:[...(existing?.sources??[]),...(record.sources??[])],
    });
  }
  return {...curated,products:[...byId.values()],openFoodFacts:!Array.isArray(overlay)?{...overlay,products:undefined}:null};
}

export function buildCatalogue(curated, input, meta={}){
  const rows=Array.isArray(input)?input:input.products??[];
  const checkedAt=meta.retrievedAt??meta.priceRetrievedAt??meta.snapshotAt??curated.priceSnapshotAt;
  const sourceUrl=meta.sourceUrl??PRICEWATCH;
  const source={label:'消委會格價資訊通：商品、分類及單件價格',url:sourceUrl,checkedAt,scope:'只提供品牌、品名、規格、商戶售價及優惠；沒有營養、成分、過敏原或庫存資料。'};
  const priceRows=row=>(row.prices??[]).map(price=>{
    const merchant=storeRecord(meta,curated,price.store);
    return {...price,currency:'HKD',url:merchant.url??'https://online-price-watch.consumer.org.hk/',sourceUrl,linkType:merchant.linkType??'price-source',checkedAt,priceDate:null};
  });
  const expand=row=>({...row,packSize:row.packSize??'規格見商品名稱',quantity:null,quantityUnit:null,servingSize:null,origin:null,barcode:null,
    nutrition:{basisUnit:null,basisAmount:null,...Object.fromEntries(NUTRIENTS.map(key=>[key,null])),carbohydrateDefinition:'unspecified',status:'unknown',region:'unknown'},
    allergens:{contains:[],mayContain:[],status:'unknown',text:'價格資料集沒有成分或過敏聲明，尚未核對完整香港包裝。'},
    tags:[...(row.tags??[]),row.sourceCategory?.zh,row.sourceCategory?.en,...(row.sourceCategory?.pathZh??[]),...(row.sourceCategory?.pathEn??[])].filter(Boolean),
    prices:priceRows(row),sources:[{...source}],dataStatus:'pricewatch-price-only',physicalPackChecked:false,
    sourceLimit:'此項只收錄消委會商品及價格資料。營養、成分、過敏原及產地未核實；不能用一般食物平均值代替品牌標籤。',
  });
  const byId=new Map(rows.map(row=>[row.id,expand(row)]));
  let refreshedCurated=0;
  for(const product of curated.products??[]){
    const imported=byId.get(product.id);
    if(!imported){byId.set(product.id,{...product});continue;}
    // Only source-owned Pricewatch prices are refreshed. Independent retailer facts survive.
    const independent=(product.prices??[]).filter(price=>!String(price.sourceUrl??'').includes('online-price-watch.consumer.org.hk'));
    const merchantIds=new Set(independent.map(price=>price.store));
    byId.set(product.id,{...imported,...product,sourceCategory:imported.sourceCategory,
      tags:[...new Set([...(product.tags??[]),...(imported.tags??[])])],
      prices:[...independent,...imported.prices.filter(price=>!merchantIds.has(price.store))],
      sources:[...(product.sources??[]).filter(item=>item.url!==sourceUrl),{...source}],
      pricewatchCode:imported.id,
    });
    refreshedCurated++;
  }
  return {...curated,version:'1.3-hk-label-expansion',priceSnapshotAt:checkedAt,priceRetrievedAt:checkedAt,
    stores:{...(curated.stores??{}),...(meta.stores??{})},products:[...byId.values()],
    imports:{pricewatch:{...meta,importedCount:rows.length,refreshedCurated}},
  };
}
