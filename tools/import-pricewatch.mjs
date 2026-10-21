/**
 * Import the published Consumer Council Pricewatch snapshot, food categories only.
 * This does not scrape retailers or infer branded nutrition, ingredients or allergens.
 * Run: node tools/import-pricewatch.mjs [--offline]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(ROOT, 'app/data');
const RAW = path.join(HERE, 'pricewatch-current.json');
const RETRIEVAL = path.join(HERE, 'pricewatch-retrieval.json');
const SOURCE = 'https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json';
const PORTAL = 'https://online-price-watch.consumer.org.hk/opw/';
const FOOD = new Set([
  'Bakery / Cereals / Spreads',
  'Dairy / Soy products / Eggs',
  'Candies / Biscuits / Snacks',
  'Rice / Oil / Canned food / Fruits / Vegetables / Meat',
  'Noodles / Cooking needs / Processed food (cold)',
  'Drinks',
]);
const text = value => typeof value === 'string' ? value.trim() : '';
const localized = (value, lang) => text(value?.[lang]);

function uiCategory(row) {
  const top = localized(row.cat1Name, 'en');
  const second = localized(row.cat2Name, 'en');
  if (top === 'Candies / Biscuits / Snacks') return second === 'Biscuits' ? 'biscuits' : 'snacks';
  if (top === 'Bakery / Cereals / Spreads') return 'bakery';
  if (top === 'Drinks') return 'drinks';
  if (top === 'Dairy / Soy products / Eggs') {
    return ['Milk / Milk drinks', 'Soy drinks / Instant Soy Milk'].includes(second) ? 'drinks' : 'dairy';
  }
  if (top === 'Rice / Oil / Canned food / Fruits / Vegetables / Meat') return 'pantry';
  if (top === 'Noodles / Cooking needs / Processed food (cold)') return 'meals';
  throw new Error(`Unapproved source category: ${top}`);
}

const merchantReferences = {
  PARKNSHOP: { name: '百佳 PNS', url: 'https://www.pns.hk/' },
  WELLCOME: { name: '惠康', url: 'https://www.wellcome.com.hk/' },
  JASONS: { name: 'Market Place', url: 'https://www.marketplacehk.com/' },
  AEON: { name: 'AEON', url: 'https://www.aeoncity.com.hk/' },
  WATSONS: { name: '屈臣氏', url: 'https://www.watsons.com.hk/' },
  MANNINGS: { name: '萬寧', url: 'https://www.mannings.com.hk/' },
  SASA: { name: '莎莎', url: null },
  DCHFOOD: { name: '大昌食品', url: null },
  LUNGFUNG: { name: '龍豐', url: null },
};

await fs.mkdir(DATA, { recursive: true });
let retrieval;
if (!process.argv.includes('--offline')) {
  const response = await fetch(SOURCE, {
    headers: { 'User-Agent': 'NutriCompare-student-prototype (public data research)', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Pricewatch HTTP ${response.status}`);
  const rawText = await response.text();
  const parsed = JSON.parse(rawText);
  if (!Array.isArray(parsed) || parsed.length < 100) throw new Error('Unexpected Pricewatch payload; existing snapshot retained.');
  retrieval = {
    sourceUrl: response.url,
    retrievedAt: new Date().toISOString(),
    httpLastModified: response.headers.get('last-modified'),
    etag: response.headers.get('etag'),
    recordCount: parsed.length,
  };
  await fs.writeFile(RAW, rawText, 'utf8');
  await fs.writeFile(RETRIEVAL, `${JSON.stringify(retrieval, null, 2)}\n`, 'utf8');
} else {
  retrieval = JSON.parse(await fs.readFile(RETRIEVAL, 'utf8'));
}

const raw = JSON.parse(await fs.readFile(RAW, 'utf8'));
const curated = JSON.parse(await fs.readFile(path.join(DATA, 'products.json'), 'utf8'));
const curatedIds = new Set(curated.products.map(p => p.id));
const sourceIds = raw.map(row => String(row.code ?? '').trim());
if (sourceIds.some(id => !id) || new Set(sourceIds).size !== raw.length) throw new Error('Missing or duplicate source identifiers; no files written.');

const included = raw.filter(row => FOOD.has(localized(row.cat1Name, 'en')));
let invalidPriceCount = 0;
const products = included.map(row => {
  const prices = (Array.isArray(row.prices) ? row.prices : []).flatMap(price => {
    const rawPrice = text(price.price);
    const number = Number(rawPrice);
    if (!rawPrice || !Number.isFinite(number) || number < 0) { invalidPriceCount++; return []; }
    return [{ store: text(price.supermarketCode), price: number }];
  });
  const offers = (Array.isArray(row.offers) ? row.offers : []).map(offer => ({
    store: text(offer.supermarketCode),
    textZh: localized(offer, 'zh-Hant'),
    textEn: localized(offer, 'en'),
  }));
  return {
    id: String(row.code ?? '').trim(),
    nameZh: localized(row.name, 'zh-Hant'),
    nameEn: localized(row.name, 'en'),
    brand: localized(row.brand, 'zh-Hant'),
    brandEn: localized(row.brand, 'en'),
    category: uiCategory(row),
    sourceCategory: {
      zh: localized(row.cat1Name, 'zh-Hant'),
      en: localized(row.cat1Name, 'en'),
      pathZh: [localized(row.cat2Name, 'zh-Hant'), localized(row.cat3Name, 'zh-Hant')].filter(Boolean),
      pathEn: [localized(row.cat2Name, 'en'), localized(row.cat3Name, 'en')].filter(Boolean),
    },
    // Package information remains in the original published name. There is no separate size field.
    packSize: null,
    prices,
    ...(offers.length ? { offers } : {}),
  };
});

const sourceCategories = [];
for (const row of raw) {
  const en = localized(row.cat1Name, 'en');
  let group = sourceCategories.find(category => category.en === en);
  if (!group) {
    group = { en, zh: localized(row.cat1Name, 'zh-Hant'), count: 0, included: FOOD.has(en) };
    sourceCategories.push(group);
  }
  group.count++;
}
const uiCategories = {};
const storeCounts = {};
for (const product of products) {
  uiCategories[product.category] = (uiCategories[product.category] ?? 0) + 1;
  for (const price of product.prices) storeCounts[price.store] = (storeCounts[price.store] ?? 0) + 1;
}
const stores = Object.fromEntries(Object.entries(storeCounts).map(([id, priceCount]) => {
  const reference = merchantReferences[id];
  if (!reference) throw new Error(`Unknown merchant code ${id}; check public merchant identity before publishing.`);
  return [id, {
    id, name: reference.name,
    url: reference.url ?? PORTAL,
    linkType: reference.url ? 'merchant-home' : 'price-source',
    linkLabel: reference.url ? '前往商戶網站查找商品' : '前往消委會格價頁查閱資料',
    priceCount,
  }];
}));

const metadata = {
  schemaVersion: 1,
  sourceId: 'consumer-council-pricewatch',
  sourceName: '香港消費者委員會 網上價格一覽通（開放數據）',
  sourceUrl: SOURCE,
  datasetUrl: 'https://data.gov.hk/tc-data/dataset/cc-pricewatch-pricewatch',
  sourcePortalUrl: PORTAL,
  sourceDictionaryUrl: 'https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch_data_dictionary.pdf',
  termsUrl: 'https://data.gov.hk/en/terms-and-conditions',
  retrievedAt: retrieval.retrievedAt,
  snapshotDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(retrieval.retrievedAt)),
  httpLastModified: retrieval.httpLastModified,
  sourcePriceDate: null,
  rawRecordCount: raw.length,
  foodRecordCount: products.length,
  excludedRecordCount: raw.length - products.length,
  priceObservationCount: products.reduce((sum, p) => sum + p.prices.length, 0),
  offerCount: products.reduce((sum, p) => sum + (p.offers?.length ?? 0), 0),
  invalidPriceCount,
  merchantCount: Object.keys(stores).length,
  curatedRecordCount: curated.products.length,
  matchedCuratedRecordCount: products.filter(p => curatedIds.has(p.id)).length,
  additionalRecordCount: products.filter(p => !curatedIds.has(p.id)).length,
  combinedUniqueRecordCount: new Set([...products.map(p => p.id), ...curatedIds]).size,
  sourceCategories,
  uiCategories,
  stores,
  compactSchema: 'Array of records. Shared provenance, unknown nutrition/allergens and merchant link fields are expanded at runtime; prices are whole-pack published values.',
  sourceFields: ['code', 'brand (en / zh-Hant)', 'name (en / zh-Hant)', 'three category levels', 'merchant code', 'published single-item price', 'offer text'],
  absentSourceFields: ['barcode / GTIN', 'nutrition panel', 'ingredients', 'allergen statement', 'country of manufacture', 'stock', 'direct merchant product URL', 'per-price effective date'],
  inclusionNote: '匯入消委會六個一般食品頂層分類；糖果、小食、主食、食油、調味料等均保留作搜尋及格價，商品出現不代表適合個別慢性病患者。',
  exclusionNote: '不匯入酒類、個人護理、家居／寵物分類；「奶粉／嬰兒用品」整個混合分類亦未納入，因此當中的成人奶粉同樣未覆蓋。這不是全港超市全部商品。',
  limitations: [
    '只覆蓋該開放資料檔案內的指定商戶及商品，不等於直接連接所有超市庫存或全部零售網站。',
    '商戶資料來自消委會公開價格檔；本次未批量擷取或繞過百佳、惠康等零售網站限制。',
    '檔案查閱／生成日期不等於每筆價格生效日期；價格、供應、運費及優惠以商戶為準。',
    '多件／會員優惠僅保留來源文字，不自動套入單件預算及最低價。',
    '沒有營養、成分及完整過敏聲明的商品維持未知；啟用過敏篩選時不會當作通過。',
    '消委會 P 開頭編號是來源商品代號，並非條碼；不以名稱相似推斷不同包裝的營養相同。',
  ],
  attribution: '資料來源：香港消費者委員會「網上價格一覽通」開放數據，經 DATA.GOV.HK 發布。NutriCompare 為學生原型，並非消委會或政府認可產品。',
};

await fs.writeFile(path.join(DATA, 'pricewatch-foods.json'), `${JSON.stringify(products)}\n`, 'utf8');
await fs.writeFile(path.join(DATA, 'pricewatch-meta.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  rawRecordCount: metadata.rawRecordCount,
  foodRecordCount: metadata.foodRecordCount,
  additionalRecordCount: metadata.additionalRecordCount,
  matchedCuratedRecordCount: metadata.matchedCuratedRecordCount,
  combinedUniqueRecordCount: metadata.combinedUniqueRecordCount,
  priceObservationCount: metadata.priceObservationCount,
  merchantCount: metadata.merchantCount,
  uiCategories: metadata.uiCategories,
  outputBytes: (await fs.stat(path.join(DATA, 'pricewatch-foods.json'))).size,
  invalidPriceCount,
}, null, 2));
