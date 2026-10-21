import { filterProducts, getEligiblePrices, getMinPrice, getAllergenAssessment, nutritionFor, parseRequest } from './engine.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '#'; } catch { return '#'; } };
const link = (url, label, cls='') => `<a class="${esc(cls)}" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const money = value => value === null || value === undefined ? '—' : Number(value).toFixed(1);
const number = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-HK', {maximumFractionDigits:1});
const stores = {PARKNSHOP:'百佳',WELLCOME:'惠康',JASONS:'Market Place',AEON:'AEON',DCHFOOD:'大昌食品',WATSONS:'屈臣氏'};
const allergens = {gluten:'含麩質穀物',crustaceans:'甲殼類',eggs:'蛋類',fish:'魚類',peanuts:'花生',soy:'大豆',milk:'奶類','tree-nuts':'木本堅果',sesame:'芝麻',sulphites:'亞硫酸鹽'};
const categories = {biscuits:'餅乾',snacks:'小食',drinks:'飲品'};
const nutrientFields = [['energyKcal','能量','kcal'],['carbohydrates','碳水化合物','g'],['sugars','糖','g'],['protein','蛋白質','g'],['fat','總脂肪','g'],['saturatedFat','飽和脂肪','g'],['fibre','膳食纖維','g'],['sodiumMg','鈉','mg']];
const defaults = () => ({query:'',category:'',budget:null,store:'',allergens:[],origin:'',sort:'relevance'});
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

function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>$('toast').hidden=true,4200); }
function brandName(product) { return typeof product.brand === 'object' ? product.brand['zh-Hant'] ?? product.brand.zh ?? product.brand.en ?? '' : product.brand ?? ''; }
function productUnit(product) { return product.nutrition?.basisUnit ?? product.quantityUnit ?? 'g'; }
function hasNutrition(product) { return nutrientFields.some(([key])=>product.nutrition?.[key] !== null && product.nutrition?.[key] !== undefined); }
function sourceWarning(product) {
  const warning = product.sourceLimit ?? product.versionNote ?? product.nutrition?.sourceLimit ?? product.nutrition?.versionNote;
  if (warning) return Array.isArray(warning) ? warning.join('；') : String(warning);
  if (product.nutrition?.hkVersionVerified === false || product.hkVersionVerified === false) return '營養來源屬海外版本，未核實與香港包裝配方一致。';
  return '';
}
function notesText(product) { return Array.isArray(product.notes) ? product.notes.join('；') : typeof product.notes==='string' ? product.notes : ''; }
function allergyLabel(product) {
  const assessment = getAllergenAssessment(product,filters.allergens);
  if (assessment.status==='no-listed-match') return {text:'聲明未列所選過敏原；仍需核對包裝',cls:'matched'};
  const list = (product.allergens?.contains??[]).map(id=>allergens[id]??id).join('、');
  if (product.allergens?.status==='complete') return {text:list?`標籤列明含有：${list}`:'已記錄過敏聲明；仍需核對包裝',cls:''};
  return {text:list?`已知含有：${list}；資料未齊`:'過敏資料未齊，未能確認',cls:''};
}
function foodArt(product,index=0) {
  const drinks=product.category==='drinks';
  const colour=['#ad8058','#7d9670','#ba8b6d','#ad9d68','#648c81'][index%5];
  const label=drinks?'DRINK':/oat|燕麥/i.test(product.nameEn+' '+product.nameZh)?'OATS':product.category==='biscuits'?'CRUNCH':'SNACK';
  const svg=drinks?`<svg viewBox="0 0 140 125" aria-hidden="true"><path d="M45 16 57 6h31l12 12v99H42V18Z" fill="${colour}"/><path d="m45 16 12-10 1 12h40M58 18v99" fill="none" stroke="#ffffff66"/><path d="M41 39h59v50H41Z" fill="#faf8ed"/><text x="71" y="61" text-anchor="middle" fill="${colour}" font-size="11" font-family="Georgia,serif" font-weight="bold">${label}</text><path d="M58 72q13-15 26 0-14 17-26 0" fill="${colour}" opacity=".65"/><path d="M67 11h13" stroke="#e9f0df" stroke-width="4"/></svg>`:`<svg viewBox="0 0 140 125" aria-hidden="true"><path d="M24 15h91l-3 99H27Z" fill="${colour}"/><path d="M24 15h91v7H24m3 85h85v7H27" fill="#ffffff25"/><path d="M24 22h91M27 107h85" fill="none" stroke="#ffffff55"/><rect x="31" y="34" width="77" height="42" rx="2" fill="#faf7e9"/><text x="70" y="52" fill="${colour}" font-size="6" text-anchor="middle" font-family="system-ui">EVERYDAY CHOICES</text><text x="70" y="67" fill="${colour}" font-size="12" font-weight="bold" text-anchor="middle" font-family="Georgia,serif">${label}</text><circle cx="63" cy="92" r="18" fill="#dfbc81" stroke="#c18e54" stroke-width="3"/><circle cx="80" cy="96" r="17" fill="#d1a05d" stroke="#bd8448" stroke-width="3"/><path d="m58 89 4 0m15 3 4 0m-9 8 4 0m-13-5 2 0" stroke="#a07140" stroke-width="2.5"/></svg>`;
  return `<div class="product-visual tone-${index%5+1}">${svg}<span class="visual-caption">品類示意圖</span></div>`;
}
function productCard(product,index) {
  const n=nutritionFor(product);
  const prices=getEligiblePrices(product,filters).sort((a,b)=>a.price-b.price);
  const price=getMinPrice(product,filters);
  const chosen=selected.includes(product.id);
  const a=allergyLabel(product);
  const warning=sourceWarning(product);
  const overseas=product.dataStatus==='overseas-reference'||product.nutrition?.region==='overseas-reference';
  const sourceStatus=!hasNutrition(product)?'營養資料待補':overseas?'海外配方參考 · 香港未核對':product.dataStatus==='hkna-reference'?'本地部分資料 · 包裝未核對':'部分標籤資料 · 包裝未核對';
  return `<article class="product-card${chosen?' selected':''}" data-product="${esc(product.id)}"><div style="position:relative">${foodArt(product,index)}<span class="status-badge${!hasNutrition(product)||warning?' partial':''}">${esc(sourceStatus)}</span></div><div class="product-body"><p class="product-brand">${esc(brandName(product))}</p><h3>${esc(product.nameZh || product.nameEn)}</h3><p class="product-size">${esc(product.packSize??'包裝待確認')} · ${esc(categories[product.category]??'包裝食品')}</p><div class="nutrient-heading"><span>每 100 ${esc(productUnit(product))}</span><button type="button" data-detail="${esc(product.id)}" aria-label="查看${esc(product.nameZh)}標籤來源">標籤來源 ↗</button></div><div class="nutrient-strip"><div><small>碳水化合物</small><strong>${number(n.carbohydrates)}<small>g</small></strong></div><div><small>糖</small><strong>${number(n.sugars)}<small>g</small></strong></div><div><small>鈉</small><strong>${number(n.sodiumMg)}<small>mg</small></strong></div></div><p class="allergen-line ${a.cls}">${esc(a.text)}</p><div class="price-line"><span class="price"><small>HK$</small>${money(price)}<span class="price-from">${filters.store?'':'起'}</span></span><span class="merchant-count">${prices.length} 個渠道</span></div><p class="merchant-label">${esc(prices.length?stores[prices[0].store]??prices[0].store:'暫無已核實價格')} · 整包單件價</p><div class="card-actions"><button type="button" data-detail="${esc(product.id)}">詳情 / 購買 ↗</button><button class="compare-add" type="button" data-compare="${esc(product.id)}" aria-pressed="${chosen}" aria-label="${chosen?'移除':'加入'}${esc(product.nameZh)}${chosen?'嘅比較':'作比較'}">${chosen?'✓ 已加入':'＋ 加入比較'}</button></div></div></article>`;
}
function filterTotal() { return Number(Boolean(filters.query))+Number(Boolean(filters.category))+Number(filters.budget!==null)+Number(Boolean(filters.store))+filters.allergens.length+Number(Boolean(filters.origin)); }
function syncInputs() {
  $('food-search').value=filters.query;
  $('budget').value=filters.budget??'';
  $('store').value=filters.store;
  $('origin').value=filters.origin;
  $('sort').value=filters.sort;
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
  filters.allergens.forEach(id=>entries.push([`allergen:${id}`,`避開${allergens[id]??id}`]));
  $('active-filters').innerHTML=entries.map(([key,text])=>`<span class="active-filter">${esc(text)}<button data-remove-filter="${esc(key)}" aria-label="移除${esc(text)}條件">×</button></span>`).join('');
  $('filter-count').textContent=String(filterTotal());
}
function render() {
  if(!dataset)return;
  results=filterProducts(products,filters);
  $('result-count').textContent=`${results.length} 項符合條件 · 資料庫共 ${products.length} 項食品`;
  $('product-grid').innerHTML=results.map(productCard).join('');
  $('product-grid').setAttribute('aria-busy','false');
  $('empty-state').hidden=results.length>0;
  $('allergy-notice').hidden=!filters.allergens.length;
  if(filters.allergens.length){
    const candidates=filterProducts(products,{...filters,allergens:[]});
    const conflicts=candidates.filter(p=>getAllergenAssessment(p,filters.allergens).status==='conflict').length;
    const unknown=candidates.filter(p=>getAllergenAssessment(p,filters.allergens).status==='unknown').length;
    $('allergy-notice').textContent=`已避開${filters.allergens.map(id=>allergens[id]??id).join('、')}：${conflicts} 項因含有／可能含有而排除，${unknown} 項因資料不足而排除。結果唔等於安全保證，請核對實物包裝。`;
    $('empty-description').textContent=results.length?'':`目前條件下，${conflicts} 項列出所選過敏原，${unknown} 項資料不足。未有可確認符合條件嘅產品；你可以調整名稱、預算或商戶，網站唔會自動放寬過敏限制。`;
  }else $('empty-description').textContent='試下另一個名稱，或者調整預算及商戶。資料庫仍在逐件補充；冇結果唔代表市面冇呢類食品。';
  const mixedUnits=new Set(results.map(productUnit)).size>1;
  $('sort-note').hidden=!(mixedUnits&&['carbs-asc','sugar-asc','protein-desc'].includes(filters.sort));
  $('sort-note').textContent='食品同時有每100g及每100ml基準，暫不按營養值混合排名。請先選同類食品。';
  renderActiveFilters();
  renderTray();
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
  return (product.sources??[]).map(source=>`<div>${link(source.url,source.label??source.name??'資料來源','source-link')}<div class="source-scope">${esc(Array.isArray(source.scope)?source.scope.join('、'):source.scope??'產品資料')} · 查閱 ${esc(source.checkedAt??'日期未記錄')}</div></div>`).join('') || '<p>此項來源尚待補充。</p>';
}
function carbDefinition(product) {
  const value=product.nutrition?.carbohydrateDefinition;
  return value==='available'?'可利用碳水化合物':value==='total'?'總碳水化合物（來源定義）':'來源未明確區分總／可利用碳水';
}
function renderDetail(product) {
  detailProduct=product;
  const index=products.indexOf(product);
  const n=nutritionFor(product);
  const warning=sourceWarning(product);
  const prices=getEligiblePrices(product).sort((a,b)=>a.price-b.price);
  const label=product.allergens??{};
  $('detail-content').innerHTML=`<div class="detail-heading">${foodArt(product,index)}<div><p>${esc(brandName(product))}</p><h2>${esc(product.nameZh??product.nameEn)}</h2><p>${esc(product.nameEn??'')}</p><p>${esc(product.packSize??'包裝待確認')} · 產地：${esc(product.origin??'未確認')}</p></div></div>${warning?`<div class="inline-notice amber">${esc(warning)}</div>`:''}<section class="detail-section"><h3>營養標籤比較</h3><table class="nutrition-table"><caption>每 100 ${esc(productUnit(product))} · 「—」代表未知</caption><tbody>${nutrientFields.map(([key,label,unit])=>`<tr><th scope="row">${label}</th><td>${number(n[key])} ${unit}</td></tr>`).join('')}</tbody></table><p>碳水定義：${esc(carbDefinition(product))}。糖係碳水化合物嘅一部分；本頁唔計算「淨碳水」。</p>${notesText(product)?`<p>${esc(notesText(product))}</p>`:''}</section><section class="detail-section"><h3>成分與過敏聲明</h3><p><strong>資料狀態：</strong>${label.status==='complete'?'已記錄指定版本完整聲明；仍須核對當前包裝':'未完整核實，不能用作確認過敏安全'}</p><p><strong>已知含有：</strong>${esc(label.contains?.length?label.contains.map(id=>allergens[id]??id).join('、'):'未列出／未能確認')}</p><p><strong>已知可能含有：</strong>${esc(label.mayContain?.length?label.mayContain.map(id=>allergens[id]??id).join('、'):'未列出／未能確認')}</p>${label.text?`<p>${esc(label.text)}</p>`:''}${product.ingredients||product.ingredientsSummary?`<p><strong>成分資料摘要：</strong>${esc(product.ingredientsSummary??(typeof product.ingredients==='string'?product.ingredients:product.ingredients.text??'見原始來源'))}</p>`:''}<p>未列出唔代表不存在。對食品過敏者應核對實物包裝，必要時直接向生產商確認。</p></section><section class="detail-section"><h3>香港價格與購買渠道</h3><p>以下係整包單件價格快照，並未套用多件／會員優惠。商戶連結唔代表已確認庫存；查閱日期唔等於價格生效日期。</p>${prices.length?prices.map(price=>`<div class="merchant-row"><div>${esc(stores[price.store]??price.store)}<small>查閱 ${esc(price.checkedAt??dataset.priceSnapshotAt??dataset.updatedAt??'日期未記錄')}</small></div><strong>HK$${money(price.price)}</strong>${link(price.url??price.sourceUrl,(price.linkType==='product'||price.urlKind==='product')?'到商品頁':price.linkType==='search'?'到商戶搜尋':'到商戶網站')}</div>`).join(''):'<p>暫無已核實價格。</p>'}</section><section class="detail-section"><h3>逐項資料來源</h3>${sourceLinks(product)}</section><div style="margin-top:20px"><button class="secondary-button" data-detail-compare="${esc(product.id)}">${selected.includes(product.id)?'從比較移除':'加入營養比較'}</button></div>`;
}
function compareTableRows(chosen) {
  const basis=comparisonBasis;
  const values=chosen.map(product=>nutritionFor(product,basis,basis==='portion'?comparisonPortion:null));
  let html=`<tr><th scope="row">本表比較份量</th>${chosen.map(product=>`<td>${basis==='100'?'100':number(comparisonPortion)} ${esc(productUnit(product))}</td>`).join('')}</tr><tr><th scope="row">碳水定義</th>${chosen.map(product=>`<td class="neutral">${esc(carbDefinition(product))}</td>`).join('')}</tr>`;
  html+=nutrientFields.map(([key,label,unit])=>`<tr><th scope="row">${label}</th>${values.map(n=>`<td>${number(n[key])} <small>${unit}</small></td>`).join('')}</tr>`).join('');
  html+=`<tr class="group-row"><th colspan="${chosen.length+1}">香港整包價格 · ${esc(stores[filters.store]??'所有商戶')} · 不隨營養份量換算</th></tr>`;
  html+=`<tr><th scope="row">最低整包價</th>${chosen.map(product=>`<td>HK$${money(getMinPrice(product,filters))}<span class="table-small">${esc(product.packSize??'包裝待確認')}</span></td>`).join('')}</tr>`;
  html+=`<tr><th scope="row">有價格記錄渠道</th>${chosen.map(product=>`<td class="neutral">${esc(getEligiblePrices(product,filters).map(price=>`${stores[price.store]??price.store} $${money(price.price)}`).join(' / ')||'所選商戶暫無價格')}</td>`).join('')}</tr>`;
  html+=`<tr><th scope="row">過敏聲明狀態</th>${chosen.map(product=>`<td class="neutral">${esc(allergyLabel(product).text)}</td>`).join('')}</tr>`;
  html+=`<tr><th scope="row">資料版本</th>${chosen.map(product=>`<td class="neutral">${esc(sourceWarning(product)||'詳情請核對原始來源及香港包裝')}</td>`).join('')}</tr>`;
  html+=`<tr><th scope="row">來源</th>${chosen.map(product=>`<td>${(product.sources??[]).slice(0,3).map(source=>link(source.url,source.label??'資料來源','source-link')).join('')}</td>`).join('')}</tr>`;
  return html;
}
function renderComparison(){
  const chosen=selected.map(id=>products.find(p=>p.id===id)).filter(Boolean);
  if(chosen.length<2){if($('compare-dialog').open)$('compare-dialog').close();toast('請先揀至少 2 項食品作比較。');return;}
  const mixed=new Set(chosen.map(productUnit)).size>1;
  const excluded=chosen.filter(product=>!results.some(p=>p.id===product.id));
  $('compare-content').innerHTML=`${excluded.length?'<div class="inline-notice amber">部分已選食品唔符合目前搜尋／預算／商戶條件；保留喺比較表供核對，唔代表通過篩選。</div>':''}${mixed?'<div class="inline-notice amber">包含 g 同 ml 兩種標籤基準，不能直接當成相同份量比較；請留意各欄單位。</div>':''}<div class="comparison-controls"><label for="comparison-basis">比較方式</label><select id="comparison-basis"><option value="100"${comparisonBasis==='100'?' selected':''}>每 100 g / ml</option><option value="portion"${comparisonBasis==='portion'?' selected':''}>自訂相同 g / ml 份量</option></select><label for="comparison-portion"${comparisonBasis==='100'?' hidden':''}>自訂份量</label><input id="comparison-portion" type="number" min="0.1" max="10000" step="0.1" value="${comparisonPortion}" aria-label="自訂比較份量，按各食品標籤的克或毫升"${comparisonBasis==='100'?' hidden':''}></div><p class="comparison-note">自訂份量只係按標籤比例計算，唔係建議食量；碳水定義及地區配方可能不同。本表唔作個人健康評分。</p><div class="table-scroll" tabindex="0" aria-label="食品比較表，可左右捲動"><table class="comparison-table"><thead><tr><th scope="col">比較項目</th>${chosen.map(product=>`<th scope="col">${esc(product.nameZh)}<span class="table-small">${esc(brandName(product))}</span><button class="comparison-remove" data-remove-compare="${esc(product.id)}">移除此項 ×</button></th>`).join('')}</tr></thead><tbody id="comparison-rows">${compareTableRows(chosen)}</tbody></table></div><p class="comparison-note">價格查閱：${esc(dataset.priceSnapshotAt??dataset.updatedAt??'見各來源')}。未計運費、會員及多件優惠；請到商戶確認售價與庫存。營養「—」係未知，唔係零。</p>`;
}
function showPortionError(invalid) {
  let error=$('portion-error');
  if(!error){error=document.createElement('p');error.id='portion-error';error.className='inline-notice amber';error.setAttribute('role','status');$('compare-content').querySelector('.comparison-controls')?.after(error);}
  error.hidden=!invalid;
  error.textContent=invalid?'請輸入大於 0、最多 10000 嘅份量。數值未有效前，營養換算保留未知。':'';
}
function renderSources(){
  const dated=dataset?.priceSnapshotAt??dataset?.updatedAt??'見各項來源';
  const nutritionCount=products.filter(hasNutrition).length;
  const completeCount=products.filter(p=>p.allergens?.status==='complete').length;
  $('sources-content').innerHTML=`<p>呢個功能原型收錄 <strong>${products.length} 項食品</strong>；${nutritionCount} 項有部分或完整營養數值，${completeCount} 項已記錄完整過敏聲明。收錄範圍有限，唔代表全港產品。</p><div class="source-card"><h3>消費者委員會「格價資訊通」</h3><p>香港商戶、品牌、規格及整包價格。資料查閱日期：${esc(dated)}。官方資料冇營養、過敏原及即時庫存。</p>${link('https://data.gov.hk/tc-data/dataset/cc-pricewatch-pricewatch','官方資料集','source-link')}${link('https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json','官方價格 JSON','source-link')}</div><div class="source-card"><h3>生產商／品牌官方資料</h3><p>逐件記錄營養、成分及版本；海外標籤會另作提示，唔當成已確認香港配方。每項食品嘅詳情頁都附來源及查閱日期。</p></div><div class="source-card"><h3>香港營養學會 HKNA</h3><p>部分本地小食資料用作交叉參考。其學生小食分類唔等於糖尿病患者適合標準，亦唔用一般食品平均值填補品牌數字。</p>${link('https://www.hkna.org.hk/database-of-prepackaged-snacks-2026/','官方資料庫介紹','source-link')}</div><div class="source-card"><h3>香港食物安全中心</h3><p>用作理解營養基準、碳水定義及過敏聲明。糖、總碳水及可利用碳水唔可以混為一談。</p>${link('https://www.cfs.gov.hk/english/faq/faq_14.html','營養標籤 FAQ','source-link')}${link('https://www.cfs.gov.hk/english/multimedia/multimedia_pub/multimedia_pub_fsf_123_02.html','過敏原資料','source-link')}</div><h3>篩選及比較點樣運作？</h3><ul><li>預算按所選商戶嘅整包單件價計算；未知價格唔會當成零。</li><li>選過敏原後，含有、可能含有及資料不足都排除。未列出唔等於保證安全。</li><li>營養按每100g／100ml或你自訂份量計算，缺失值保留未知；唔作藥物相容性或整日膳食判斷。</li><li>以固定字詞辨認嘅條件助手唔係生成式 AI。網站暫未接駁教大或 Azure API。</li><li>唔要求登入，唔儲存病歷、藥物或過敏資料。重新載入會清除已選條件；資料來源及商戶連結會開啟外部網站。</li></ul><p>${esc(typeof dataset?.attribution==='string'?dataset.attribution:'香港價格資料來源：消費者委員會格價資訊通。營養來源按各產品列明；原品牌與商戶擁有各自權利。')}</p>${link('https://data.gov.hk/en/terms-and-conditions','開放資料使用條款','source-link')}<p><a href="data/products.json" target="_blank" rel="noopener">查看此版本嘅結構化資料及來源 ↗</a></p>`;
}

function wireEvents(){
  $('search-form').addEventListener('submit',event=>{event.preventDefault();clearTimeout(searchTimeout);filters.query=$('food-search').value.trim();render();$('results').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
  $('food-search').addEventListener('input',()=>{clearTimeout(searchTimeout);searchTimeout=setTimeout(()=>{filters.query=$('food-search').value.trim();render();},160);});
  $('budget').addEventListener('input',()=>{const value=$('budget').value;filters.budget=value===''?null:Math.max(0,Math.min(10000,Number(value)));updateFilters();});
  ['store','origin','sort'].forEach(id=>$(id).addEventListener('change',()=>{filters[id]=$(id).value;updateFilters();}));
  $('allergy-options').addEventListener('change',()=>{filters.allergens=[...document.querySelectorAll('input[name=allergen]:checked')].map(input=>input.value);updateFilters();});
  $('reset-filters').addEventListener('click',resetFilters);$('empty-reset').addEventListener('click',resetFilters);
  document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{filters.category=button.dataset.category;updateFilters({sync:true});}));
  document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>{filters.query=button.dataset.query;updateFilters({sync:true});}));
  document.querySelectorAll('[data-budget]').forEach(button=>button.addEventListener('click',()=>{filters.budget=Number(button.dataset.budget);updateFilters({sync:true});}));
  $('active-filters').addEventListener('click',event=>{const button=event.target.closest('[data-remove-filter]');if(!button)return;const key=button.dataset.removeFilter;if(key.startsWith('allergen:'))filters.allergens=filters.allergens.filter(id=>id!==key.slice(9));else filters[key]=key==='budget'?null:'';updateFilters({sync:true});});
  $('product-grid').addEventListener('click',event=>{const compare=event.target.closest('[data-compare]');const detail=event.target.closest('[data-detail]');if(compare)toggleCompare(compare.dataset.compare);else if(detail){const product=products.find(p=>p.id===detail.dataset.detail);if(product){renderDetail(product);openDialog('detail-dialog');}}});
  $('detail-content').addEventListener('click',event=>{const button=event.target.closest('[data-detail-compare]');if(button){const product=products.find(p=>p.id===button.dataset.detailCompare);if(filters.allergens.length&&getAllergenAssessment(product,filters.allergens).status!=='no-listed-match'){toast('此產品未能符合目前過敏條件，唔會加入比較。');return;}toggleCompare(button.dataset.detailCompare);renderDetail(detailProduct);}});
  $('clear-comparison').addEventListener('click',()=>{selected=[];render();});
  $('open-comparison').addEventListener('click',()=>{renderComparison();if(selected.length>=2)openDialog('compare-dialog');});
  $('compare-content').addEventListener('click',event=>{const button=event.target.closest('[data-remove-compare]');if(button)toggleCompare(button.dataset.removeCompare);});
  $('compare-content').addEventListener('change',event=>{if(event.target.id==='comparison-basis'){comparisonBasis=event.target.value;renderComparison();}});
  $('compare-content').addEventListener('input',event=>{if(event.target.id==='comparison-portion'){const value=Number(event.target.value);const invalid=event.target.value===''||!Number.isFinite(value)||value<=0||value>10000;event.target.setCustomValidity(invalid?'請輸入大於0、最多10000嘅份量。':'');comparisonPortion=invalid?NaN:value;showPortionError(invalid);const chosen=selected.map(id=>products.find(p=>p.id===id));$('comparison-rows').innerHTML=compareTableRows(chosen);}});
  ['sources-button','data-info-button','footer-sources'].forEach(id=>$(id).addEventListener('click',()=>{renderSources();openDialog('sources-dialog');}));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
  $('assistant-toggle').addEventListener('click',()=>{const expanded=$('assistant-toggle').getAttribute('aria-expanded')==='true';$('assistant-toggle').setAttribute('aria-expanded',String(!expanded));$('assistant-panel').hidden=expanded;if(!expanded)$('request-input').focus();});
  $('request-form').addEventListener('submit',event=>{event.preventDefault();const text=$('request-input').value.trim();if(!text){$('request-input').focus();return;}const parsed=parseRequest(text);filters={...defaults(),...parsed,category:parsed.category==='all'?'':parsed.category,store:parsed.store==='all'?'':parsed.store,origin:parsed.origin??''};$('request-feedback').textContent=(parsed.notices??[]).join(' ');updateFilters({sync:true});});
}

async function start(){
  $('allergy-options').innerHTML=Object.entries(allergens).map(([id,label])=>`<label><input type="checkbox" name="allergen" value="${id}">${label}</label>`).join('');
  if(window.matchMedia('(max-width:760px)').matches)$('filter-details').open=false;
  wireEvents();
  try{
    const response=await fetch(new URL('data/products.json',import.meta.url),{cache:'no-cache'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    dataset=await response.json();
    if(!Array.isArray(dataset.products)||!dataset.products.length)throw new Error('食品資料格式不完整');
    products=dataset.products;
    const origins=[...new Set(products.map(product=>product.origin).filter(origin=>typeof origin==='string'&&origin.trim()))].sort();
    $('origin').innerHTML='<option value="">所有／未確認產地</option>'+origins.map(origin=>`<option value="${esc(origin)}">${esc(origin)}</option>`).join('');
    $('snapshot-note').textContent=`價格查閱：${dataset.priceSnapshotAt??dataset.updatedAt??'見詳情'}。`;
    // Stable default puts documented nutrition before price-only records without implying health ranking.
    products=[...products].sort((a,b)=>Number(hasNutrition(b))-Number(hasNutrition(a)));
    render();
  }catch(error){
    $('product-grid').setAttribute('aria-busy','false');$('product-grid').innerHTML='<div class="error-message">暫時載入唔到食品資料。請檢查網絡並重新整理；如果你直接開啟 HTML 檔案，請改用網站連結。</div>';
    $('result-count').textContent='食品資料暫時未能載入';$('snapshot-note').textContent='資料載入未完成。';
    console.error('NutriCompare dataset loading failed:',error.message);
  }
}
start();
