import { filterProducts, getEligiblePrices, getMinPrice, getAllergenAssessment, nutritionFor, parseRequestWithBrandFallback, rankingGroups, searchQueryLimitations, buildBrandIndex } from './engine.mjs?v=110';
import { filtersFromParams, paramsFromFilters } from './url-state.mjs?v=110';
import { assistantState } from './assistant-state.mjs?v=110';
import { hkLabelCoverage, hasReviewedHkNutrition } from './hk-labels.mjs?v=110';
import { getPackPrices, getPackNutrition, rankByUnitPrice } from './pack-values.mjs?v=110';
import { findAlternatives, getComparisonPackNutrition, getNutrientEvidence, getNutritionSourceLabel } from './nutrition-evidence.mjs?v=110';
import { comparisonShareUrl, qrSvg, shareComparison, whatsappShareUrl } from './compare-share.mjs?v=110';
import { getExclusionReasons } from './exclusion-reasons.mjs?v=110';
import { valueSpread } from './compare-highlights.mjs?v=110';
import { summariseConnections, summariseStorage } from './privacy-receipt.mjs?v=110';
import { buildExplainText, plainNumber } from './ai-explain.mjs?v=110';
import { HK_EXPANSION_FILE, OFF_LABEL_FILE, OFF_LIBRARY_FILE, REVIEW_FILES, assembleDataset, comparingPaused, describeMissing, fetchJson, loadDataFiles, resultsHold } from './data-loader.mjs?v=110';

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
const nutrientFields = [['energyKcal','能量','kcal'],['carbohydrates','碳水化合物','g'],['sugars','糖','g'],['sodiumMg','鈉','mg'],['protein','蛋白質','g'],['fat','總脂肪','g'],['saturatedFat','飽和脂肪','g'],['transFat','反式脂肪','g'],['fibre','膳食纖維','g']];
const sortLabels = {'price-asc':'價格：低至高','unit-price-asc':'單位價：低至高','carbs-asc':'碳水化合物：低至高','sugar-asc':'糖：低至高','sodium-asc':'鈉：低至高','protein-desc':'蛋白質：高至低'};
const LOWEST_KEYS = new Set(['energyKcal','carbohydrates','sugars','fat','saturatedFat','transFat','sodiumMg']);
const sortedNutrient = {'carbs-asc':'carbohydrates','sugar-asc':'sugars','sodium-asc':'sodiumMg','protein-desc':'protein'};
/** The value exactly as the page prints it, read back from the printed text, so a mark or a gap never contradicts the figures on screen. */
const shownValue = value => { const text=number(value); return text==='—' ? null : Number(text.replace(/,/g,'')); };
/** The same for money: prices are printed with two decimals. */
const shownPrice = value => value===null||value===undefined||!Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(2));
const defaults = () => ({query:'',category:'',budget:null,store:'',allergens:[],origin:'',sort:'relevance',dataScope:'',libraryScope:'priced'});
let filters = defaults();
let dataset = null;
let products = [];
let brandIndex;
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
/** Data files that have not arrived. Empty once everything is loaded. */
let missingFiles=[];
/** Why results are held back while data is missing ('labels', 'allergy' or ''); the rules are in data-loader.mjs. */
const holdReason=()=>resultsHold(missingFiles,filters.allergens);
/**
 * AI assistant settings. They are the one file the students edit by hand, so they are read on their own in start():
 * a typing slip there only leaves the AI button hidden and can no longer stop the whole site from starting.
 */
let AI_ASSISTANT=Object.freeze({url:'',platform:'EdUHK MaaS',linkExpires:'',explainTested:false});
/** 「叫 AI 解釋」 is offered only when the assistant link works and the group has passed its "模式 2" tests. */
const explainReady=()=>assistantState(AI_ASSISTANT).state==='ready'&&AI_ASSISTANT.explainTested===true;

