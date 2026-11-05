import { filterProducts, getEligiblePrices, getMinPrice, getAllergenAssessment, nutritionFor, parseRequest, rankingGroups, searchQueryLimitations } from './engine.mjs?v=18';
import { filtersFromParams, paramsFromFilters } from './url-state.mjs?v=18';
import { AI_ASSISTANT } from './ai-config.mjs?v=20261023-v17c';
import { buildCatalogue, mergeLabelSources } from './catalogue.mjs?v=20261021-labels-expanded';
import { enrichCatalogue } from './enrichment.mjs?v=20261021-nutrition-library';
import { applyHkLabelReview, hkLabelCoverage, hasReviewedHkNutrition } from './hk-labels.mjs?v=20261022-hk-labels-more';
import { getPackPrices, getPackNutrition } from './pack-values.mjs?v=18';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '#'; } catch { return '#'; } };
const link = (url, label, cls='') => `<a class="${esc(cls)}" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const money = value => value === null || value === undefined ? '—' : Number(value).toFixed(2).replace(/0$/, '');
const number = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-HK', {maximumFractionDigits:1});
const hongKongDate = new Intl.DateTimeFormat('zh-Hant-HK', {
  timeZone:'Asia/Hong_Kong', year:'numeric', month:'numeric', day:'numeric'
});
function dateLabel(value, fallback='日期未記錄') {
  if(typeof value!=='string'||!value.trim())return fallback;
  const dateOnly=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(dateOnly)return `${dateOnly[1]}年${Number(dateOnly[2])}月${Number(dateOnly[3])}日`;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return value;
  const parts=Object.fromEntries(hongKongDate.formatToParts(date).map(({type,value})=>[type,value]));
  return `${parts.year}年${parts.month}月${parts.day}日`;
}
function snapshotLabel() { return dateLabel(dataset?.priceSnapshotAt??dataset?.updatedAt,'見各項來源'); }
const stores = {PARKNSHOP:'百佳',WELLCOME:'惠康',JASONS:'Market Place',AEON:'AEON',DCHFOOD:'大昌食品',WATSONS:'屈臣氏'};
const allergens = {gluten:'含麩質穀物',crustaceans:'甲殼類',eggs:'蛋類',fish:'魚類',peanuts:'花生',soy:'大豆',milk:'奶類','tree-nuts':'木本堅果',sesame:'芝麻',sulphites:'亞硫酸鹽'};
const categories = {biscuits:'餅乾',snacks:'小食',drinks:'飲品',bakery:'麵包 / 蛋糕',dairy:'奶 / 豆品 / 蛋',pantry:'糧油 / 調味',meals:'麵食 / 罐頭 / 食材'};
const nutrientFields = [['energyKcal','能量','kcal'],['carbohydrates','碳水化合物','g'],['sugars','糖','g'],['protein','蛋白質','g'],['fat','總脂肪','g'],['saturatedFat','飽和脂肪','g'],['transFat','反式脂肪','g'],['fibre','膳食纖維','g'],['sodiumMg','鈉','mg']];
const sortLabels = {'price-asc':'價格：低至高','carbs-asc':'碳水化合物：低至高','sugar-asc':'糖：低至高','sodium-asc':'鈉：低至高','protein-desc':'蛋白質：高至低'};
const LOWEST_KEYS = new Set(['energyKcal','carbohydrates','sugars','fat','saturatedFat','transFat','sodiumMg']);
/** The value as the table prints it (one decimal), so a 'lowest' mark never contradicts the numbers shown. */
const shownValue = value => value===null||value===undefined||!Number.isFinite(Number(value)) ? null : Math.round(Number(value)*10)/10;
const defaults = () => ({query:'',category:'',budget:null,store:'',allergens:[],origin:'',sort:'relevance',dataScope:'',libraryScope:'priced'});
let filters = defaults();
let dataset = null;
let products = [];
let selected = [];
let results = [];
let detailProduct = null;
let comparisonBasis = '100';
let comparisonPortion = 20;
let toastTimeout;
let searchTimeout;
const PAGE_SIZE=24;
let visibleCount=PAGE_SIZE;
let filterSignature='';
let linkReady=false;
let linkSignature=null;

function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>$('toast').hidden=true,4200); }
function brandName(product) { return typeof product.brand === 'object' ? product.brand['zh-Hant'] ?? product.brand.zh ?? product.brand.en ?? '' : product.brand ?? ''; }
function productUnit(product) { return ['g','ml'].includes(product.nutrition?.basisUnit)?product.nutrition.basisUnit:null; }
function packPriceLines(product,price) {
  const pack=getPackPrices(product,price);
  const lines=[];
  if(pack.per100!==null)lines.push(`HK$${money(pack.per100)}／100${pack.unit}`);
  if(pack.perInner!==null)lines.push(`HK$${money(pack.perInner)}／小包`);
  return lines;
}
function cardUnitPrice(product,price) {
  const lines=packPriceLines(product,price);
  return lines.length?`<p class="product-unit-price">${esc(lines.join(' · '))}</p>`:'';
}
function nutrientValue(value,unit) {
  return shownValue(value)===null?'—':`${number(value)} <small>${unit}</small>`;
}
function basisLabel(product,amount=100) { const unit=productUnit(product);return unit?`每 ${number(amount)} ${unit}`:product.nutrition?.referenceBasis==='100g-or-100ml'?'來源每100g／ml · 單位待核對':'標籤基準未確認'; }
function hasNutrition(product) { return nutrientFields.some(([key])=>product.nutrition?.[key] !== null && product.nutrition?.[key] !== undefined); }
function hkEvidenceLabel(product) {
  if(product.allergens?.status!=='complete')return hasReviewedHkNutrition(product)?'香港營養已讀 · 過敏未齊':'';
  if(product.labelEvidence?.retailerPackageLabelImagesInspected)return '香港零售標籤圖已讀';
  if(product.labelEvidence?.packageLabelImageInspected)return '香港品牌標籤圖已讀';
  const method=product.allergens?.verificationMethod??product.allergens?.completeSource??'';
  if(product.labelEvidence?.physicalPackPhotoInspected || /photo|image/.test(method))return '香港背標照片已讀';
  return '香港網頁完整聲明';
}
function labelEvidenceSection(product) {
  const evidence=product.labelEvidence??{};
  const photos=[...(Array.isArray(product.labelImages)?product.labelImages:[]),...(Array.isArray(product.labelPhotos)?product.labelPhotos:[])];
  if(evidence.physicalPackPhotoInspected && evidence.sourceImage)photos.push({url:evidence.sourceImage,label:'香港標籤照片'});
  if(product.labelImageUrl)photos.push({url:product.labelImageUrl,label:'香港標籤照片'});
  const unique=[...new Map(photos.map(photo=>{const item=typeof photo==='string'?{url:photo,label:'香港標籤照片'}:photo;return [item.url,item];})).values()].filter(photo=>photo.url);
  const title=hkEvidenceLabel(product);
  if(!title&&!unique.length)return '';
  return `<section class="detail-section"><h3>香港標籤核對紀錄</h3><p><strong>${esc(title||'標籤來源待完整核對')}</strong>。${product.labelEvidence?.retailerPackageLabelImagesInspected?'已閱讀香港零售商公開包裝標籤圖；部分屬平面包裝設計圖，未確立每張是否實物照片。':product.labelEvidence?.packageLabelImageInspected?'已閱讀品牌公開圖像中可見嘅標籤；過敏未齊時不會當作完整聲明。屬品牌圖像，並非當前實物照片。':title==='香港背標照片已讀'?'已閱讀網上背標圖片及其可見內容。':unique.length?'已閱讀圖片中可見標籤；尚未完整核實嘅過敏或營養資料會保留未知。':'已閱讀香港品牌／零售商完整已刊成分及過敏聲明；營養只記錄來源實際提供嘅數值。'}未檢查你將購買嘅實物或當前批次；來源冇列出某過敏原唔等於保證不存在。</p>${unique.map(photo=>`<div>${link(photo.url,photo.label??'查看標籤圖片','source-link')}${photo.author?`<p class="source-scope">照片：${esc(photo.author)} / Open Food Facts contributors · ${esc(photo.uploadedAt??'上載日期見來源')} · ${link(photo.licenseUrl??'https://creativecommons.org/licenses/by-sa/3.0/',photo.license??'CC BY-SA 3.0')} · 本網站提供原圖連結</p>`:''}</div>`).join('')}${evidence.photoDateNote?`<p>${esc(evidence.photoDateNote)}</p>`:''}${product.nutrition?.conversionNote?`<p>換算註記：${esc(product.nutrition.conversionNote)}</p>`:''}</section>`;
}
function sourceWarning(product) {
  const warning = product.sourceLimit ?? product.versionNote ?? product.nutrition?.sourceLimit ?? product.nutrition?.versionNote;
  if (warning) return Array.isArray(warning) ? warning.join('；') : String(warning);
  if (product.nutrition?.hkVersionVerified === false || product.hkVersionVerified === false) return '營養來源屬海外版本，未核實與香港包裝配方一致。';
  return '';
}
function notesText(product) { return Array.isArray(product.notes) ? product.notes.join('；') : typeof product.notes==='string' ? product.notes : ''; }
function allergyLabel(product) {
  const assessment = getAllergenAssessment(product,filters.allergens);
  if (assessment.status==='no-listed-match') return {text:'來源未列所選過敏原',cls:'matched'};
  const list = (product.allergens?.contains??[]).map(id=>allergens[id]??id).join('、');
  const maybe = (product.allergens?.mayContain??[]).map(id=>allergens[id]??id).join('、');
  if (product.allergens?.status==='complete') return {text:[list?`含有：${list}`:'',maybe?`可能含有：${maybe}`:''].filter(Boolean).join('；')||'已有完整來源聲明',cls:''};
  return {text:list?`已知含有：${list}；資料未齊`:'過敏資料未齊，未能確認',cls:''};
}
function foodArt(product,index=0) {
  const drinks=product.category==='drinks';
  const colour=['#ad8058','#7d9670','#ba8b6d','#ad9d68','#648c81'][index%5];
  const label=drinks?'DRINK':/oat|燕麥/i.test(product.nameEn+' '+product.nameZh)?'OATS':product.category==='biscuits'?'CRUNCH':product.category==='snacks'?'SNACK':'FOOD';
  const svg=drinks?`<svg viewBox="0 0 140 125" aria-hidden="true"><path d="M45 16 57 6h31l12 12v99H42V18Z" fill="${colour}"/><path d="m45 16 12-10 1 12h40M58 18v99" fill="none" stroke="#ffffff66"/><path d="M41 39h59v50H41Z" fill="#faf8ed"/><text x="71" y="61" text-anchor="middle" fill="${colour}" font-size="11" font-family="Georgia,serif" font-weight="bold">${label}</text><path d="M58 72q13-15 26 0-14 17-26 0" fill="${colour}" opacity=".65"/><path d="M67 11h13" stroke="#e9f0df" stroke-width="4"/></svg>`:`<svg viewBox="0 0 140 125" aria-hidden="true"><path d="M24 15h91l-3 99H27Z" fill="${colour}"/><path d="M24 15h91v7H24m3 85h85v7H27" fill="#ffffff25"/><path d="M24 22h91M27 107h85" fill="none" stroke="#ffffff55"/><rect x="31" y="34" width="77" height="42" rx="2" fill="#faf7e9"/><text x="70" y="52" fill="${colour}" font-size="6" text-anchor="middle" font-family="system-ui">EVERYDAY CHOICES</text><text x="70" y="67" fill="${colour}" font-size="12" font-weight="bold" text-anchor="middle" font-family="Georgia,serif">${label}</text><circle cx="63" cy="92" r="18" fill="#dfbc81" stroke="#c18e54" stroke-width="3"/><circle cx="80" cy="96" r="17" fill="#d1a05d" stroke="#bd8448" stroke-width="3"/><path d="m58 89 4 0m15 3 4 0m-9 8 4 0m-13-5 2 0" stroke="#a07140" stroke-width="2.5"/></svg>`;
  return `<div class="product-visual tone-${index%5+1}">${svg}<span class="visual-caption">品類示意圖</span></div>`;
}
function productCard(product,index) {
  const n=nutritionFor(product);
  const prices=getEligiblePrices(product,filters).sort((a,b)=>a.price-b.price);
  const price=getMinPrice(product,filters);
  const chosen=selected.includes(product.id);
  const a=allergyLabel(product);
  const complete=product.allergens?.status==='complete';
  const documented=hasNutrition(product);
  const sourceStatus=complete?'完整過敏聲明':documented?'有營養資料':'標籤待補';
  const sourceQualifier=product.nutritionSourceFamily==='off-community-reference'?'OFF 社群參考':
    product.nutrition?.hkVersionVerified===false||product.hkVersionVerified===false||product.nutrition?.region==='overseas-reference'?'海外配方參考':'';
  const offer=(product.offers??[]).some(item=>(!filters.store||item.store===filters.store)&&(item.textZh||item.textEn));
  const productName=product.nameZh||product.nameEn;
  return `<article class="product-card${chosen?' selected':''}" data-product="${esc(product.id)}">
    <div class="product-artwork">${foodArt(product,index)}</div>
    <div class="product-body">
      <div class="product-identity">
        <p class="product-brand">${esc(brandName(product))}</p>
        <h3>${esc(productName)}</h3>
        <p class="product-size">${esc(product.packSize??'包裝待確認')} · ${esc(categories[product.category]??'包裝食品')}</p>
      </div>
      <div class="product-badges"><span class="status-badge${complete?'':' partial'}">${sourceStatus}</span>
        ${offer?'<span class="offer-badge" title="來源記有優惠，請向商戶確認">有優惠紀錄</span>':''}
      </div>
      <div class="nutrient-heading"><span>${esc(basisLabel(product))}${sourceQualifier?` · ${sourceQualifier}`:''}</span></div>
      <div class="nutrient-strip">
        ${[['碳水',n.carbohydrates,'g'],['糖',n.sugars,'g'],['鈉',n.sodiumMg,'mg']].map(([label,value,unit])=>`<div><small>${label}</small><strong>${number(value)}${shownValue(value)===null?'':`<small> ${unit}</small>`}</strong></div>`).join('')}
      </div>
      <p class="allergen-line ${a.cls}">${esc(a.text)}</p>
      <div class="product-pricing">
        <div class="price-line"><span class="price">${price===null?'價格待補':`<small>HK$</small>${money(price)}<span class="price-from">${filters.store?'':'起'}</span>`}</span><span class="merchant-count">${prices.length} 個渠道</span></div>
        <p class="merchant-label">${esc(prices.length?stores[prices[0].store]??prices[0].store:'暫無已核實價格')}${prices.length?' · 整包單件價':''}</p>
        ${cardUnitPrice(product,price)}
      </div>
      <div class="card-actions">
        <button type="button" data-detail="${esc(product.id)}" aria-label="查看 ${esc(productName)} 詳情及購買渠道"><span class="action-long">詳情 / 購買 ↗</span><span class="action-short">詳情</span></button>
        <button class="compare-add" type="button" data-compare="${esc(product.id)}" aria-pressed="${chosen}" aria-label="${chosen?'移除':'加入'}${esc(productName)}${chosen?'嘅比較':'作比較'}"><span class="action-long">${chosen?'✓ 已加入':'＋ 加入比較'}</span><span class="action-short">${chosen?'已選':'比較'}</span></button>
      </div>
    </div></article>`;
}
function filterTotal() { return Number(Boolean(filters.query))+Number(Boolean(filters.category))+Number(filters.budget!==null)+Number(Boolean(filters.store))+filters.allergens.length+Number(Boolean(filters.origin))+Number(Boolean(filters.dataScope))+Number(filters.libraryScope!=='priced'); }
function syncInputs() {
  $('food-search').value=filters.query;
  $('budget').value=filters.budget??'';
  $('store').value=filters.store;
  $('origin').value=filters.origin;
  $('sort').value=filters.sort;
  $('data-scope').value=filters.dataScope;
  $('library-scope').value=filters.libraryScope;
  document.querySelectorAll('[data-category]').forEach(button=>{const active=button.dataset.category===filters.category;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('input[name=allergen]').forEach(input=>input.checked=filters.allergens.includes(input.value));
  document.querySelectorAll('[data-budget]').forEach(button=>button.classList.toggle('active',Number(button.dataset.budget)===filters.budget));
}
function renderActiveFilters() {
  const entries=[];
  if(filters.query)entries.push(['query',`搜尋：${filters.query}`]);
  if(filters.category)entries.push(['category',categories[filters.category]??filters.category]);
  if(filters.budget!==null)entries.push(['budget',`每包 ≤ $${number(filters.budget)}`]);
  if(filters.store)entries.push(['store',stores[filters.store]??filters.store]);
  if(filters.origin)entries.push(['origin',`產地：${filters.origin}`]);
  if(filters.dataScope)entries.push(['dataScope',filters.dataScope==='nutrition'?'有營養參考數值':filters.dataScope==='hk-nutrition'?'香港營養來源已讀':filters.dataScope==='comparable'?'明確每100g／ml基準':'香港完整過敏聲明']);
  if(filters.libraryScope!=='priced')entries.push(['libraryScope',filters.libraryScope==='off-library'?'OFF擴展營養參考庫':'全部資料庫']);
  filters.allergens.forEach(id=>entries.push([`allergen:${id}`,`避開${allergens[id]??id}`]));
  if(filters.sort&&filters.sort!=='relevance')entries.push(['sort',`排序：${sortLabels[filters.sort]??filters.sort}`]);
  $('active-filters').innerHTML=entries.map(([key,text])=>`<span class="active-filter">${esc(text)}<button data-remove-filter="${esc(key)}" aria-label="移除${esc(text)}條件">×</button></span>`).join('');
  $('filter-count').textContent=String(filterTotal());
}
function render() {
  if(!dataset)return;
  const signature=JSON.stringify(filters);
  if(signature!==filterSignature){visibleCount=PAGE_SIZE;filterSignature=signature;}
  // The banner describes what the link set; once the person changes the conditions it no longer applies.
  if(linkSignature&&signature!==linkSignature){$('link-banner').hidden=true;linkSignature=null;}
  results=filterProducts(products,filters);
  const queryWarnings=searchQueryLimitations(filters.query);
  $('search-feedback').textContent=queryWarnings.join(' ');
  $('search-feedback').hidden=!queryWarnings.length;
  $('result-count').textContent=filters.allergens.length?`${number(results.length)} 項來源未列所選過敏原`:
    `${number(results.length)} 項食品${filters.libraryScope==='off-library'?' · OFF 參考庫':filters.libraryScope==='all'?' · 全部資料庫':''}`;
  $('product-grid').innerHTML=results.slice(0,visibleCount).map(productCard).join('');
  $('load-more').hidden=visibleCount>=results.length;
  $('page-status').textContent=results.length?`顯示 ${Math.min(visibleCount,results.length)} / ${results.length} 項；搜尋及篩選已涵蓋全部資料。`:'';
  $('product-grid').setAttribute('aria-busy','false');
  $('empty-state').hidden=results.length>0;
  $('allergy-notice').hidden=!filters.allergens.length;
  if(filters.allergens.length){
    const candidates=filterProducts(products,{...filters,allergens:[]});
    const conflicts=candidates.filter(p=>getAllergenAssessment(p,filters.allergens).status==='conflict').length;
    const unknown=candidates.filter(p=>getAllergenAssessment(p,filters.allergens).status==='unknown').length;
    $('allergy-notice').textContent=`排除含有／可能含有嘅 ${conflicts} 項同資料不足嘅 ${unknown} 項。購買前請核對實物包裝。`;
    $('empty-description').textContent=results.length?'':`目前條件下，${conflicts} 項列出所選過敏原，${unknown} 項資料不足。未有可確認符合條件嘅產品；你可以調整名稱、預算或商戶，網站唔會自動放寬過敏限制。`;
  }else $('empty-description').textContent='試下另一個名稱，或者調整預算及商戶。資料庫仍在逐件補充；冇結果唔代表市面冇呢類食品。';
  const groups=rankingGroups(results,filters.sort);
  $('sort-note').hidden=groups.length<2;
  $('sort-note').textContent=groups.length<2?'':`已按單位分開排名：先列 ${groups.map(g=>`${number(g.count)} 項每100${g.unit}`).join('，再列 ')}；兩組數值唔可以互相比較，未知數值排最後。`;
  renderActiveFilters();
  renderTray();
  renderEmptyActions();
  $('copy-link').hidden=!filterTotal()&&filters.sort==='relevance';
  syncUrl();
}
function renderTray() {
  $('compare-tray').hidden=!selected.length;
  document.body.classList.toggle('has-comparison',Boolean(selected.length));
  $('compare-count').textContent=selected.length;
  $('selected-names').textContent=selected.map(id=>products.find(p=>p.id===id)?.nameZh??id).join(' · ');
  $('open-comparison').disabled=selected.length<2;
}
function toggleCompare(id) {
  if(selected.includes(id))selected=selected.filter(item=>item!==id);
  else if(selected.length>=3){toast('最多同時比較 3 項食品；請先移除其中一項。');return;}
  else selected.push(id);
  render();
  if($('compare-dialog').open)renderComparison();
}
function updateFilters({sync=false}={}) {
  const removed=selected.filter(id=>filters.allergens.length && getAllergenAssessment(products.find(p=>p.id===id),filters.allergens).status!=='no-listed-match');
  if(removed.length){selected=selected.filter(id=>!removed.includes(id));toast(`已移除 ${removed.length} 項未能符合過敏條件嘅比較食品。`);}
  if(sync)syncInputs();
  document.querySelectorAll('[data-budget]').forEach(button=>button.classList.toggle('active',Number(button.dataset.budget)===filters.budget));
  render();
}
function resetFilters(){filters=defaults();syncInputs();render();$('request-feedback').textContent='';}
function openDialog(id){$(id).showModal();}
function sourceLinks(product){
  return (product.sources??[]).map(source=>`<div>${link(source.url,source.label??source.name??'資料來源','source-link')}<div class="source-scope">${esc(Array.isArray(source.scope)?source.scope.join('、'):source.scope??'產品資料')} · 查閱 ${esc(dateLabel(source.checkedAt))}</div></div>`).join('') || '<p>此項來源尚待補充。</p>';
}
function carbDefinition(product) {
  const value=product.nutrition?.carbohydrateDefinition;
  return value==='available'?'可利用碳水化合物':value==='total'?'總碳水化合物（來源定義）':'來源未明確區分總／可利用碳水';
}
function detailNutritionTable(product) {
  const base=nutritionFor(product);
  const pack=getPackNutrition(product);
  const columns=[{label:basisLabel(product),values:base}];
  if(pack.whole)columns.push({label:`每售賣包裝 ${number(pack.totalAmount)} ${pack.unit}`,values:pack.whole});
  if(pack.inner)columns.push({label:`每小包 ${number(pack.innerAmount)} ${pack.unit}`,values:pack.inner});
  return `<table class="nutrition-table"><caption>營養數值 · 「—」代表未知</caption>
    <thead><tr><th scope="col">營養項目</th>${columns.map(column=>`<th scope="col">${esc(column.label)}</th>`).join('')}</tr></thead>
    <tbody>${nutrientFields.map(([key,label,unit])=>`<tr><th scope="row">${label}</th>${columns.map(column=>`<td>${nutrientValue(column.values[key],unit)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>${pack.whole?'<p class="source-scope">每包數值按標籤及包裝份量換算。</p>':''}`;
}
function merchantPriceRows(product,prices) {
  if(!prices.length)return '<p>暫無已核實價格。</p>';
  return prices.map(price=>{
    const date=dateLabel(price.checkedAt??dataset.priceSnapshotAt??dataset.updatedAt);
    const unitPrices=packPriceLines(product,price.price);
    const destination=(price.linkType==='product'||price.urlKind==='product')?'到商品頁':price.linkType==='search'?'到商戶搜尋':price.linkType==='price-source'?'到消委會格價頁':'到商戶網站';
    return `<div class="merchant-row"><div>${esc(stores[price.store]??price.store)}<small>查閱 ${esc(date)}</small></div>
      <div><strong>HK$${money(price.price)}</strong>${unitPrices.length?`<small>${esc(unitPrices.join(' · '))}</small>`:''}</div>
      ${link(price.url??price.sourceUrl,destination)}</div>`;
  }).join('');
}
function renderDetail(product) {
  detailProduct=product;
  const index=products.indexOf(product);
  const warning=sourceWarning(product);
  const prices=getEligiblePrices(product).sort((a,b)=>a.price-b.price);
  const label=product.allergens??{};
  $('detail-content').innerHTML=`<div class="detail-heading">${foodArt(product,index)}<div><p>${esc(brandName(product))}</p><h2>${esc(product.nameZh??product.nameEn)}</h2><p>${esc(product.nameEn??'')}</p><p>${esc(product.packSize??'包裝待確認')} · 產地：${esc(product.origin??'未確認')}</p>${product.offMetadata?`<p class="source-scope">OFF 來源最後修改：${esc(String(product.offMetadata.lastModifiedAt??'未提供').slice(0,10))} · ${esc(product.offMetadata.sourceApi??'社群資料')} · 未逐張核對香港包裝</p>`:''}${product.barcode?`<p>來源條碼：${esc(product.barcode)}</p>`:''}</div></div>${warning?`<div class="inline-notice amber">${esc(warning)}</div>`:''}${product.sourceCategory?`<p class="source-scope">消委會分類：${esc([product.sourceCategory.zh,...(product.sourceCategory.pathZh??[])].filter(Boolean).join(" / "))} · 商品代號 ${esc(product.id)}（非條碼）</p>`:''}<section class="detail-section"><h3>營養標籤比較</h3>${detailNutritionTable(product)}<p>碳水定義：${esc(carbDefinition(product))}。糖係碳水化合物嘅一部分；本頁唔計算「淨碳水」。</p>${notesText(product)?`<p>${esc(notesText(product))}</p>`:''}</section><section class="detail-section" data-allergen-evidence><h3>成分與過敏聲明</h3><p><strong>資料狀態：</strong>${label.status==='complete'?'已記錄指定版本完整聲明；仍須核對當前包裝':'未完整核實，不能用作確認過敏安全'}</p><p><strong>已知含有：</strong>${esc(label.contains?.length?label.contains.map(id=>allergens[id]??id).join('、'):'未列出／未能確認')}</p><p><strong>已知可能含有：</strong>${esc(label.mayContain?.length?label.mayContain.map(id=>allergens[id]??id).join('、'):'未列出／未能確認')}</p>${label.text?`<p>${esc(label.text)}</p>`:''}${product.ingredients||product.ingredientsSummary?`<p><strong>成分資料摘要：</strong>${esc(product.ingredientsSummary??(typeof product.ingredients==='string'?product.ingredients:product.ingredients.text??'見原始來源'))}</p>`:''}<p>未列出唔代表不存在。對食品過敏者應核對實物包裝，必要時直接向生產商確認。</p></section><section class="detail-section"><h3>香港價格與購買渠道</h3><p>整包單件價格快照。單位價按標示淨重／容量計，優惠另列。</p>${merchantPriceRows(product,prices)}</section>${product.offers?.length?`<section class="detail-section"><h3>來源優惠備註</h3><p>以下只保留原始優惠文字，未套入單件預算；適用日期、會員及購買數量請向商戶核實。</p>${product.offers.map(offer=>`<p><strong>${esc(stores[offer.store]??offer.store)}：</strong>${esc(offer.textZh||offer.textEn||'見來源')}</p>`).join('')}</section>`:''}<section class="detail-section"><h3>逐項資料來源</h3>${sourceLinks(product)}</section><div style="margin-top:20px"><button class="secondary-button" data-detail-compare="${esc(product.id)}">${selected.includes(product.id)?'從比較移除':'加入營養比較'}</button></div>`;
}
function addLabelEvidence(product) {
  const markup=labelEvidenceSection(product);
  if(markup)$('detail-content').querySelector('.detail-section')?.insertAdjacentHTML('beforebegin',markup);
  const raw=product.sourceNutrition??{},nativeAmount=raw.basisAmount??product.nutrition?.basisAmount;
  const nativeUnit=raw.basisUnit??product.nutrition?.basisUnit;
  if(hasReviewedHkNutrition(product)&&Number.isFinite(nativeAmount)&&nativeAmount!==100){
    $('detail-content').querySelector('.nutrition-table')?.insertAdjacentHTML('afterend',`<p class="source-scope">原標基準：每 ${number(nativeAmount)} ${esc(nativeUnit)}，表內換算為每100${esc(nativeUnit)}；${nativeAmount<100?'小份量原標嘅四捨五入會隨換算放大':'換算保留原標四捨五入及標示精度限制'}，「0」不代表經化驗確認絕對為零。</p>`);
  }
  const conflict=product.nutrition?.sourceConflict;
  if(conflict?.field==='sodiumMg'&&Number.isFinite(conflict.retailerPhotoValue)&&Number.isFinite(conflict.brandOfficialValue)){
    $('detail-content').querySelector('.nutrition-table')?.insertAdjacentHTML('afterend',`<p class="source-conflict">鈉值暫留未知：同款200ml嘅${link(conflict.retailerPhoto,'香港零售商照片')}列 ${number(conflict.retailerPhotoValue)} mg／100ml，${link(conflict.brandOfficialImage,'品牌香港營養圖')}列 ${number(conflict.brandOfficialValue)} mg／100ml。來源版本未能釐清，沒有選取其中一個當作現售值。</p>`);
  }
  const versions=product.nutritionSourceConflict;
  if(versions?.olderFullTable&&versions?.newerFront&&versions.fields?.length){
    const differences=versions.fields.map(key=>{const field=nutrientFields.find(f=>f[0]===key);return field?`${field[1]} ${number(versions.olderFullTable.values?.[key])}／${number(versions.newerFront.values?.[key])} ${field[2]}`:'';}).filter(Boolean).join('；');
    $('detail-content').querySelector('.nutrition-table')?.insertAdjacentHTML('afterend',`<p class="source-conflict">公開版本不同：${link(versions.olderFullTable.transcribedFromImage,'舊完整表')}／${link(versions.newerFront.url,'較新正面摘要')}，原份量每${number(versions.olderFullTable.basisAmount)}${esc(versions.olderFullTable.basisUnit)}：${esc(differences)}。有矛盾嘅欄位保留未知，未判定現售配方。</p>`);
  }
  const additional=product.allergens?.additionalAllergens??[];
  if(additional.length){
    const names={molluscs:'軟體貝類',coconut:'椰子',mustard:'芥末',celery:'芹菜'};
    $('detail-content').querySelector('[data-allergen-evidence]')?.insertAdjacentHTML('beforeend',`<p class="source-scope">來源另提及：${esc(additional.map(x=>names[x]??x).join('、'))}。此頁10類篩選未涵蓋所有過敏情況，請閱讀原標。</p>`);
  }
  if(product.additionalWarnings?.length)$('detail-content').querySelector('.nutrition-table')?.insertAdjacentHTML('afterend',`<p class="source-scope">原標其他警告：${esc(product.additionalWarnings.join('；'))}。無糖食品仍可能含碳水化合物，請分別閱讀兩欄。</p>`);
}
function compareTableRows(chosen) {
  const basis=comparisonBasis;
  const packNutrition=basis==='package'?chosen.map(getPackNutrition):[];
  const values=chosen.map((product,index)=>basis==='package'?packNutrition[index].whole??{}:
    nutritionFor(product,basis,basis==='portion'?comparisonPortion:null));
  const basisCells=chosen.map((product,index)=>{
    if(basis==='package'){
      const pack=packNutrition[index];
      return pack.whole?`${number(pack.totalAmount)} ${pack.unit}`:'—';
    }
    if(productUnit(product))return `${basis==='100'?'100':number(comparisonPortion)} ${productUnit(product)}`;
    return basis==='100'?basisLabel(product):'—';
  });
  let html=`<tr><th scope="row">比較份量</th>${basisCells.map(label=>`<td>${esc(label)}</td>`).join('')}</tr>`;
  const units=new Set(chosen.map(productUnit));
  const sameBasis=basis!=='package'&&units.size===1&&!units.has(null);
  const definitions=new Set(chosen.map(product=>product.nutrition?.carbohydrateDefinition));
  const lowest=key=>{
    if(!sameBasis||!LOWEST_KEYS.has(key))return null;
    if(key==='carbohydrates'&&(definitions.size!==1||![...definitions].every(value=>value==='available'||value==='total')))return null;
    const known=values.map(n=>shownValue(n[key])).filter(value=>value!==null);
    if(known.length<2||Math.min(...known)===Math.max(...known))return null;
    return Math.min(...known);
  };
  html+=nutrientFields.map(([key,label,unit])=>{
    const min=lowest(key);
    return `<tr><th scope="row">${label}</th>${values.map(n=>`<td>${nutrientValue(n[key],unit)}${min!==null&&shownValue(n[key])===min?'<span class="lowest-tag">最低</span>':''}</td>`).join('')}</tr>`;
  }).join('');
  const prices=chosen.map(product=>getMinPrice(product,filters));
  const packPrices=chosen.map((product,index)=>getPackPrices(product,prices[index]));
  html+=`<tr class="group-row"><th colspan="${chosen.length+1}">香港價格 · ${esc(stores[filters.store]??'所有商戶')}</th></tr>`;
  html+=`<tr><th scope="row">整包單件價</th>${chosen.map((product,index)=>`<td>${prices[index]===null?'—':`HK$${money(prices[index])}`}<span class="table-small">${esc(product.packSize??'包裝待確認')}</span></td>`).join('')}</tr>`;
  html+=`<tr><th scope="row">每 100 g／ml</th>${packPrices.map(pack=>`<td>${pack.per100===null?'—':`HK$${money(pack.per100)}<span class="table-small">／100${pack.unit}</span>`}</td>`).join('')}</tr>`;
  if(packPrices.some(pack=>pack.perInner!==null))html+=`<tr><th scope="row">每小包價</th>${packPrices.map(pack=>`<td>${pack.perInner===null?'—':`HK$${money(pack.perInner)}<span class="table-small">${pack.innerCount} 小包</span>`}</td>`).join('')}</tr>`;
  html+=`<tr><th scope="row">過敏聲明</th>${chosen.map(product=>`<td class="neutral">${esc(allergyLabel(product).text)}</td>`).join('')}</tr>`;
  return html;
}
function comparisonSources(chosen) {
  return `<details class="comparison-context"><summary>碳水定義、價格渠道與來源</summary>
    ${chosen.map(product=>`<section class="detail-section">
      <h3>${esc(product.nameZh||product.nameEn)}</h3>
      <p>${esc(carbDefinition(product))}</p>
      <p>${esc(getEligiblePrices(product,filters).map(price=>`${stores[price.store]??price.store} HK$${money(price.price)}`).join(' / ')||'所選商戶暫無價格')}</p>
      ${sourceWarning(product)?`<p>${esc(sourceWarning(product))}</p>`:''}
      ${sourceLinks(product)}
    </section>`).join('')}
  </details>`;
}
function renderComparison(){
  const chosen=selected.map(id=>products.find(p=>p.id===id)).filter(Boolean);
  if(chosen.length<2){if($('compare-dialog').open)$('compare-dialog').close();toast('請先揀至少 2 項食品作比較。');return;}
  const mixed=new Set(chosen.map(productUnit).filter(Boolean)).size>1;
  const excluded=chosen.filter(product=>!results.some(p=>p.id===product.id));
  $('compare-content').innerHTML=`
    ${excluded.length?'<p class="inline-notice amber">部分已選食品超出目前搜尋、預算或商戶條件。</p>':''}
    ${mixed?'<p class="inline-notice amber">比較時請分開睇 g 同 ml。</p>':''}
    <div class="comparison-controls">
      <label for="comparison-basis">比較方式</label>
      <select id="comparison-basis">
        ${[['100','每 100 g／ml'],['package','每個售賣包裝'],['portion','自訂份量']].map(([value,label])=>`<option value="${value}"${comparisonBasis===value?' selected':''}>${label}</option>`).join('')}
      </select>
      <label for="comparison-portion"${comparisonBasis==='portion'?'':' hidden'}>自訂份量（g／ml）</label>
      <input id="comparison-portion" type="number" min="0.1" max="10000" step="0.1" value="${Number.isFinite(comparisonPortion)?comparisonPortion:''}"${comparisonBasis==='portion'?'':' hidden'}>
    </div>
    <p class="comparison-note">營養按標籤換算。「—」係未知。購買前請核對實物。</p>
    <div class="table-scroll" aria-label="食品比較表">
      <table class="comparison-table comparison-${chosen.length}">
        <thead><tr><th scope="col">項目</th>${chosen.map(product=>`<th scope="col">
          <span class="compare-product-name">${esc(product.nameZh||product.nameEn)}</span>
          <button type="button" class="comparison-remove" data-remove-compare="${esc(product.id)}" aria-label="移除 ${esc(product.nameZh||product.nameEn)}">移除 ×</button>
        </th>`).join('')}</tr></thead>
        <tbody id="comparison-rows">${compareTableRows(chosen)}</tbody>
      </table>
    </div>
    <p class="comparison-note">價格快照 ${esc(snapshotLabel())} · 未套用優惠。</p>
    ${comparisonSources(chosen)}`;
}
function showPortionError(invalid) {
  let error=$('portion-error');
  if(!error){error=document.createElement('p');error.id='portion-error';error.className='inline-notice amber';error.setAttribute('role','status');$('compare-content').querySelector('.comparison-controls')?.after(error);}
  error.hidden=!invalid;
  error.textContent=invalid?'請輸入大於 0、最多 10000 嘅份量。數值未有效前，營養換算保留未知。':'';
}
function renderSources(){
  const dated=snapshotLabel();
  const nutritionCount=products.filter(hasNutrition).length;
  const completeCount=products.filter(p=>p.allergens?.status==='complete').length;
  const imported=dataset?.imports?.pricewatch;
  const prices=products.reduce((sum,p)=>sum+(p.prices??[]).length,0);
  $('sources-content').innerHTML=`<p>網站收錄 <strong>${number(products.length)} 項食品</strong>、${number(prices)} 筆商戶價格。${nutritionCount} 項有部分或完整營養數值；${completeCount} 項有指定香港來源完整過敏聲明。大量格價記錄唔等於大量已核對營養／過敏標籤。</p><div class="source-card"><h3>消費者委員會「格價資訊通」：已批量匯入</h3><p>${imported?`已匯入 ${number(imported.importedCount)} 項一般食品、${number(imported.priceObservationCount)} 筆價格，涵蓋 ${imported.merchantCount} 個商戶代碼，包括惠康、百佳、Market Place 及 AEON。`:'整批資料暫未載入，目前只顯示逐件核對記錄。'}來源提供中英文品牌、商品、分類、規格名稱、各店單件價及優惠文字；沒有營養、成分、過敏原、條碼或即時庫存。擷取：${esc(dated)}；唔係即時價格。官方每日更新，本網站係已儲存快照，未有自動每日同步。</p>${link('https://data.gov.hk/tc-data/dataset/cc-pricewatch-pricewatch','DATA.GOV.HK 官方資料集','source-link')}${link('https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json','消委會原始價格資料','source-link')}${link('https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch_data_dictionary.pdf','欄位說明','source-link')}<p>${imported?`原檔 ${number(imported.rawRecordCount)} 項，排除 ${number(imported.excludedRecordCount)} 項酒類、家居／寵物用品、個人護理及混合奶粉／嬰兒用品組；因此成人奶粉亦暫未涵蓋。`:''}只涵蓋官方清單所列商戶及商品，唔代表全港超市所有商品。P 開頭來源代號唔係條碼；只在另有品牌、口味及容量一致證據時配對參考營養，唔會單靠相似名稱混配。</p></div><div class="source-card"><h3>惠康、百佳與香港品牌：逐件補充標籤</h3><p>香港價格由消委會清單提供；可取得嘅香港品牌／零售商商品頁及背標照片，另作逐件核對。商戶連結會標示係商品頁、商戶主頁或格價資料頁。已由惠康公開商品詳情取得對應包裝圖並逐張閱讀，並非全庫營養／過敏表。部分圖庫混有不同口味或容量舊圖，已按可見身份扣起；百佳部分頁面未能存取，未繞過限制。</p></div><div class="source-card"><h3>政府食安中心 NIIS：一般食物營養參考</h3><p>政府資料庫可查一般食物營養；品牌、配方及批次可以不同，平均值不能代填某款包裝食品嘅營養或過敏聲明。本網站提供官方查詢入口，未將其整個資料庫複製公開；食安中心再分發條款要求事先書面授權。</p>${link('https://www.cfs.gov.hk/tc_chi/nutrient/','到政府 NIIS 查詢','source-link')}${link('https://www.cfs.gov.hk/english/notices/notices.html','政府資料使用條款','source-link')}${link('https://www.cfs.gov.hk/english/faq/faq_14.html','營養標籤 FAQ','source-link')}</div><div class="source-card"><h3>香港營養學會 HKNA</h3><p>已閱讀2026年飲品及食品兩份共39頁表格，選取同品牌、口味及個別包裝容量一致嘅營養事實；原表有320項，未整庫複製。能量按明示單包容量換算，未提供嘅總碳水等維持未知。學生小食分類唔係糖尿病患者適合標準，未有用一般食品平均值填補品牌數字。</p>${link('https://www.hkna.org.hk/database-of-prepackaged-snacks-2026/','HKNA 官方資料庫介紹','source-link')}</div><h3>篩選及比較方式</h3><ul><li>預算按所選商戶嘅整包單件價計算；未套用會員、多件優惠、運費，未知價格唔當零。</li><li>過敏篩選排除含有、可能含有及資料不足。大量新增價格記錄唔會自動通過過敏條件；未列出唔等於保證安全。</li><li>已確認基準可按每100g／100ml或自訂份量計算；OFF舊索引未區分g／ml時只顯示每100單位原值，禁止份量換算及營養排名；缺失值保留未知；唔作藥物相容性或整日膳食判斷。</li><li>每次先顯示24項；搜尋及篩選涵蓋整個已載入資料庫。</li><li>AI 條件助手（EdUHK MaaS）只會建議條件同連結，網站會逐項驗證，未能辨認嘅過敏原會提示；AI 唔接觸產品數字。離線快速解讀係固定字詞，唔係生成式 AI，喺你部機處理。網站冇要求登入或儲存病歷、藥物及過敏資料。</li><li>每100ml 同每100g 會分開排名；比較表嘅「最低」只係同一基準下嘅數字比較。</li></ul><p>價格資料擁有權：消費者委員會。來源：消費者委員會「格價資訊通」及 DATA.GOV.HK。資料供應方沒有認可或背書本學生原型。品牌及零售商保留各自權利。</p>${link('https://data.gov.hk/en/terms-and-conditions','DATA.GOV.HK 使用條款','source-link')}<p><a href="data/products.json" target="_blank" rel="noopener">逐件核對嘅標籤資料 ↗</a> · <a href="data/pricewatch-meta.json" target="_blank" rel="noopener">整批匯入範圍及日期 ↗</a> · <a href="data/pricewatch-foods.json" target="_blank" rel="noopener">本網站食品價格快照 ↗</a></p>`;
}

function addOpenFoodFactsSources(){
  const off=dataset?.openFoodFacts;
  const expanded=dataset?.enrichment;
  if(expanded)$('sources-content').insertAdjacentHTML('afterbegin',`<div class="source-card"><h3>舊有 OFF 參考庫：不計入1,000款香港來源目標</h3><p>原有 ${number(expanded.pricedCount)} 項香港格價食品中，${number(expanded.pricedNutrition)} 項有部分或完整營養。另保留 ${number(expanded.added)} 項不重複 OFF 香港市場標記營養參考（本輪沒有增加），未有已核實本地價格或渠道。共 ${number(expanded.explicitBasis)} 項營養來源明確區分每100g／100ml；其他每100單位參考不換算份量、不作營養排名。</p><p>香港市場標記由社群填寫，唔代表目前在港有售或香港配方相同。批量 OFF 紀錄未逐張閱讀包裝、過敏一律未知；舊索引部分來源最後更新在2014–2024年，現行API取得嘅紀錄另有2025／2026年更新。每項保留來源最後修改日期。糖、飽和脂肪、鹽鈉及能量矛盾或身份不明嘅候選已扣起；仍可能有來源錯誤。</p><p>資料：Open Food Facts contributors，ODbL1.0／DbCL1.0。香港品牌及HKNA資料個別註明來源及限制。</p><p><a href="data/off-nutrition-library.json" target="_blank" rel="noopener">OFF 衍生營養資料、配對及來源日期 ↗</a> · <a href="data/hk-nutrition-expansion.json" target="_blank" rel="noopener">香港品牌與HKNA配對 ↗</a> · <a href="enrichment.mjs" target="_blank" rel="noopener">公開合併及去重方法 ↗</a></p></div>`);
  if(!off?.recordCount)return;
  $('sources-content').insertAdjacentHTML('afterbegin',`<div class="source-card"><h3>Open Food Facts：逐張核對香港標籤</h3><p>先前逐張閱圖批次有 ${off.recordCount} 項 OFF 來源紀錄；本輪另有15項，分兩份檔案保留閱圖及授權紀錄。先核對香港市場、同款口味、容量及條碼，再人工閱讀原始圖片；唔會用空白自動過敏欄當成「沒有過敏原」。部分照片只見營養／成分，未有完整警告，仍不能通過過敏篩選。照片上載年份及版本限制見商品詳情。</p><p>資料：Open Food Facts contributors，ODbL 1.0；個別內容 DbCL 1.0。圖片按各作者署名，CC BY-SA 3.0；本網站提供原圖連結。OFF 衍生資料及修改另列公開檔案，保留開放及相同方式分享要求；品牌、其他來源及商標權利依原來源。</p>${link('https://world.openfoodfacts.org','Open Food Facts','source-link')}${link('https://opendatacommons.org/licenses/odbl/1-0/','ODbL 使用條款','source-link')}<p><a href="data/off-hk-labels.json" target="_blank" rel="noopener">OFF 衍生紀錄、修正及圖片署名 ↗</a> · <a href="catalogue.mjs" target="_blank" rel="noopener">公開合併方法 ↗</a>；其他合併輸入檔案於下方來源連結提供。</p></div>`);
}

function addHkReviewSources(){
  const c=hkLabelCoverage(products),review=dataset.hkLabelReview;
  const records=(review?.batches??[]).reduce((sum,b)=>sum+(b.recordCount??0),0);
  $('sources-content').insertAdjacentHTML('afterbegin',`<div class="source-card"><h3>原有香港格價商品：本輪人工補標籤</h3><p>只對應原有 ${number(c.original)} 項商品。本輪公開 ${number(records)} 份已讀來源紀錄；${number(review?.nutritionAdded??0)} 項由沒有數值變為有營養，${number(review?.nutritionUpgraded??0)} 項由社群／次級參考改用整份香港來源表。現共 ${number(c.reviewedNutrition)} 項已讀香港營養來源，其中 ${number(c.fullCoreNutrition)} 項有完整1+7數值；${number(c.completeAllergy)} 項有來源版本完整過敏聲明。公開來源已讀不等於現售批次已驗證。</p><p>新增來源包括李錦記／雀巢香港官方標籤圖、日清香港完整產品營養頁、惠康包裝標籤圖，以及有作者及日期嘅OFF香港包裝照片。零售圖像可能係平面包裝設計圖，唔當作本組檢查過嘅實物。按品牌、口味、容量及可見條碼核對；零售商內部貨號不當實物條碼。不同口味舊圖、真實條碼／容量衝突及模糊數字已扣起。美極200ml嘅兩個香港來源鈉值矛盾，保留未知及雙方原圖；沒有用其他容量補入。</p><p><a href="data/hk-reviewed-labels.json" target="_blank" rel="noopener">本輪香港品牌／零售商標籤及配對 ↗</a> · <a href="data/off-hk-reviewed-labels.json" target="_blank" rel="noopener">本輪OFF人工閱圖、署名及修正（ODbL／DbCL）↗</a> · <a href="data/hk-reviewed-labels-extra.json" target="_blank" rel="noopener">追加香港來源、原份量及限制 ↗</a> · <a href="data/off-hk-reviewed-labels-extra.json" target="_blank" rel="noopener">追加OFF香港照片、署名及修正 ↗</a> · <a href="hk-labels.mjs" target="_blank" rel="noopener">原有商品合併與覆蓋計算 ↗</a></p></div><div class="source-card"><h3>政府來源查到甚麼？</h3><p>已查DATA.GOV.HK、食安中心NIIS、低糖低鹽商品名單及EatSmart。營養標籤豁免資料集提供產品及豁免資料，沒有營養表；NIIS是一般食物成分，不能當指定品牌標籤；低糖低鹽名單362項多為正面／小圖，本輪可讀候選未足以可靠新增數值。EatSmart小食分析是自行輸入營養嘅工具。政府來源本輪沒有新增可核實嘅品牌營養數值，沒有拿平均值或標誌推算。</p>${link('https://data.gov.hk/en-data/dataset/hk-fehd-fehdfics-products-exempted-from-nutrition-labelling','政府：營養標籤豁免名單','source-link')}${link('https://www.cfs.gov.hk/english/nutrient/index.php','食安中心NIIS','source-link')}${link('https://www.cfs.gov.hk/english/programme/programme_rdss/product_list.php?lang=en&search=no','低糖低鹽商品名單','source-link')}${link('https://school.eatsmart.gov.hk/b5/snack_list.aspx','EatSmart 小食分析','source-link')}</div>`);
}

function applyParsedRequest(text){
  const parsed=parseRequest(text);
  const kept=filters.allergens.filter(id=>!parsed.allergens.includes(id));
  filters={...defaults(),query:parsed.query,category:parsed.category==='all'?'':parsed.category,budget:parsed.budget,store:parsed.store==='all'?'':parsed.store,origin:parsed.origin??'',sort:parsed.sort,
    // A new sentence never removes allergy conditions already set; they are removed only by their own × button.
    allergens:[...new Set([...parsed.allergens,...kept])]};
  if(filters.store&&!$('store').querySelector(`option[value="${CSS.escape(filters.store)}"]`))filters.store='';
  const queryWarnings=new Set(searchQueryLimitations(filters.query));
  const notes=(parsed.notices??[]).filter(note=>!queryWarnings.has(note));
  if(kept.length)notes.unshift(`已保留之前揀嘅過敏條件：避開${kept.map(id=>allergens[id]??id).join('、')}（要取消請撳佢個 ×）。`);
  $('request-feedback').textContent=notes.join(' ');
  updateFilters({sync:true});
  if(parsed.allergyUnclear){
    const words=parsed.unclearAllergyWords??[];
    $('filter-details').open=true;$('allergy-options').scrollIntoView({block:'center'});
    toast(words.length?`網站認唔到「${words.join('、')}」係邊類過敏原；請喺「需要避開嘅過敏原」親手剔選。`:'你提到過敏，但系統認唔到係邊種；請喺「需要避開嘅過敏原」親手剔選。');
  }
  return {...parsed,keptAllergens:kept};
}
function renderEmptyActions(){
  const box=$('empty-actions');
  if(results.length||!dataset){box.innerHTML='';return;}
  const options=[];
  const tryRelax=(key,label,patch)=>{const count=filterProducts(products,{...filters,...patch}).length;if(count)options.push(`<button type="button" class="secondary-button" data-relax="${esc(key)}">${esc(label)}（${number(count)} 項）</button>`);};
  if(filters.budget!==null)tryRelax('budget','唔限預算',{budget:null});
  if(filters.store)tryRelax('store','所有商戶',{store:''});
  if(filters.category)tryRelax('category','所有分類',{category:''});
  if(filters.dataScope)tryRelax('dataScope','全部資料範圍',{dataScope:''});
  box.innerHTML=options.length?`<p>可以試吓放寬其中一項（過敏條件唔會自動放寬）：</p><div>${options.join('')}</div>`:'';
}
function currentLink(){
  const url=new URL(location.href);
  url.search=paramsFromFilters(filters);
  url.hash='';
  return url.href;
}
function syncUrl(){
  if(!linkReady)return;
  try{history.replaceState(null,'',currentLink());}catch{/* some previews block history updates */}
}
async function copyCurrentLink(){
  const link=currentLink();
  try{await navigator.clipboard.writeText(link);toast('已複製呢組條件嘅連結，可以貼俾組員或者測試者。');}
  catch{toast(`未能自動複製，請手動複製呢條連結：${link}`);}
}
function showLinkBanner(state){
  const banner=$('link-banner');
  if(!state.present){banner.hidden=true;return;}
  const intro=state.source==='ai'?'已套用 AI 助手建議嘅條件，請先核對：':'已套用連結帶入嘅條件，請先核對：';
  const unsupported=state.unsupportedAllergens??[];
  // Unknown words and allergies the site knows but cannot filter are told apart, so neither is misdescribed.
  const problems=[...state.ignored.map(item=>`${item}未能辨認`),...state.ignoredAllergens.map(item=>`過敏原「${item}」未能辨認，冇套用`),...unsupported.map(item=>`「${item}」網站篩唔到，冇套用`)];
  banner.className=`link-banner${state.ignoredAllergens.length||unsupported.length?' warning':''}`;
  banner.innerHTML=`<p><strong>${esc(intro)}</strong>下面每個條件都可以逐個移除。${(state.notes??[]).length?`<br>${esc(state.notes.join(' '))}`:''}${problems.length?`<br><span class="link-problems">${esc(problems.join('；'))}。如有需要，請喺篩選自己揀返，同埋睇清楚包裝。</span>`:''}</p><button type="button" class="text-button" id="dismiss-link-banner">知道</button>`;
  banner.hidden=false;
  linkSignature=JSON.stringify(filters);
}
function initAssistant(){
  let url='#';
  try{const parsed=new URL(AI_ASSISTANT.url);if(parsed.protocol==='https:')url=parsed.href;}catch{url='#';}
  const ready=url!=='#';
  $('ai-assistant-link').hidden=!ready;
  $('ai-assistant-link').href=ready?url:'#';
  $('ai-assistant-pending').hidden=ready;
  $('ai-assistant-platform').textContent=AI_ASSISTANT.platform||'AI';
}
function initTextSize(){
  let large=false;
  try{large=localStorage.getItem('nc-text-size')==='large';}catch{large=false;}
  const apply=value=>{document.documentElement.classList.toggle('large-text',value);$('text-size-toggle').setAttribute('aria-pressed',String(value));$('text-size-toggle').textContent=value?'A 標準字':'A+ 大字';};
  apply(large);
  $('text-size-toggle').addEventListener('click',()=>{large=!large;apply(large);try{localStorage.setItem('nc-text-size',large?'large':'normal');}catch{/* preference is optional */}});
}

function wireEvents(){
  document.addEventListener('click',event=>{
    const anchor=event.target.closest('a[href^="#"]');
    if(!anchor)return;
    const target=document.getElementById(anchor.getAttribute('href').slice(1));
    if(!target)return;
    event.preventDefault();
    target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    if(anchor.classList.contains('skip-link')){target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}
  });
  $('load-more').addEventListener('click',()=>{visibleCount+=PAGE_SIZE;render();});
  $('library-scope').addEventListener('change',()=>{filters.libraryScope=$('library-scope').value;updateFilters();});
  $('data-scope').addEventListener('change',()=>{filters.dataScope=$('data-scope').value;updateFilters();});
  $('search-form').addEventListener('submit',event=>{event.preventDefault();clearTimeout(searchTimeout);filters.query=$('food-search').value.trim();render();$('results').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
  $('food-search').addEventListener('input',()=>{clearTimeout(searchTimeout);searchTimeout=setTimeout(()=>{filters.query=$('food-search').value.trim();render();},160);});
  $('budget').addEventListener('input',()=>{const value=$('budget').value;filters.budget=value===''?null:Math.max(0,Math.min(10000,Number(value)));updateFilters();});
  ['store','origin','sort'].forEach(id=>$(id).addEventListener('change',()=>{filters[id]=$(id).value;updateFilters();}));
  $('allergy-options').addEventListener('change',()=>{filters.allergens=[...document.querySelectorAll('input[name=allergen]:checked')].map(input=>input.value);updateFilters();});
  $('reset-filters').addEventListener('click',resetFilters);$('empty-reset').addEventListener('click',resetFilters);
  document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{filters.category=button.dataset.category;updateFilters({sync:true});}));
  document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>{filters.query=button.dataset.query;updateFilters({sync:true});}));
  document.querySelectorAll('[data-budget]').forEach(button=>button.addEventListener('click',()=>{filters.budget=Number(button.dataset.budget);updateFilters({sync:true});}));
  $('active-filters').addEventListener('click',event=>{const button=event.target.closest('[data-remove-filter]');if(!button)return;const key=button.dataset.removeFilter;if(key.startsWith('allergen:'))filters.allergens=filters.allergens.filter(id=>id!==key.slice(9));else filters[key]=key==='budget'?null:key==='libraryScope'?'priced':key==='sort'?'relevance':'';updateFilters({sync:true});});
  $('product-grid').addEventListener('click',event=>{const compare=event.target.closest('[data-compare]');const detail=event.target.closest('[data-detail]');if(compare)toggleCompare(compare.dataset.compare);else if(detail){const product=products.find(p=>p.id===detail.dataset.detail);if(product){renderDetail(product);addLabelEvidence(product);openDialog('detail-dialog');}}});
  $('detail-content').addEventListener('click',event=>{const button=event.target.closest('[data-detail-compare]');if(button){const product=products.find(p=>p.id===button.dataset.detailCompare);if(filters.allergens.length&&getAllergenAssessment(product,filters.allergens).status!=='no-listed-match'){toast('此產品未能符合目前過敏條件，唔會加入比較。');return;}toggleCompare(button.dataset.detailCompare);renderDetail(detailProduct);addLabelEvidence(detailProduct);}});
  $('clear-comparison').addEventListener('click',()=>{selected=[];render();});
  $('open-comparison').addEventListener('click',()=>{renderComparison();if(selected.length>=2)openDialog('compare-dialog');});
  $('compare-content').addEventListener('click',event=>{const button=event.target.closest('[data-remove-compare]');if(button)toggleCompare(button.dataset.removeCompare);});
  $('compare-content').addEventListener('change',event=>{if(event.target.id==='comparison-basis'){comparisonBasis=event.target.value;renderComparison();$('comparison-basis').focus();}});
  $('compare-content').addEventListener('input',event=>{if(event.target.id==='comparison-portion'){const value=Number(event.target.value);const invalid=event.target.value===''||!Number.isFinite(value)||value<=0||value>10000;event.target.setCustomValidity(invalid?'請輸入大於0、最多10000嘅份量。':'');comparisonPortion=invalid?NaN:value;showPortionError(invalid);const chosen=selected.map(id=>products.find(p=>p.id===id));$('comparison-rows').innerHTML=compareTableRows(chosen);}});
  ['sources-button','data-info-button','footer-sources'].forEach(id=>$(id).addEventListener('click',()=>{renderSources();addOpenFoodFactsSources();addHkReviewSources();openDialog('sources-dialog');}));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
  $('assistant-toggle').addEventListener('click',()=>{const expanded=$('assistant-toggle').getAttribute('aria-expanded')==='true';$('assistant-toggle').setAttribute('aria-expanded',String(!expanded));$('assistant-panel').hidden=expanded;if(!expanded)$('request-input').focus();});
  $('request-form').addEventListener('submit',event=>{event.preventDefault();const text=$('request-input').value.trim();if(!text){$('request-input').focus();return;}applyParsedRequest(text);});
  document.querySelectorAll('[data-request]').forEach(button=>button.addEventListener('click',()=>{const parsed=applyParsedRequest(button.dataset.request);toast(`已用離線規則解讀「${button.dataset.request}」${parsed.keptAllergens.length?`，並保留避開${parsed.keptAllergens.map(id=>allergens[id]??id).join('、')}`:''}；請核對上面嘅條件。`);}));
  $('empty-actions').addEventListener('click',event=>{const button=event.target.closest('[data-relax]');if(!button)return;const key=button.dataset.relax;filters[key]=key==='budget'?null:'';updateFilters({sync:true});});
  $('copy-link').addEventListener('click',copyCurrentLink);
  $('link-banner').addEventListener('click',event=>{if(event.target.closest('#dismiss-link-banner'))$('link-banner').hidden=true;});
}

async function start(){
  $('allergy-options').innerHTML=Object.entries(allergens).map(([id,label])=>`<label><input type="checkbox" name="allergen" value="${id}">${label}</label>`).join('');
  if(window.matchMedia('(max-width:760px)').matches)$('filter-details').open=false;
  initAssistant();
  initTextSize();
  wireEvents();
  try{
    const read=async name=>{const response=await fetch(new URL(`data/${name}`,import.meta.url),{cache:'no-cache'});if(!response.ok)throw new Error(`${name}: HTTP ${response.status}`);return response.json();};
    let curated=await read('products.json');
    let offUnavailable=false;
    try{curated=mergeLabelSources(curated,await read('off-hk-labels.json'));}
    catch(error){offUnavailable=true;console.warn('OFF label subset unavailable:',error.message);}
    try{
      const [bulk,meta]=await Promise.all([read('pricewatch-foods.json'),read('pricewatch-meta.json')]);
      dataset=buildCatalogue(curated,bulk,meta);
    }catch(error){
      dataset=curated;
      $('catalogue-status').textContent='整批價格資料暫未載入；目前只顯示逐件核對嘅小型資料集。請稍後重新整理。';
      console.warn('Pricewatch catalogue unavailable:',error.message);
    }
    let expansionUnavailable=false;
    try{
      const [local,offLibrary]=await Promise.all([read('hk-nutrition-expansion.json'),read('off-nutrition-library.json')]);
      dataset=enrichCatalogue(dataset,local,offLibrary);
    }catch(error){expansionUnavailable=true;console.warn('Nutrition expansion unavailable:',error.message);}
    const reviewResults=await Promise.allSettled(['hk-reviewed-labels.json','off-hk-reviewed-labels.json','hk-reviewed-labels-extra.json','off-hk-reviewed-labels-extra.json'].map(read));
    let reviewUnavailable=false;
    for(const result of reviewResults){
      if(result.status==='fulfilled')dataset=applyHkLabelReview(dataset,result.value);
      else {reviewUnavailable=true;console.warn('HK label review unavailable:',result.reason?.message);}
    }
    if(!Array.isArray(dataset.products)||!dataset.products.length)throw new Error('食品資料格式不完整');
    products=dataset.products;
    const coverage=hkLabelCoverage(products);
    $('coverage-products').textContent=number(coverage.original);
    $('coverage-nutrition').textContent=number(coverage.anyNutrition);
    $('coverage-hk-nutrition').textContent=number(coverage.reviewedNutrition);
    $('coverage-labels').textContent=number(coverage.completeAllergy);
    $('hk-label-progress').value=coverage.reviewedNutrition;
    $('hk-progress-text').textContent=`香港營養來源已讀 ${number(coverage.reviewedNutrition)} / 1,000 款目標 · 其中 ${number(coverage.fullCoreNutrition)} 款具完整「1+7」數值`;
    if(dataset.imports?.pricewatch)$('catalogue-status').textContent=`已匯入消委會 ${number(dataset.imports.pricewatch.importedCount)} 項一般食品；標籤另按 Open Food Facts、品牌／香港零售商資料逐件核對。價格資料唔包含營養或過敏聲明。`;
    if(dataset.enrichment){$('catalogue-status').textContent=`以上全部按原有香港格價目錄計算。「有營養參考數值」包含部分資料、社群及次級參考；「香港來源已讀」另行核對品牌／香港零售商網頁或包裝圖片，並非現批實物檢驗。未用額外無價格食品計入1,000款目標。`;}
    if(expansionUnavailable)$('catalogue-status').textContent+=' 擴展營養資料暫未載入。';
    if(offUnavailable)$('catalogue-status').textContent+=' 部分 Open Food Facts 標籤資料暫未載入，現顯示其餘已取得來源。';
    if(reviewUnavailable)$('catalogue-status').textContent+=' 本輪部分香港標籤未能載入，數量只計已成功取得資料。';
    Object.entries(dataset.stores??{}).forEach(([id,store])=>{stores[id]=typeof store==='string'?store:store.name??id;});
    const storeIds=[...new Set(products.flatMap(product=>(product.prices??[]).map(price=>price.store)))];
    $('store').innerHTML='<option value="">所有商戶</option>'+storeIds.map(id=>`<option value="${esc(id)}">${esc(stores[id]??id)}</option>`).join('');
    const origins=[...new Set(products.map(product=>product.origin).filter(origin=>typeof origin==='string'&&origin.trim()))].sort();
    $('origin').innerHTML='<option value="">所有／未確認產地</option>'+origins.map(origin=>`<option value="${esc(origin)}">${esc(origin)}</option>`).join('');
    $('snapshot-note').textContent=`價格快照 ${snapshotLabel()}（非即時）`;
    // Stable default puts documented nutrition before price-only records without implying health ranking.
    products=[...products].sort((a,b)=>Number(Boolean(hkEvidenceLabel(b)))-Number(Boolean(hkEvidenceLabel(a)))||Number(hasNutrition(b))-Number(hasNutrition(a))||Number(Boolean(productUnit(b)))-Number(Boolean(productUnit(a)))||
      (a.nutritionSourceFamily==='off-community-reference'&&b.nutritionSourceFamily==='off-community-reference'?String(b.offMetadata?.lastModifiedAt??'').localeCompare(String(a.offMetadata?.lastModifiedAt??'')):0));
    // Conditions handed over by the AI assistant or a shared link are validated, applied, then shown for checking.
    const linkState=filtersFromParams(location.search,{storeIds,base:defaults()});
    if(linkState.present){filters=linkState.filters;syncInputs();}
    showLinkBanner(linkState);
    linkReady=true;
    render();
  }catch(error){
    $('product-grid').setAttribute('aria-busy','false');$('product-grid').innerHTML='<div class="error-message">暫時載入唔到食品資料。請檢查網絡並重新整理；如果你直接開啟 HTML 檔案，請改用網站連結。</div>';
    $('result-count').textContent='食品資料暫時未能載入';$('snapshot-note').textContent='資料載入未完成。';
    console.error('NutriCompare dataset loading failed:',error.message);
  }
}
start();