function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>$('toast').hidden=true,4200); }
function brandName(product) { return typeof product.brand === 'object' ? product.brand['zh-Hant'] ?? product.brand.zh ?? product.brand.en ?? '' : product.brand ?? ''; }
function productNameWithBrand(product) {
  return [brandName(product)||product.brandEn,product.nameZh||product.nameEn].filter(Boolean).join(' · ');
}
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
  return lines.length?`<p class="product-unit-price${filters.sort==='unit-price-asc'?' sorted':''}">${esc(lines.join(' · '))}</p>`:'';
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
  if (assessment.status==='no-listed-match') return {text:'來源未列所選過敏原 · 請核對包裝',cls:'matched'};
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
  const sourceStatus=getNutritionSourceLabel(product);
  const cardNutrients=[['carbohydrates','碳水','g'],['sugars','糖','g'],['sodiumMg','鈉','mg']];
  if(filters.sort==='protein-desc')cardNutrients.push(['protein','蛋白質','g']);
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
      <div class="nutrient-heading">${esc(basisLabel(product))}</div>
      <div class="nutrient-strip">
        ${cardNutrients.map(([key,label,unit])=>{
          const tag=key===sortedNutrient[filters.sort]?'strong':'span';
          return `<div><${tag} class="card-nutrient" data-nutrient="${key}"><small>${label}</small> ${number(n[key])}${shownValue(n[key])===null?'':unit}</${tag}></div>`;
        }).join('')}
        <span class="mobile-nutrient-basis">${esc(n.referenceOnly?'（每100g或ml）':n.basisUnit?`（每100${n.basisUnit}）`:'（基準待確認）')}</span>
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
/** The conditions in force, as [key, words]. Used for the removable chips and for the sentence filter's summary. */
function activeFilterEntries() {
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
  return entries;
}
function renderActiveFilters() {
  const entries=activeFilterEntries();
  $('active-filters').innerHTML=entries.map(([key,text])=>`<span class="active-filter">${esc(text)}<button data-remove-filter="${esc(key)}" aria-label="移除${esc(text)}條件">×</button></span>`).join('');
  $('filter-count').textContent=String(filterTotal());
}
function renderExclusions() {
  const notice=$('allergy-notice');
  const panel=$('exclusion-panel');
  const button=$('exclusion-toggle');
  panel.hidden=true;
  button.setAttribute('aria-expanded','false');
  // On hold nothing is counted or listed: the counts would come from incomplete allergen data.
  if(holdReason()){notice.hidden=true;button.hidden=true;panel.replaceChildren();button.onclick=null;return;}
  const exclusions=getExclusionReasons(products,filters);
  const {conflicts,unknown}=exclusions;
  notice.hidden=!filters.allergens.length;
  button.hidden=!filters.allergens.length;
  button.textContent=`已排除 ${number(conflicts.length+unknown.length)} 款 · 點解冇呢款？`;
  notice.textContent=`排除含有／可能含有嘅 ${conflicts.length} 項同資料不足嘅 ${unknown.length} 項。來源未列出唔等於安全保證，購買前請核對實物包裝。`;
  $('empty-description').textContent=filters.allergens.length
    ? `目前條件下，${conflicts.length} 項列出所選過敏原，${unknown.length} 項資料不足。未有可確認符合條件嘅產品；你可以調整名稱、預算或商戶，網站唔會自動放寬過敏限制。`
    : '試下另一個名稱，或者調整預算及商戶。資料庫仍在逐件補充；冇結果唔代表市面冇呢類食品。';
  panel.replaceChildren();
  button.onclick=()=>toggleExclusions(panel.hidden,exclusions);
}
function toggleExclusions(open,exclusions) {
  const panel=$('exclusion-panel');
  const button=$('exclusion-toggle');
  panel.hidden=!open;
  button.setAttribute('aria-expanded',String(open));
  if(!open){button.focus();return;}
  const {conflicts,unknown}=exclusions;
  const names=ids=>esc(ids.map(id=>allergens[id]??id).join('、'));
  const detailLink=product=>`<button type="button" class="text-button" data-excluded-detail="${esc(product.id)}">${esc(productNameWithBrand(product))}</button>`;
  const conflictItems=conflicts.map(({product,contains,mayContain})=>`<li>${detailLink(product)}<span>${[contains.length?`含有 ${names(contains)}`:'',mayContain.length?`可能含有／廠房聲明列出 ${names(mayContain)}`:''].filter(Boolean).join(' · ')}</span></li>`);
  const unknownItems=unknown.map(product=>`<li>${detailLink(product)}<span>冇完整成分或警告紀錄，未能確認，唔代表安全</span></li>`);
  const list=(items,empty)=>items.length?`<ul>${items.join('')}</ul>`:`<p>${empty}</p>`;
  panel.innerHTML=`<h3 id="exclusion-title" tabindex="-1">點解冇呢款？</h3>
    <h4>含有／可能含有（${number(conflicts.length)} 款）</h4>
    ${list(conflictItems,'呢組冇食品。')}
    <h4>資料不足（${number(unknown.length)} 款）</h4>
    ${list(unknownItems,'呢組冇食品。')}
    <button type="button" class="text-button" data-close-exclusions>收起排除清單</button>`;
  $('exclusion-title').focus();
}
function render() {
  if(!dataset)return;
  const signature=JSON.stringify(filters);
  if(signature!==filterSignature){visibleCount=PAGE_SIZE;filterSignature=signature;}
  // The banner describes what the link set; once the person changes the conditions it no longer applies.
  if(linkSignature&&signature!==linkSignature){$('link-banner').hidden=true;linkSignature=null;}
  // With data missing, a statement or a figure may not be the one the complete catalogue shows, so nothing is listed.
  const hold=holdReason();
  results=hold?[]:filterProducts(products,filters);
  // Price per 100 g/ml is ranked here, after filtering; the filter and the allergy exclusion are untouched.
  const unitRanking=filters.sort==='unit-price-asc'?rankByUnitPrice(results,product=>getMinPrice(product,filters)):null;
  if(unitRanking)results=unitRanking.products;
  const queryWarnings=searchQueryLimitations(filters.query);
  // The box stops at its length limit without a sound, so a pasted sentence would be cut short unnoticed.
  if($('food-search').value.length>=Number($('food-search').getAttribute('maxlength')))queryWarnings.push('搜尋欄最多 60 個字，後面嘅字冇輸入到。長句請用「句子篩選」。');
  $('search-feedback').textContent=queryWarnings.join(' ');
  $('search-feedback').hidden=!queryWarnings.length;
  $('result-count').textContent=hold==='labels'?'標籤資料未載入齊 · 暫時唔顯示食品':hold?'資料未載入齊 · 暫停顯示過敏篩選結果':filters.allergens.length?`${number(results.length)} 項來源未列所選過敏原`:
    `${number(results.length)} 項食品${filters.libraryScope==='off-library'?' · OFF 參考庫':filters.libraryScope==='all'?' · 全部資料庫':''}`;
  $('product-grid').innerHTML=hold?holdMessage(hold):results.slice(0,visibleCount).map(productCard).join('');
  $('load-more').hidden=visibleCount>=results.length;
  $('page-status').textContent=results.length?`顯示 ${Math.min(visibleCount,results.length)} / ${results.length} 項；搜尋及篩選已涵蓋全部資料。`:'';
  $('product-grid').setAttribute('aria-busy','false');
  $('empty-state').hidden=Boolean(hold)||results.length>0;
  renderExclusions();
  const groups=unitRanking?unitRanking.groups:rankingGroups(results,filters.sort);
  $('sort-note').hidden=groups.length<2;
  $('sort-note').textContent=groups.length<2?'':`已按單位分開排名：先列 ${groups.map(g=>`${number(g.count)} 項每100${g.unit}`).join('，再列 ')}；兩組數值唔可以互相比較，未知數值排最後。`;
  renderActiveFilters();
  renderTray();
  renderEmptyActions();
  $('copy-link').hidden=!filterTotal()&&filters.sort==='relevance';
  syncUrl();
}
function holdMessage(reason) {
  const why=reason==='labels'
    ?`<p><strong>標籤資料未載入齊，所以暫時唔顯示食品。</strong></p>
    <p>仲有 ${number(missingFiles.length)} 份資料未到。少咗標籤資料，部分營養數字同過敏聲明會同核對過嘅標籤唔同；網站寧願唔顯示，都唔會俾一啲可能唔啱嘅數字你。</p>`
    :`<p><strong>資料未載入齊，所以暫時唔顯示過敏篩選結果。</strong></p>
    <p>你揀咗要避開過敏原，但仲有 ${number(missingFiles.length)} 份資料未到。少咗資料，食品嘅過敏聲明可能唔完整；網站寧願唔顯示，都唔會俾一份可能有漏嘅清單你。</p>`;
  return `<div class="error-message hold-message">${why}
    <p>請撳「再試一次」。呢段時間請直接睇包裝上嘅標籤。</p>
    <button type="button" class="secondary-button" data-retry-load>再試一次</button></div>`;
}
function renderTray() {
  $('compare-tray').hidden=!selected.length;
  document.body.classList.toggle('has-comparison',Boolean(selected.length));
  $('compare-count').textContent=selected.length;
  // Comparing is paused while any data is missing: a mark such as 「最低」 must never rest on incomplete figures.
  // The choices are kept and checked again once the data is complete.
  const paused=comparingPaused(missingFiles);
  $('selected-names').textContent=(paused?'資料未載入齊，暫停比較 · ':'')+selected.map(id=>products.find(p=>p.id===id)?.nameZh??id).join(' · ');
  $('open-comparison').disabled=selected.length<2||paused;
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
function nutrientEvidenceButton(product,key,label,unit,values,basis) {
  const value=values?.[key];
  const name=product.nameZh||product.nameEn;
  const spoken=shownValue(value)===null?'未知':`${number(value)} ${unit}`;
  return `<button type="button" class="nutrient-evidence-button" data-nutrient-evidence="${key}" data-evidence-product="${esc(product.id)}" data-evidence-basis="${basis}" aria-label="${esc(`${name} · ${label} ${spoken} · 查看出處`)}">${nutrientValue(value,unit)}</button>`;
}
function showNutrientEvidence(button) {
  const product=products.find(item=>item.id===button.dataset.evidenceProduct);
  const field=nutrientFields.find(([key])=>key===button.dataset.nutrientEvidence);
  if(!product||!field)return;
  const [key,label]=field;
  const basis=button.dataset.evidenceBasis;
  const pack=getPackNutrition(product);
  const values=basis==='package'?getComparisonPackNutrition(product).values:
    basis==='whole'?pack.whole:basis==='inner'?pack.inner:
    basis==='portion'?nutritionFor(product,basis,comparisonPortion):nutritionFor(product);
  const {source,original,displayed,converted,reason,conflictSources}=getNutrientEvidence(product,key,values);
  const description=(item,{exact=false}={})=>{
    if(!item||shownValue(item.value)===null)return '—';
    const basis=item.referenceOnly?'每100g或100ml（單位待確認）':
      item.amount&&item.unit?`每 ${number(item.amount)} ${item.unit}`:'原標份量未有紀錄';
    const value=exact?item.value.toLocaleString('zh-HK',{maximumFractionDigits:20}):number(item.value);
    return `${basis} · ${item.label?`${item.label} `:''}${value} ${item.valueUnit??''}`;
  };
  $('nutrient-evidence-content').innerHTML=`
    <p class="evidence-product">${esc(product.nameZh||product.nameEn)} · <strong>${esc(label)}</strong></p>
    <dl class="nutrient-evidence-list">
      <dt>來源</dt><dd>${source?(source.url?link(source.url,source.label):esc(source.label)):'暫無可核對嘅數值來源'}</dd>
      <dt>資料性質</dt><dd>${esc(source?.type??getNutritionSourceLabel(product))}</dd>
      <dt>查閱日期</dt><dd>${esc(dateLabel(source?.checkedAt))}</dd>
      <dt>原標份量同數值</dt><dd>${esc(description(original,{exact:true}))}</dd>
      <dt>目前顯示</dt><dd>${esc(description(displayed))}</dd>
      <dt>有冇換算</dt><dd>${converted===true?'已按來源基準換算':converted===false?'沿用原標數值':'未能確認或冇可換算數值'}</dd>
    </dl>
    ${reason?`<p class="inline-notice amber">${displayed.value===null&&!original?'冇可用來源數值。':''}${esc(reason)}</p>`:''}
    ${conflictSources?.length?`<ul class="nutrient-conflicts">${conflictSources.map(item=>`<li>${item.url?link(item.url,item.label):esc(item.label)} · ${esc(description(item,{exact:true}))}</li>`).join('')}</ul>`:''}
    ${source?.supportingSources?.length?`<p>相關來源：${source.supportingSources.map(item=>link(item.url,item.label)).join(' · ')}</p>`:''}
    ${sourceWarning(product)?`<p>來源限制：${esc(sourceWarning(product))}</p>`:''}`;
  openDialog('nutrient-evidence-dialog');
}
function detailNutritionTable(product) {
  const base=nutritionFor(product);
  const pack=getPackNutrition(product);
  const columns=[{label:basisLabel(product),values:base,basis:'100'}];
  if(pack.whole)columns.push({label:`每售賣包裝 ${number(pack.totalAmount)} ${pack.unit}`,values:pack.whole,basis:'whole'});
  if(pack.inner)columns.push({label:`每小包 ${number(pack.innerAmount)} ${pack.unit}`,values:pack.inner,basis:'inner'});
  return `<table class="nutrition-table"><caption>營養數值 · 「—」代表未知</caption>
    <thead><tr><th scope="col">營養項目</th>${columns.map(column=>`<th scope="col">${esc(column.label)}</th>`).join('')}</tr></thead>
    <tbody>${nutrientFields.map(([key,label,unit])=>`<tr><th scope="row">${label}</th>${columns.map(column=>`<td>${nutrientEvidenceButton(product,key,label,unit,column.values,column.basis)}</td>`).join('')}</tr>`).join('')}</tbody>
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
function renderAlternatives(product) {
  const options=findAlternatives(product,products,filters.allergens);
  const items=options.map(({product:other,store,originalPrice,alternativePrice,unit,metrics})=>{
    const differences=metrics.map(({key,originalValue,value})=>{
      const [,label,valueUnit]=nutrientFields.find(field=>field[0]===key);
      return `${label}較低 · 每100${unit}由 ${number(originalValue)} ${valueUnit} 至 ${number(value)} ${valueUnit}`;
    });
    return `<li><button class="text-button" type="button" data-alternative-detail="${esc(other.id)}">${esc(productNameWithBrand(other))}</button>
      <p>${esc(stores[store]??store)} · 原款 HK$${money(originalPrice)}，呢款 HK$${money(alternativePrice)}</p>
      <p>${esc(differences.join('；'))}</p></li>`;
  });
  return `<section class="detail-section alternatives"><h3>價錢差唔多嘅其他選擇</h3>
    ${items.length?`<ul>${items.join('')}</ul>`:'<p>暫時搵唔到符合條件嘅其他款式。</p>'}</section>`;
}
function renderDetail(product) {
  detailProduct=product;
  const index=products.indexOf(product);
  const warning=sourceWarning(product);
  const prices=getEligiblePrices(product).sort((a,b)=>a.price-b.price);
  const label=product.allergens??{};
  $('detail-content').innerHTML=`<div class="detail-heading">${foodArt(product,index)}<div><p>${esc(brandName(product))}</p><h2>${esc(product.nameZh??product.nameEn)}</h2><p>${esc(product.nameEn??'')}</p><p>${esc(product.packSize??'包裝待確認')} · 產地：${esc(product.origin??'未確認')}</p>${product.offMetadata?`<p class="source-scope">OFF 來源最後修改：${esc(String(product.offMetadata.lastModifiedAt??'未提供').slice(0,10))} · ${esc(product.offMetadata.sourceApi??'社群資料')} · 未逐張核對香港包裝</p>`:''}${product.barcode?`<p>來源條碼：${esc(product.barcode)}</p>`:''}</div></div>${warning?`<div class="inline-notice amber">${esc(warning)}</div>`:''}${product.sourceCategory?`<p class="source-scope">消委會分類：${esc([product.sourceCategory.zh,...(product.sourceCategory.pathZh??[])].filter(Boolean).join(" / "))} · 商品代號 ${esc(product.id)}（非條碼）</p>`:''}<section class="detail-section"><h3>營養標籤比較</h3>${detailNutritionTable(product)}<p>碳水定義：${esc(carbDefinition(product))}。糖係碳水化合物嘅一部分；本頁唔計算「淨碳水」。</p><p><button type="button" class="text-button" data-open-label-lesson>點樣睇營養標籤？</button></p>${notesText(product)?`<p>${esc(notesText(product))}</p>`:''}</section><section class="detail-section" data-allergen-evidence><h3>成分與過敏聲明</h3>${missingFiles.length?'<p class="inline-notice amber">部分資料未載入，呢度嘅過敏聲明可能唔完整。請關閉呢個視窗，再撳結果上面嘅「再試一次」。</p>':''}<p><strong>資料狀態：</strong>${label.status==='complete'?'已記錄指定版本完整聲明；仍須核對當前包裝':'未完整核實，不能用作確認過敏安全'}</p><p><strong>已知含有：</strong>${esc(label.contains?.length?label.contains.map(id=>allergens[id]??id).join('、'):'未列出／未能確認')}</p><p><strong>已知可能含有：</strong>${esc(label.mayContain?.length?label.mayContain.map(id=>allergens[id]??id).join('、'):'未列出／未能確認')}</p>${label.text?`<p>${esc(label.text)}</p>`:''}${product.ingredients||product.ingredientsSummary?`<p><strong>成分資料摘要：</strong>${esc(product.ingredientsSummary??(typeof product.ingredients==='string'?product.ingredients:product.ingredients.text??'見原始來源'))}</p>`:''}<p>未列出唔代表不存在。對食品過敏者應核對實物包裝，必要時直接向生產商確認。</p></section><section class="detail-section"><h3>香港價格與購買渠道</h3><p>整包單件價格快照。單位價按標示淨重／容量計，優惠另列。</p>${merchantPriceRows(product,prices)}</section>${product.offers?.length?`<section class="detail-section"><h3>來源優惠備註</h3><p>以下只保留原始優惠文字，未套入單件預算；適用日期、會員及購買數量請向商戶核實。</p>${product.offers.map(offer=>`<p><strong>${esc(stores[offer.store]??offer.store)}：</strong>${esc(offer.textZh||offer.textEn||'見來源')}</p>`).join('')}</section>`:''}<section class="detail-section"><h3>逐項資料來源</h3>${sourceLinks(product)}</section><div style="margin-top:20px"><button class="secondary-button" data-detail-compare="${esc(product.id)}">${selected.includes(product.id)?'從比較移除':'加入營養比較'}</button></div>`;
  const action=$('detail-content').querySelector('[data-detail-compare]');
  if(filters.allergens.length&&getAllergenAssessment(product,filters.allergens).status!=='no-listed-match')action.parentElement.remove();
  // Suggested alternatives compare figures between foods, so they wait for complete data like the comparison does.
  if(!comparingPaused(missingFiles))$('detail-content').querySelector('[data-allergen-evidence]').insertAdjacentHTML('afterend',renderAlternatives(product));
}
function showProductDetail(id,{evidence=false}={}) {
  const product=products.find(item=>item.id===id);
  if(!product)return;
  renderDetail(product);
  addLabelEvidence(product);
  const dialog=$('detail-dialog');
  if(!dialog.open)openDialog('detail-dialog');
  dialog.scrollTop=0;
  if(evidence){
    const section=$('detail-content').querySelector('[data-allergen-evidence]');
    section.tabIndex=-1;
    section.focus({preventScroll:true});
    section.scrollIntoView({block:'start',behavior:'instant'});
  }else{
    dialog.querySelector('.close-button').focus({preventScroll:true});
  }
}
function addLabelEvidence(product) {
  const markup=labelEvidenceSection(product);
  // Nutrition figures come first; the checking record follows them.
  if(markup)$('detail-content').querySelector('.detail-section')?.insertAdjacentHTML('afterend',markup);
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
function comparisonPackLabel(pack) {
  if(!pack.amount||!pack.unit)return '—';
  return pack.isInner?`每小包 ${number(pack.amount)}${pack.unit}（${number(pack.innerCount)} 包裝）`:
    `每包 ${number(pack.amount)}${pack.unit}`;
}
/** Figures for the comparison on screen, worked out once so the table and the text for the AI can never disagree. */
function comparisonFigures(chosen) {
  const basis=comparisonBasis;
  const packNutrition=basis==='package'?chosen.map(getComparisonPackNutrition):[];
  const values=chosen.map((product,index)=>basis==='package'?packNutrition[index].values??{}:
    nutritionFor(product,basis,basis==='portion'?comparisonPortion:null));
  const basisCells=chosen.map((product,index)=>{
    if(basis==='package')return comparisonPackLabel(packNutrition[index]);
    if(productUnit(product))return basis==='100'?`100 ${productUnit(product)}`:Number.isFinite(comparisonPortion)?`${number(comparisonPortion)} ${productUnit(product)}`:'—';
    return basis==='100'?basisLabel(product):'—';
  });
  const units=new Set(chosen.map(productUnit));
  const sameBasis=basis!=='package'&&units.size===1&&!units.has(null);
  const definitions=new Set(chosen.map(product=>product.nutrition?.carbohydrateDefinition));
  // The site says which food is lower only on one shared basis, with one carbohydrate definition and no unknown value.
  // The same answer decides the marks in the table and what the AI is told it must not rank.
  const unrankable=key=>{
    if(basis==='package')return '各款每包份量唔同';
    if(!sameBasis)return '單位唔同或者未知';
    if(key==='carbohydrates'&&(definitions.size!==1||![...definitions].every(value=>value==='available'||value==='total')))return '各款碳水化合物定義唔同或者未寫明';
    if(values.some(n=>shownValue(n[key])===null))return '有數字未知';
    return '';
  };
  // Lowest mark and gap use the printed values.
  const spread=key=>LOWEST_KEYS.has(key)&&!unrankable(key)?valueSpread(values.map(n=>shownValue(n[key])),1):null;
  const prices=chosen.map(product=>getMinPrice(product,filters));
  const packPrices=chosen.map((product,index)=>getPackPrices(product,prices[index]));
  const priceUnits=new Set(packPrices.map(pack=>pack.unit));
  const unitPriceUnrankable=priceUnits.size!==1||priceUnits.has(null)?'單位唔同或者未知':packPrices.some(pack=>pack.per100===null)?'有價錢未知':'';
  const unitPriceRange=unitPriceUnrankable?null:valueSpread(packPrices.map(pack=>shownPrice(pack.per100)),2);
  // A whole-pack price only compares fairly between packs of the same size.
  const packSizes=new Set(packPrices.map(pack=>pack.unit&&pack.totalAmount?`${pack.totalAmount}${pack.unit}`:null));
  const wholePriceUnrankable=prices.some(price=>price===null)?'有價錢未知':packSizes.size!==1||packSizes.has(null)?'包裝大細唔同，要睇每 100 g／ml 價':'';
  return {basis,values,basisCells,spread,unrankable,prices,packPrices,unitPriceRange,unitPriceUnrankable,wholePriceUnrankable};
}
function compareTableRows(chosen) {
  const {basis,values,basisCells,spread,prices,packPrices,unitPriceRange}=comparisonFigures(chosen);
  let html=`<tr><th scope="row">比較份量</th>${basisCells.map(label=>`<td>${esc(label)}</td>`).join('')}</tr>`;
  html+=nutrientFields.map(([key,label,unit])=>{
    const range=spread(key);
    const sorted=key===sortedNutrient[filters.sort];
    return `<tr${sorted?' class="sorted-row"':''}><th scope="row">${label}${sorted?'<span class="table-small row-sorted">目前排序項目</span>':''}${range?.complete?`<span class="table-small row-difference">高低相差 ${number(range.difference)} ${unit}</span>`:''}</th>${values.map((n,index)=>`<td>${nutrientEvidenceButton(chosen[index],key,label,unit,n,basis)}${range?.complete&&shownValue(n[key])===range.min?'<span class="lowest-tag">最低</span>':''}</td>`).join('')}</tr>`;
  }).join('');
  html+=`<tr class="group-row"><th colspan="${chosen.length+1}">香港價格 · ${esc(stores[filters.store]??'所有商戶')}</th></tr>`;
  html+=`<tr${filters.sort==='price-asc'?' class="sorted-row"':''}><th scope="row">整包單件價${filters.sort==='price-asc'?'<span class="table-small row-sorted">目前排序項目</span>':''}</th>${chosen.map((product,index)=>`<td>${prices[index]===null?'—':`HK$${money(prices[index])}`}<span class="table-small">${esc(product.packSize??'包裝待確認')}</span></td>`).join('')}</tr>`;
  html+=`<tr${filters.sort==='unit-price-asc'?' class="sorted-row"':''}><th scope="row">每 100 g／ml${filters.sort==='unit-price-asc'?'<span class="table-small row-sorted">目前排序項目</span>':''}${unitPriceRange?.complete?`<span class="table-small row-difference">高低相差 HK$${money(unitPriceRange.difference)}</span>`:''}</th>${packPrices.map(pack=>`<td>${pack.per100===null?'—':`HK$${money(pack.per100)}<span class="table-small">／100${pack.unit}</span>`}</td>`).join('')}</tr>`;
  if(packPrices.some(pack=>pack.perInner!==null))html+=`<tr><th scope="row">每小包價</th>${packPrices.map(pack=>`<td>${pack.perInner===null?'—':`HK$${money(pack.perInner)}<span class="table-small">${pack.innerCount} 小包</span>`}</td>`).join('')}</tr>`;
  html+=`<tr><th scope="row">過敏聲明</th>${chosen.map(product=>`<td class="neutral">${esc(allergyLabel(product).text)}</td>`).join('')}</tr>`;
  return html;
}
/** A food's own allergen statement. It never reflects which allergens the person has chosen to avoid. */
function productAllergyStatement(product) {
  const list=(product.allergens?.contains??[]).map(id=>allergens[id]??id).join('、');
  const maybe=(product.allergens?.mayContain??[]).map(id=>allergens[id]??id).join('、');
  if(product.allergens?.status==='complete')return [list?`含有 ${list}`:'',maybe?`可能含有 ${maybe}`:''].filter(Boolean).join('；')||'來源聲明冇列出網站篩選嘅 10 類過敏原（唔等於保證冇）';
  return list?`已知含有 ${list}；資料未齊`:'過敏資料未齊，未能確認';
}
/** Text block for 「叫 AI 解釋」: the same figures as the table, with no personal details. */
function comparisonExplainText(chosen) {
  const {basis,values,basisCells,spread,unrankable,prices,packPrices,unitPriceRange,unitPriceUnrankable,wholePriceUnrankable}=comparisonFigures(chosen);
  const basisText=basis==='package'?'每包／每小包（各款份量見下面）':basis==='portion'?(plainNumber(comparisonPortion)===null?'自訂份量（未輸入有效份量）':`自訂份量 ${plainNumber(comparisonPortion)} g／ml`):'每 100 g／ml';
  const gaps=nutrientFields.map(([key,label,unit])=>({label,unit,range:spread(key)})).filter(item=>item.range?.complete)
    .map(item=>({label:item.label,unit:item.unit,difference:item.range.difference}));
  if(unitPriceRange?.complete)gaps.push({label:'每 100 g／ml 價',unit:'港元',difference:unitPriceRange.difference,decimals:2});
  // Rows the table does not rank are named for the AI, each with the reason.
  let notComparable=nutrientFields.map(([key,label])=>({label,reason:unrankable(key)})).filter(item=>item.reason);
  if(notComparable.length===nutrientFields.length&&new Set(notComparable.map(item=>item.reason)).size===1)notComparable=[{label:'全部營養項目',reason:notComparable[0].reason}];
  if(wholePriceUnrankable)notComparable.push({label:'整包價',reason:wholePriceUnrankable});
  if(unitPriceUnrankable)notComparable.push({label:'每 100 g／ml 價',reason:unitPriceUnrankable});
  return buildExplainText({
    basisLabel:basisText,
    priceNote:`${stores[filters.store]??'所有商戶'}最低整包價；價格快照 ${snapshotLabel()}；未計優惠`,
    products:chosen.map((product,index)=>{
      const cheapest=getEligiblePrices(product,filters).sort((a,b)=>a.price-b.price)[0];
      return {name:productNameWithBrand(product),sourceLabel:getNutritionSourceLabel(product),portion:basisCells[index],
        nutrients:nutrientFields.map(([key,label,unit])=>({label,unit,value:shownValue(values[index][key])})),
        price:{whole:shownPrice(prices[index]),store:cheapest?stores[cheapest.store]??cheapest.store:'',per100:shownPrice(packPrices[index].per100),per100Unit:packPrices[index].unit??''},
        allergy:productAllergyStatement(product)};
    }),
    gaps,
    notComparable,
  });
}
function openExplain() {
  const chosen=selected.map(id=>products.find(p=>p.id===id)).filter(Boolean);
  if(chosen.length<2||!explainReady()||comparingPaused(missingFiles))return;
  const status=assistantState(AI_ASSISTANT);
  const ready=status.state==='ready';
  $('ai-explain-text').value=comparisonExplainText(chosen);
  $('ai-explain-link').hidden=!ready;
  $('ai-explain-link').href=ready?status.url:'#';
  $('ai-explain-pending').hidden=ready;
  $('ai-explain-pending').textContent=status.state==='expired'
    ?`AI 助手連結已經喺 ${dateLabel(status.expires)} 到期，小組更新之後呢度先會有按鈕。你可以先睇網站會交咩資料俾 AI。`
    :'AI 助手設定中：小組喺 EdUHK MaaS 發佈之後，呢度會有按鈕。你可以先睇網站會交咩資料俾 AI。';
  $('ai-explain-status').textContent='';
  openDialog('ai-explain-dialog');
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
        ${[['100','每 100 g／ml'],['package','每包／每小包'],['portion','自訂份量']].map(([value,label])=>`<option value="${value}"${comparisonBasis===value?' selected':''}>${label}</option>`).join('')}
      </select>
      <label for="comparison-portion"${comparisonBasis==='portion'?'':' hidden'}>自訂份量（g／ml）</label>
      <input id="comparison-portion" type="number" min="0.1" max="10000" step="0.1" value="${Number.isFinite(comparisonPortion)?comparisonPortion:''}"${comparisonBasis==='portion'?'':' hidden'}>
    </div>
    <div class="comparison-share-actions">
      <button type="button" class="secondary-button" id="share-comparison">分享</button>
      <a class="secondary-button" href="${esc(whatsappShareUrl(comparisonShareUrl(location.href,filters,selected)))}" target="_blank" rel="noopener noreferrer">WhatsApp 分享</a>
      <button type="button" class="secondary-button" id="show-comparison-qr">顯示 QR code</button>
      ${explainReady()?'<button type="button" class="secondary-button" id="explain-comparison">叫 AI 解釋</button>':''}
      <span id="comparison-share-status" role="status"></span>
    </div>
    <p class="comparison-note">營養按標籤換算。「—」係未知。購買前請核對實物。</p>
    <div class="table-scroll" role="region" aria-label="食品比較表" tabindex="0">
      <table class="comparison-table comparison-${chosen.length}">
        <thead><tr><th scope="col">項目</th>${chosen.map(product=>`<th scope="col">
          <span class="compare-product-name">${esc(product.nameZh||product.nameEn)}</span>
          <span class="comparison-source-badge">${esc(getNutritionSourceLabel(product))}</span>
          ${comparisonBasis==='package'?`<span class="table-small">${esc(comparisonPackLabel(getComparisonPackNutrition(product)))}</span>`:''}
          <button type="button" class="comparison-remove" data-remove-compare="${esc(product.id)}" aria-label="移除 ${esc(product.nameZh||product.nameEn)}">移除 ×</button>
        </th>`).join('')}</tr></thead>
        <tbody id="comparison-rows">${compareTableRows(chosen)}</tbody>
      </table>
    </div>
    <p class="comparison-note">價格快照 ${esc(snapshotLabel())} · 未套用優惠。</p>
    ${comparisonSources(chosen)}`;
}
function openShareLink({showQr=false}={}) {
  const url=comparisonShareUrl(location.href,filters,selected);
  const image=$('comparison-qr-image');
  $('comparison-link-field').value=url;
  $('comparison-qr-status').textContent='';
  image.replaceChildren();
  if(showQr){
    try{image.innerHTML=qrSvg(url);}
    catch{$('comparison-qr-status').textContent='未能整出 QR code，可以直接複製下面嘅連結。';}
  }
  openDialog('comparison-share-dialog');
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
  $('sources-content').innerHTML=`<p>網站收錄 <strong>${number(products.length)} 項食品</strong>、${number(prices)} 筆商戶價格。${nutritionCount} 項有部分或完整營養數值；${completeCount} 項有指定香港來源完整過敏聲明。大量格價記錄唔等於大量已核對營養／過敏標籤。</p><div class="source-card"><h3>消費者委員會「格價資訊通」：已批量匯入</h3><p>${imported?`已匯入 ${number(imported.importedCount)} 項一般食品、${number(imported.priceObservationCount)} 筆價格，涵蓋 ${imported.merchantCount} 個商戶代碼，包括惠康、百佳、Market Place 及 AEON。`:'整批資料暫未載入，目前只顯示逐件核對記錄。'}來源提供中英文品牌、商品、分類、規格名稱、各店單件價及優惠文字；沒有營養、成分、過敏原、條碼或即時庫存。擷取：${esc(dated)}；唔係即時價格。官方每日更新，本網站係已儲存快照，未有自動每日同步。</p>${link('https://data.gov.hk/tc-data/dataset/cc-pricewatch-pricewatch','DATA.GOV.HK 官方資料集','source-link')}${link('https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json','消委會原始價格資料','source-link')}${link('https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch_data_dictionary.pdf','欄位說明','source-link')}<p>${imported?`原檔 ${number(imported.rawRecordCount)} 項，排除 ${number(imported.excludedRecordCount)} 項酒類、家居／寵物用品、個人護理及混合奶粉／嬰兒用品組；因此成人奶粉亦暫未涵蓋。`:''}只涵蓋官方清單所列商戶及商品，唔代表全港超市所有商品。P 開頭來源代號唔係條碼；只在另有品牌、口味及容量一致證據時配對參考營養，唔會單靠相似名稱混配。</p></div><div class="source-card"><h3>惠康、百佳與香港品牌：逐件補充標籤</h3><p>香港價格由消委會清單提供；可取得嘅香港品牌／零售商商品頁及背標照片，另作逐件核對。商戶連結會標示係商品頁、商戶主頁或格價資料頁。已由惠康公開商品詳情取得對應包裝圖並逐張閱讀，並非全庫營養／過敏表。部分圖庫混有不同口味或容量舊圖，已按可見身份扣起；百佳部分頁面未能存取，未繞過限制。</p></div><div class="source-card"><h3>政府食安中心 NIIS：一般食物營養參考</h3><p>政府資料庫可查一般食物營養；品牌、配方及批次可以不同，平均值不能代填某款包裝食品嘅營養或過敏聲明。本網站提供官方查詢入口，未將其整個資料庫複製公開；食安中心再分發條款要求事先書面授權。</p>${link('https://www.cfs.gov.hk/tc_chi/nutrient/','到政府 NIIS 查詢','source-link')}${link('https://www.cfs.gov.hk/english/notices/notices.html','政府資料使用條款','source-link')}${link('https://www.cfs.gov.hk/english/faq/faq_14.html','營養標籤 FAQ','source-link')}</div><div class="source-card"><h3>香港營養學會 HKNA</h3><p>已閱讀2026年飲品及食品兩份共39頁表格，選取同品牌、口味及個別包裝容量一致嘅營養事實；原表有320項，未整庫複製。能量按明示單包容量換算，未提供嘅總碳水等維持未知。學生小食分類唔係糖尿病患者適合標準，未有用一般食品平均值填補品牌數字。</p>${link('https://www.hkna.org.hk/database-of-prepackaged-snacks-2026/','HKNA 官方資料庫介紹','source-link')}</div><h3>篩選及比較方式</h3><ul><li>預算按所選商戶嘅整包單件價計算；未套用會員、多件優惠、運費，未知價格唔當零。</li><li>過敏篩選排除含有、可能含有及資料不足。大量新增價格記錄唔會自動通過過敏條件；未列出唔等於保證安全。</li><li>已確認基準可按每100g／100ml或自訂份量計算；OFF舊索引未區分g／ml時只顯示每100單位原值，禁止份量換算及營養排名；缺失值保留未知；唔作藥物相容性或整日膳食判斷。</li><li>每次先顯示24項；搜尋及篩選涵蓋整個已載入資料庫。</li><li>AI 條件助手（EdUHK MaaS）只會建議條件同連結，網站會逐項驗證，未能辨認嘅過敏原會提示；AI 唔會自己提供產品數字。小組測試完成之後，比較表先會出現「叫 AI 解釋」，到時 AI 亦只可以讀出你貼俾佢、由網站整理嘅比較數字。「一句話篩選」係固定字詞，唔係生成式 AI，喺你部機處理。網站冇要求登入或儲存病歷、藥物及過敏資料。</li><li>每100ml 同每100g 會分開排名；比較表嘅「最低」只係同一基準下嘅數字比較。</li></ul><p>價格資料擁有權：消費者委員會。來源：消費者委員會「格價資訊通」及 DATA.GOV.HK。資料供應方沒有認可或背書本學生原型。品牌及零售商保留各自權利。</p>${link('https://data.gov.hk/en/terms-and-conditions','DATA.GOV.HK 使用條款','source-link')}<p><a href="data/products.json" target="_blank" rel="noopener">逐件核對嘅標籤資料 ↗</a> · <a href="data/pricewatch-meta.json" target="_blank" rel="noopener">整批匯入範圍及日期 ↗</a> · <a href="data/pricewatch-foods.json" target="_blank" rel="noopener">本網站食品價格快照 ↗</a></p>`;
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
  const parsed=parseRequestWithBrandFallback(text,{brandIndex,products,libraryScope:defaults().libraryScope});
  const kept=filters.allergens.filter(id=>!parsed.allergens.includes(id));
  filters={...defaults(),query:parsed.query,category:parsed.category==='all'?'':parsed.category,budget:parsed.budget,store:parsed.store==='all'?'':parsed.store,origin:parsed.origin??'',sort:parsed.sort,
    // A new sentence never removes allergy conditions already set; they are removed only by their own × button.
    allergens:[...new Set([...parsed.allergens,...kept])]};
  if(filters.store&&!$('store').querySelector(`option[value="${CSS.escape(filters.store)}"]`))filters.store='';
  const queryWarnings=new Set(searchQueryLimitations(filters.query));
  const notes=(parsed.notices??[]).filter(note=>!queryWarnings.has(note));
  if(kept.length)notes.unshift(`已保留之前揀嘅過敏條件：避開${kept.map(id=>allergens[id]??id).join('、')}（要取消請撳佢個 ×）。`);
  updateFilters({sync:true});
  // On a phone the results are below the fold, so the conditions that were applied are repeated next to the sentence.
  const applied=activeFilterEntries().map(([,words])=>words);
  $('request-feedback').innerHTML=`${notes.length?`<span class="request-notes">${esc(notes.join(' '))}</span>`:''}
    <span class="applied-summary"><strong>已套用：</strong>${applied.length?esc(applied.join(' · ')):'認唔到任何條件'}<br>${esc($('result-count').textContent)}</span>
    <button type="button" class="text-button" data-jump-results>睇結果 ↓</button>`;
  if(parsed.allergyUnclear){
    const words=parsed.unclearAllergyWords??[];
    $('filter-details').open=true;$('allergy-options').scrollIntoView({block:'center'});
    toast(words.length?`網站認唔到「${words.join('、')}」係邊類過敏原；請喺「需要避開嘅過敏原」親手剔選。`:'你提到過敏，但系統認唔到係邊種；請喺「需要避開嘅過敏原」親手剔選。');
  }
  return {...parsed,keptAllergens:kept};
}
function renderEmptyActions(){
  const box=$('empty-actions');
  if(results.length||!dataset||holdReason()){box.innerHTML='';return;}
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
  // With data missing, a link may be only partly applied. Until the person changes something, the address is left
  // as it arrived, so a retry or a reload can still restore everything the link asked for.
  if(missingFiles.length&&linkUntouched())return;
  try{history.replaceState(null,'',comparisonShareUrl(location.href,filters,selected));}catch{/* some previews block history updates */}
}
async function copyCurrentLink(){
  const link=currentLink();
  try{await navigator.clipboard.writeText(link);toast('已複製呢組條件嘅連結，可以貼俾組員或者測試者。');}
  catch{toast(`未能自動複製，請手動複製呢條連結：${link}`);}
}
function showLinkBanner(state,{degraded=false}={}){
  const banner=$('link-banner');
  if(!state.present){banner.hidden=true;return;}
  const intro=state.source==='ai'?'已套用 AI 助手建議嘅條件，請先核對：':
    state.compareIds?.length?`已套用分享連結 · 已選 ${state.compareIds.length} 款比較食品。`:'已套用連結帶入嘅條件，請先核對：';
  const unsupported=state.unsupportedAllergens??[];
  // Unknown words and allergies the site knows but cannot filter are told apart, so neither is misdescribed.
  const problems=[...state.ignored.map(item=>`${item}未能辨認`),...state.ignoredAllergens.map(item=>`過敏原「${item}」未能辨認，冇套用`),...unsupported.map(item=>`「${item}」網站篩唔到，冇套用`)];
  // With data missing, a valid shop or food in the link can look unknown, so the banner says it may be temporary.
  const waiting=degraded?'<br><span class="link-problems">部分資料未載入，連結入面有啲條件或者比較食品可能暫時用唔到。資料載入齊之後，如果你未改過條件，網站會再讀一次呢條連結。</span>':'';
  banner.className=`link-banner${state.ignoredAllergens.length||unsupported.length||degraded?' warning':''}`;
  banner.innerHTML=`<p><strong>${esc(intro)}</strong>下面每個條件都可以逐個移除。${(state.notes??[]).length?`<br>${esc(state.notes.join(' '))}`:''}${problems.length?`<br><span class="link-problems">${esc(problems.join('；'))}。如有需要，請喺篩選自己揀返，同埋睇清楚包裝。</span>`:''}${waiting}</p><button type="button" class="text-button" id="dismiss-link-banner">知道</button>`;
  banner.hidden=false;
  linkSignature=JSON.stringify(filters);
}
/** Privacy receipt: read from the browser's own records when the person opens it; nothing is sent anywhere. */
function renderPrivacyReceipt(){
  const entries=[...performance.getEntriesByType('navigation'),...performance.getEntriesByType('resource')];
  const net=summariseConnections(entries,location.href);
  let storageKeys=[];
  try{storageKeys=Object.keys(localStorage);}catch{storageKeys=[];}
  const kept=summariseStorage({cookie:document.cookie,storageKeys});
  const hostRow=item=>`<li><strong>${esc(item.host)}</strong> · ${number(item.count)} 個請求 · ${item.own?'呢個網站本身':'其他網站'}</li>`;
  const verdict=net.otherHosts.length
    ?`<p class="privacy-result warning">有 ${number(net.otherHosts.reduce((sum,item)=>sum+item.count,0))} 個請求連咗去其他網站（見上面清單）。</p>`
    :'<p class="privacy-result">全部請求都係連去呢個網站本身，冇連去廣告或者追蹤服務。</p>';
  $('privacy-content').innerHTML=`
    <p>呢張收據係你部瀏覽器自己嘅紀錄，撳開嗰刻先讀出嚟，唔會傳去任何地方。</p>
    <section class="detail-section"><h3>呢頁連過邊度</h3>
      <p>由開頁到而家，瀏覽器一共發出 <strong>${number(net.total)}</strong> 個請求：</p>
      <ul class="privacy-list">${net.hosts.map(hostRow).join('')||'<li>瀏覽器冇提供紀錄。</li>'}</ul>
      ${net.total?verdict:''}
    </section>
    <section class="detail-section"><h3>留喺你部機嘅資料</h3>
      <ul class="privacy-list">
        <li>網頁程式讀到嘅 Cookie：<strong>${number(kept.cookieCount)}</strong> 個${kept.cookieNames.length?`（${esc(kept.cookieNames.join('、'))}）`:''}</li>
        <li>瀏覽器儲存：<strong>${number(kept.items.length)}</strong> 項${kept.items.length?`（${esc(kept.items.map(item=>`${item.label}：${item.key}`).join('、'))}）`:''}</li>
      </ul>
    </section>
    <section class="detail-section"><h3>要留意</h3>
      <ul class="privacy-list">
        <li>搜尋同篩選喺你部機計算。不過你揀嘅條件（包括過敏原）會顯示喺網址；重新整理或者分享連結時，網址會送到網站伺服器同收連結嘅人。</li>
        <li>除此之外，呢頁唔會將呢個網址傳出去：載入資料同開其他網站嘅連結嗰陣，都唔會附上你而家嘅網址。</li>
        <li>網站放喺 GitHub Pages。GitHub 表示會為保安記錄到訪者嘅 IP 位址。${link('https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages','GitHub 說明','text-link')}</li>
        <li>AI 助手係另一個網站（${esc(AI_ASSISTANT.platform||'AI')}）。你開咗佢，先會將你打嘅字傳過去，小組可以查閱對話紀錄。</li>
        <li>商戶同資料來源連結會開其他網站，佢哋有自己嘅私隱做法。</li>
      </ul>
    </section>`;
}
function initAssistant(){
  const status=assistantState(AI_ASSISTANT);
  const ready=status.state==='ready';
  $('ai-assistant-link').hidden=!ready;
  $('ai-assistant-link').href=ready?status.url:'#';
  $('ai-assistant-pending').hidden=ready;
  if(status.state==='expired')$('ai-assistant-pending').textContent=`AI 助手連結已經喺 ${dateLabel(status.expires)} 到期，小組更新之後會再出現。你可以先用「一句話篩選」。`;
  const showExpiry=ready&&Boolean(status.expires);
  $('ai-assistant-expiry').hidden=!showExpiry;
  $('ai-assistant-expiry').textContent=showExpiry?`連結有效至 ${dateLabel(status.expires)}`:'';
  if(status.expiryUnreadable)console.warn('ai-config.mjs: linkExpires should look like 2026-11-30; the expiry date is being ignored.');
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
  $('search-form').addEventListener('submit',event=>{event.preventDefault();clearTimeout(searchTimeout);searchTimeout=null;filters.query=$('food-search').value.trim();render();$('results').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
  $('food-search').addEventListener('input',()=>{clearTimeout(searchTimeout);searchTimeout=setTimeout(()=>{searchTimeout=null;filters.query=$('food-search').value.trim();render();},160);});
  $('budget').addEventListener('input',()=>{const value=$('budget').value;filters.budget=value===''?null:Math.max(0,Math.min(10000,Number(value)));updateFilters();});
  ['store','origin','sort'].forEach(id=>$(id).addEventListener('change',()=>{filters[id]=$(id).value;updateFilters();}));
  $('allergy-options').addEventListener('change',()=>{filters.allergens=[...document.querySelectorAll('input[name=allergen]:checked')].map(input=>input.value);updateFilters();});
  $('reset-filters').addEventListener('click',resetFilters);$('empty-reset').addEventListener('click',resetFilters);
  document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{filters.category=button.dataset.category;updateFilters({sync:true});}));
  document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>{filters.query=button.dataset.query;updateFilters({sync:true});}));
  document.querySelectorAll('[data-budget]').forEach(button=>button.addEventListener('click',()=>{filters.budget=Number(button.dataset.budget);updateFilters({sync:true});}));
  $('active-filters').addEventListener('click',event=>{const button=event.target.closest('[data-remove-filter]');if(!button)return;const key=button.dataset.removeFilter;if(key.startsWith('allergen:'))filters.allergens=filters.allergens.filter(id=>id!==key.slice(9));else filters[key]=key==='budget'?null:key==='libraryScope'?'priced':key==='sort'?'relevance':'';updateFilters({sync:true});});
  $('product-grid').addEventListener('click',event=>{
    const compare=event.target.closest('[data-compare]');
    const detail=event.target.closest('[data-detail]');
    if(compare){
      toggleCompare(compare.dataset.compare);
      $('product-grid').querySelector(`[data-compare="${CSS.escape(compare.dataset.compare)}"]`)?.focus({preventScroll:true});
    }else if(detail)showProductDetail(detail.dataset.detail);
  });
  $('exclusion-panel').addEventListener('click',event=>{
    const detail=event.target.closest('[data-excluded-detail]');
    if(detail)showProductDetail(detail.dataset.excludedDetail,{evidence:true});
    if(event.target.closest('[data-close-exclusions]'))toggleExclusions(false);
  });
  $('detail-content').addEventListener('click',event=>{
    const action=event.target.closest('[data-detail-compare]');
    const evidence=event.target.closest('[data-nutrient-evidence]');
    const alternative=event.target.closest('[data-alternative-detail]');
    if(evidence)showNutrientEvidence(evidence);
    if(alternative)showProductDetail(alternative.dataset.alternativeDetail);
    if(!action)return;
    if(filters.allergens.length&&getAllergenAssessment(detailProduct,filters.allergens).status!=='no-listed-match')return;
    toggleCompare(action.dataset.detailCompare);
    renderDetail(detailProduct);
    addLabelEvidence(detailProduct);
    $('detail-content').querySelector('[data-detail-compare]').focus({preventScroll:true});
  });
  $('clear-comparison').addEventListener('click',()=>{selected=[];render();});
  $('open-comparison').addEventListener('click',()=>{if(comparingPaused(missingFiles))return;renderComparison();if(selected.length>=2)openDialog('compare-dialog');});
  $('compare-content').addEventListener('click',async event=>{
    const button=event.target.closest('[data-remove-compare]');
    const evidence=event.target.closest('[data-nutrient-evidence]');
    if(button)toggleCompare(button.dataset.removeCompare);
    if(evidence)showNutrientEvidence(evidence);
    if(event.target.closest('#show-comparison-qr'))openShareLink({showQr:true});
    if(event.target.closest('#explain-comparison'))openExplain();
    if(!event.target.closest('#share-comparison'))return;
    const result=await shareComparison(comparisonShareUrl(location.href,filters,selected));
    if(!$('compare-dialog').open)return;
    if(result==='copied')$('comparison-share-status').textContent='已複製比較連結。';
    if(result==='manual'){
      openShareLink();
      $('comparison-link-field').select();
    }
  });
  $('copy-ai-explain').addEventListener('click',async()=>{
    const field=$('ai-explain-text');
    try{await navigator.clipboard.writeText(field.value);$('ai-explain-status').textContent='已複製比較資料，可以貼俾 AI 助手。';}
    catch{field.focus();field.select();$('ai-explain-status').textContent='未能自動複製：文字已經選取，請自己複製。';}
  });
  $('copy-comparison-link').addEventListener('click',async()=>{
    const field=$('comparison-link-field');
    try{
      await navigator.clipboard.writeText(field.value);
      $('comparison-qr-status').textContent='已複製比較連結。';
    }catch{
      field.focus();
      field.select();
      $('comparison-qr-status').textContent='請複製已選取嘅連結。';
    }
  });
  $('compare-content').addEventListener('change',event=>{if(event.target.id==='comparison-basis'){comparisonBasis=event.target.value;renderComparison();$('comparison-basis').focus();}});
  $('compare-content').addEventListener('input',event=>{if(event.target.id==='comparison-portion'){const value=Number(event.target.value);const invalid=event.target.value===''||!Number.isFinite(value)||value<=0||value>10000;event.target.setCustomValidity(invalid?'請輸入大於0、最多10000嘅份量。':'');comparisonPortion=invalid?NaN:value;showPortionError(invalid);const chosen=selected.map(id=>products.find(p=>p.id===id));$('comparison-rows').innerHTML=compareTableRows(chosen);}});
  ['sources-button','data-info-button','footer-sources'].forEach(id=>$(id).addEventListener('click',()=>{if(!dataset){toast('食品資料未載入，暫時未有來源清單。請先撳「再試一次」。');return;}renderSources();addOpenFoodFactsSources();addHkReviewSources();openDialog('sources-dialog');}));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
  $('assistant-toggle').addEventListener('click',()=>{const expanded=$('assistant-toggle').getAttribute('aria-expanded')==='true';$('assistant-toggle').setAttribute('aria-expanded',String(!expanded));$('assistant-panel').hidden=expanded;if(!expanded)$('request-input').focus();});
  $('request-form').addEventListener('submit',event=>{event.preventDefault();const text=$('request-input').value.trim();if(!text){$('request-input').focus();return;}applyParsedRequest(text);});
  document.querySelectorAll('[data-request]').forEach(button=>button.addEventListener('click',()=>{const parsed=applyParsedRequest(button.dataset.request);toast(`已用「一句話篩選」解讀「${button.dataset.request}」${parsed.keptAllergens.length?`，並保留避開${parsed.keptAllergens.map(id=>allergens[id]??id).join('、')}`:''}；請核對上面嘅條件。`);}));
  $('empty-actions').addEventListener('click',event=>{const button=event.target.closest('[data-relax]');if(!button)return;const key=button.dataset.relax;filters[key]=key==='budget'?null:'';updateFilters({sync:true});});
  $('copy-link').addEventListener('click',copyCurrentLink);
  $('privacy-button').addEventListener('click',()=>{renderPrivacyReceipt();openDialog('privacy-dialog');});
  document.addEventListener('click',event=>{if(event.target.closest('[data-open-label-lesson]')&&!$('label-lesson-dialog').open)openDialog('label-lesson-dialog');});
  document.addEventListener('click',event=>{
    if(!event.target.closest('[data-jump-results]'))return;
    $('results').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    $('result-count').tabIndex=-1;
    $('result-count').focus({preventScroll:true});
  });
  $('link-banner').addEventListener('click',event=>{if(event.target.closest('#dismiss-link-banner'))$('link-banner').hidden=true;});
}

// ---- Data loading: every file on its own, failures always visible, retry keeps the person's conditions ----
const loadedFiles=new Map();
const initialSearch=location.search;
let loading=false;
/** The address has been read at least once. Kept apart from "data has arrived", so a failed first attempt cannot skip it. */
let linkApplied=false;
/** What the person had already set while the data was still loading. A link adds to this; it never wipes it. */
let ownConditions=null;
let linkCompareIds=[];
/** True while the conditions and compared foods are exactly what the link set. */
const linkUntouched=()=>linkSignature!==null&&linkSignature===JSON.stringify(filters)&&JSON.stringify(selected)===JSON.stringify(linkCompareIds);
const readDataFile=name=>fetchJson(new URL(`data/${name}`,import.meta.url));

function renderLoadNotice(missing){
  const summary=describeMissing(missing);
  const box=$('load-notice');
  if(!summary){box.hidden=true;box.innerHTML='';return;}
  box.innerHTML=`<p><strong>${esc(summary.message)}</strong>${esc(summary.note)}</p><button type="button" class="secondary-button" data-retry-load>再試一次</button>`;
  box.hidden=false;
}
function showLoadFailure(){
  $('product-grid').setAttribute('aria-busy','false');
  $('product-grid').innerHTML='<div class="error-message" role="alert"><p>暫時載入唔到食品資料。請檢查網絡，然後撳「再試一次」；如果你直接開啟 HTML 檔案，請改用網站連結。</p><button type="button" class="secondary-button" data-retry-load>再試一次</button></div>';
  $('result-count').textContent='食品資料暫時未能載入';$('snapshot-note').textContent='資料載入未完成。';
}
function applyDataset(assembled){
  dataset=assembled.dataset;
  products=dataset.products;
  missingFiles=assembled.missing;
  const coverage=hkLabelCoverage(products);
  $('coverage-products').textContent=number(coverage.original);
  $('coverage-nutrition').textContent=number(coverage.anyNutrition);
  $('coverage-hk-nutrition').textContent=number(coverage.reviewedNutrition);
  $('coverage-labels').textContent=number(coverage.completeAllergy);
  $('hk-label-progress').value=coverage.reviewedNutrition;
  $('hk-progress-text').textContent=`香港營養來源已讀 ${number(coverage.reviewedNutrition)} / 1,000 款目標 · 其中 ${number(coverage.fullCoreNutrition)} 款具完整「1+7」數值`;
  let status='';
  if(dataset.imports?.pricewatch)status=`已匯入消委會 ${number(dataset.imports.pricewatch.importedCount)} 項一般食品；標籤另按 Open Food Facts、品牌／香港零售商資料逐件核對。價格資料唔包含營養或過敏聲明。`;
  if(dataset.enrichment&&assembled.priced){status=`以上全部按原有香港格價目錄計算。「有營養參考數值」包含部分資料、社群及次級參考；「香港來源已讀」另行核對品牌／香港零售商網頁或包裝圖片，並非現批實物檢驗。未用額外無價格食品計入1,000款目標。`;}
  const gaps=[];
  const missing=assembled.missing;
  if(!assembled.priced)gaps.push('整批價格資料暫未載入；目前只顯示逐件核對嘅小型資料集。');
  if(missing.includes(HK_EXPANSION_FILE)||missing.includes(OFF_LIBRARY_FILE))gaps.push('部分擴展營養資料暫未載入。');
  if(missing.includes(OFF_LABEL_FILE))gaps.push('部分 Open Food Facts 標籤資料暫未載入，現顯示其餘已取得來源。');
  if(missing.some(name=>REVIEW_FILES.includes(name)))gaps.push('本輪部分香港標籤未能載入，數量只計已成功取得資料。');
  $('catalogue-status').textContent=[status,...gaps].filter(Boolean).join(' ');
  Object.entries(dataset.stores??{}).forEach(([id,store])=>{stores[id]=typeof store==='string'?store:store.name??id;});
  const storeIds=[...new Set(products.flatMap(product=>(product.prices??[]).map(price=>price.store)))];
  $('store').innerHTML='<option value="">所有商戶</option>'+storeIds.map(id=>`<option value="${esc(id)}">${esc(stores[id]??id)}</option>`).join('');
  const origins=[...new Set(products.map(product=>product.origin).filter(origin=>typeof origin==='string'&&origin.trim()))].sort();
  $('origin').innerHTML='<option value="">所有／未確認產地</option>'+origins.map(origin=>`<option value="${esc(origin)}">${esc(origin)}</option>`).join('');
  $('snapshot-note').textContent=`價格快照 ${snapshotLabel()}（非即時）`;
  // Stable default puts documented nutrition before price-only records without implying health ranking.
  products=[...products].sort((a,b)=>Number(Boolean(hkEvidenceLabel(b)))-Number(Boolean(hkEvidenceLabel(a)))||Number(hasNutrition(b))-Number(hasNutrition(a))||Number(Boolean(productUnit(b)))-Number(Boolean(productUnit(a)))||
    (a.nutritionSourceFamily==='off-community-reference'&&b.nutritionSourceFamily==='off-community-reference'?String(b.offMetadata?.lastModifiedAt??'').localeCompare(String(a.offMetadata?.lastModifiedAt??'')):0));
  brandIndex=buildBrandIndex(products);
  // Conditions handed over by the AI assistant or a shared link are validated, applied, then shown for checking.
  // They start from whatever the person set while the data was loading: the link's allergens are added to the
  // person's own, and a link only replaces a condition that it names itself.
  // After a retry the link is read again only if the person has changed nothing since, so compared foods that
  // were missing the first time come back; otherwise the person's own conditions are kept as they are.
  const outcome={reapplied:false,dropped:0};
  // Words typed a moment ago (still waiting for the short typing pause) count as the person's own condition too.
  if(searchTimeout){clearTimeout(searchTimeout);searchTimeout=null;filters.query=$('food-search').value.trim();}
  if(!linkApplied||linkUntouched()){
    if(!linkApplied)ownConditions={...filters,allergens:[...filters.allergens]};
    const linkState=filtersFromParams(initialSearch,{storeIds,base:{...ownConditions,allergens:[...ownConditions.allergens]},products,brandIndex});
    outcome.reapplied=linkApplied&&linkState.present;
    if(linkState.present){filters=linkState.filters;selected=linkState.compareIds;linkCompareIds=[...linkState.compareIds];}
    linkApplied=true;
    syncInputs();
    showLinkBanner(linkState,{degraded:missing.length>0});
  }else{
    // The compared foods are checked again against the allergens, now with whatever extra data has arrived.
    const kept=selected.filter(id=>{const product=products.find(item=>item.id===id);return product&&(!filters.allergens.length||getAllergenAssessment(product,filters.allergens).status==='no-listed-match');});
    outcome.dropped=selected.length-kept.length;
    selected=kept;
    if(filters.store&&!storeIds.includes(filters.store))filters.store='';
    syncInputs();
  }
  linkReady=true;
  renderLoadNotice(missing);
  render();
  refreshOpenDialogs();
  return outcome;
}
/** When the data changes under an open dialog, the dialog shows the new data too; small pop-ups built from the old data close. */
function refreshOpenDialogs(){
  ['nutrient-evidence-dialog','ai-explain-dialog','comparison-share-dialog'].forEach(id=>{if($(id).open)$(id).close();});
  const keepFocusIn=dialog=>{if(dialog.open&&!dialog.contains(document.activeElement))dialog.querySelector('.close-button')?.focus({preventScroll:true});};
  if($('compare-dialog').open){
    if(comparingPaused(missingFiles))$('compare-dialog').close();else renderComparison();
    keepFocusIn($('compare-dialog'));
  }
  if($('detail-dialog').open&&detailProduct){
    const current=products.find(item=>item.id===detailProduct.id);
    if(current){renderDetail(current);addLabelEvidence(current);}else $('detail-dialog').close();
    keepFocusIn($('detail-dialog'));
  }
}
/** After "try again", focus goes to the next thing to act on: the retry button if it is still needed, otherwise the result count. */
function focusAfterRetry(slot){
  const buttons=[...document.querySelectorAll('[data-retry-load]')].filter(button=>!button.disabled&&button.getClientRects().length);
  const next=buttons.find(button=>(button.closest('#load-notice')?'notice':'grid')===slot)??buttons[0];
  if(next){next.focus();return;}
  const count=$('result-count');
  count.tabIndex=-1;
  count.focus({preventScroll:true});
}
async function loadData({byUser=false,slot=''}={}){
  if(loading)return;
  loading=true;
  const first=!dataset;
  document.querySelectorAll('[data-retry-load]').forEach(button=>{button.disabled=true;button.textContent='正在重新載入…';});
  if(first){$('product-grid').setAttribute('aria-busy','true');$('product-grid').innerHTML='<div class="loading-state">正在核對食品資料…</div>';$('result-count').textContent='正在載入食品資料…';}
  const slow=setTimeout(()=>{if(loading&&!dataset)$('result-count').textContent='網絡較慢，仍然載入緊食品資料…';},6000);
  try{
    const {failures}=await loadDataFiles(readDataFile,loadedFiles);
    failures.forEach(failure=>console.warn(`Data file not loaded: ${failure.file} (${failure.reason})`));
    const assembled=assembleDataset(loadedFiles);
    if(assembled.fatal){if(first)showLoadFailure();else renderLoadNotice(assembled.missing);console.error('NutriCompare dataset loading failed: core product data unavailable');return;}
    const outcome=applyDataset(assembled);
    if(!first){
      const message=assembled.missing.length?'仍然有資料未能載入，可以遲啲再試。':
        outcome.reapplied?'資料已經載入齊，已經再讀一次連結入面嘅條件同比較食品。':'資料已經載入齊，你揀嘅條件保持不變。';
      toast(message+(outcome.dropped?`已移除 ${outcome.dropped} 項未能符合過敏條件嘅比較食品。`:''));
    }
  }catch(error){
    if(first)showLoadFailure();else renderLoadNotice(assembleDataset(loadedFiles).missing);
    console.error('NutriCompare dataset loading failed:',error.message);
  }finally{
    clearTimeout(slow);
    loading=false;
    // A button that was not drawn again must not stay switched off.
    document.querySelectorAll('[data-retry-load][disabled]').forEach(button=>{button.disabled=false;button.textContent='再試一次';});
    if(byUser)focusAfterRetry(slot);
  }
}
function start(){
  // Tells the small script in the page that the program did start (see index.html).
  document.documentElement.dataset.app='started';
  $('allergy-options').innerHTML=Object.entries(allergens).map(([id,label])=>`<label><input type="checkbox" name="allergen" value="${id}">${label}</label>`).join('');
  if(window.matchMedia('(max-width:760px)').matches)$('filter-details').open=false;
  initAssistant();
  import('./ai-config.mjs?v=110').then(module=>{
    if(!module.AI_ASSISTANT||typeof module.AI_ASSISTANT!=='object')throw new Error('AI_ASSISTANT is missing');
    AI_ASSISTANT=module.AI_ASSISTANT;
    initAssistant();
    if($('compare-dialog').open)renderComparison();
  }).catch(error=>console.warn('app/ai-config.mjs could not be read, so the AI assistant button stays hidden. Check its quotes and commas.',error?.message??error));
  initTextSize();
  wireEvents();
  document.addEventListener('click',event=>{const button=event.target.closest('[data-retry-load]');if(button)loadData({byUser:true,slot:button.closest('#load-notice')?'notice':'grid'});});
  loadData();
}
start();
