// Browser checks for NutriCompare v1.10: loading recovery and holds, brand fallback, unit-price ranking, comparison,
// privacy receipt, label lesson, "ask the AI to explain", assistant settings, desktop density, axe. See README.md in this folder.
// Usage: node v110.cjs [base url] [screenshot folder]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.argv[2] || 'http://127.0.0.1:8800/';
const SHOTS = process.argv[3] || path.join(require('os').tmpdir(), 'nutricompare-v110-shots');
const CHECKER = require('url').pathToFileURL(path.join(__dirname, '..', 'check-ai-numbers.mjs')).href;
// Settings used when a check needs a particular AI assistant state. These checks never open the group's real MaaS link.
// Two checks follow whatever the served settings file (app/ai-config.mjs) says; see `shipped`, filled in before the flows run.
let shipped = { state: 'pending', url: '', explain: false };
const assistantConfig = ({ url = 'https://maas.example.org/agent/abc', expires = '2099-12-31', tested = true } = {}) =>
  `export const AI_ASSISTANT = Object.freeze({ url: '${url}', platform: 'EdUHK MaaS', linkExpires: '${expires}', explainTested: ${tested} });`;
const useAssistant = (page, options) => page.route('**/ai-config.mjs*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: assistantConfig(options) }));
fs.mkdirSync(SHOTS, { recursive: true });
const host = new URL(BASE).host;
const log = []; const axeLog = [];
const check = (name, pass, detail = '') => { log.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const ready = page => page.waitForFunction(() => document.querySelector('#product-grid')?.getAttribute('aria-busy') === 'false', null, { timeout: 40000 });
const open = async (page, qs = '') => { await page.goto(BASE + qs, { waitUntil: 'networkidle' }); await ready(page); await page.waitForTimeout(200); };
const text = async (page, sel) => (await page.locator(sel).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
async function axe(page, label) {
  await page.addScriptTag({ content: axeSrc });
  const r = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  axeLog.push({ label, violations: r.violations.map(v => ({ id: v.id, n: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })) });
}
const closeDialogs = async page => { for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(120); } };

async function flow(browser, label, contextOptions) {
  const phone = label === 'phone';
  const ctx = await browser.newContext({ ...contextOptions, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const requests = []; const withReferer = []; page.on('request', r => { requests.push(r.url()); if (r.headers().referer) withReferer.push(r.url()); });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const T = name => `${label}: ${name}`;

  await open(page);
  check(T('normal load shows no load notice'), await page.locator('#load-notice').isHidden(), await text(page, '#result-count'));
  check(T('search box limit equals the link limit (60)'), (await page.getAttribute('#food-search', 'maxlength')) === '60');
  check(T('version label says v1.10'), /v1\.10/.test(await page.locator('.prototype-label').textContent()), '');

  // Desktop first screen / phone first card
  const fold = await page.evaluate(() => { const c = document.querySelector('#product-grid .product-card'); const b = s => Math.round(c.querySelector(s)?.getBoundingClientRect().bottom ?? 99999); return { vh: innerHeight, name: b('h3'), strip: Math.round(c.querySelector('.nutrient-strip').getBoundingClientRect().top), buttons: b('.card-actions'), overflowX: document.documentElement.scrollWidth > innerWidth }; });
  if (phone) check(T('first card and its buttons still fit the first screen'), fold.buttons <= fold.vh && !fold.overflowX, JSON.stringify(fold));
  else check(T('first row shows food name and nutrient figures on the first screen'), fold.name < fold.vh && fold.strip < fold.vh && !fold.overflowX, JSON.stringify(fold));

  // Sentence filter / AI assistant panel
  await page.click('#assistant-toggle'); await page.waitForTimeout(200);
  const titles = await page.$$eval('#assistant-panel .assistant-title', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(T('panel names the sentence filter (not AI) first and the AI assistant second'), /一句話篩選.*唔係 AI/.test(titles[0]) && /AI 助手/.test(titles[1]), titles.join(' | '));
  // The AI assistant area follows the served settings file: a button when a working link is set, otherwise a note.
  if (shipped.state === 'ready') check(T('AI assistant button opens the link in the settings file'), await page.locator('#ai-assistant-link').isVisible() && (await page.getAttribute('#ai-assistant-link', 'href')) === shipped.url && await page.locator('#ai-assistant-pending').isHidden(), await text(page, '#ai-assistant-expiry'));
  else check(T(`AI assistant shows a note and no button (settings: ${shipped.state})`), await page.locator('#ai-assistant-pending').isVisible() && await page.locator('#ai-assistant-link').isHidden(), (await text(page, '#ai-assistant-pending')).slice(0, 40));
  await axe(page, `${label} sentence filter / AI panel open`);
  await page.fill('#request-input', 'pure orange juice'); await page.press('#request-input', 'Enter'); await page.waitForTimeout(600);
  check(T('sentence "pure orange juice" → 30 foods and a note that the brand was not used'), /^30 /.test(await text(page, '#result-count')) && /搵唔到「PURE」牌子嘅呢類食品，所以改為搜尋所有牌子嘅「果汁」/.test(await text(page, '#request-feedback')), `${await text(page, '#result-count')}`);
  // What was applied is repeated beside the sentence, with a way to jump to the results (on a phone they are below the fold).
  const summary = await page.evaluate(() => { const el = document.querySelector('#request-feedback .applied-summary'); const r = el?.getBoundingClientRect(); return el ? { text: el.innerText.replace(/\s+/g, ' ').trim(), visible: r.top >= 0 && r.bottom <= innerHeight } : null; });
  check(T('after a sentence, the applied conditions are shown beside it without scrolling'), !!summary && summary.visible && /已套用：搜尋：果汁 · 飲品/.test(summary.text) && /30 項食品/.test(summary.text), JSON.stringify(summary));
  await axe(page, `${label} sentence applied (summary shown)`);
  await page.click('#request-feedback [data-jump-results]'); await page.waitForTimeout(700);
  const jumped = await page.evaluate(() => { const r = document.getElementById('result-count').getBoundingClientRect(); return { inView: r.top >= 0 && r.bottom <= innerHeight, focus: document.activeElement?.id }; });
  check(T('"see results" moves to the result count'), jumped.inView && jumped.focus === 'result-count', JSON.stringify(jumped));
  await open(page, '?q=pure%20orange%20juice&src=ai');
  check(T('AI link "pure orange juice" → 30 foods with the same note in the banner'), /^30 /.test(await text(page, '#result-count')) && /搵唔到「PURE」牌子嘅呢類食品，所以改為搜尋所有牌子嘅「果汁」/.test(await text(page, '#link-banner')), await text(page, '#result-count'));
  // The search box stops at 60 characters; the page now says so instead of cutting a pasted sentence short in silence.
  // Typed through the keyboard, as a person would, so the browser applies the length limit.
  await page.fill('#food-search', ''); await page.focus('#food-search');
  await page.keyboard.insertText('我想搵一啲啱糖尿病人食嘅餅乾同埋飲品價錢唔好太貴最好二十蚊以下仲要冇花生同埋冇奶類成分嘅產品可以介紹下嗎唔該晒你呀另外我想知道邊間超級市場最平同埋有冇特價優惠'); await page.waitForTimeout(500);
  check(T('a pasted sentence that hits the search limit gets a notice pointing to the sentence filter'), (await page.inputValue('#food-search')).length === 60 && /搜尋欄最多 60 個字/.test(await text(page, '#search-feedback')), await text(page, '#search-feedback'));
  await open(page, '?q=Vita%20lemon%20tea&src=ai');
  check(T('AI link "Vita lemon tea" still keeps the brand'), /^4 /.test(await text(page, '#result-count')) && !/牌子/.test(await text(page, '#link-banner')), await text(page, '#result-count'));

  // Unit price ranking
  await open(page, '?q=' + encodeURIComponent('牛奶'));
  await page.selectOption('#sort', 'unit-price-asc'); await page.waitForTimeout(500);
  const unitLines = await page.$$eval('#product-grid .product-card', cards => cards.map(c => c.querySelector('.product-unit-price.sorted')?.textContent.trim() ?? null));
  const prices = unitLines.filter(Boolean).map(l => ({ v: Number(/HK\$([\d.]+)／100(g|ml)/.exec(l)?.[1]), u: /／100(g|ml)/.exec(l)?.[1] }));
  let ordered = true; for (let i = 1; i < prices.length; i++) if (prices[i].u === prices[i - 1].u && prices[i].v < prices[i - 1].v) ordered = false;
  const unitSwitches = prices.filter((p, i) => i && p.u !== prices[i - 1].u).length;
  check(T('unit-price ranking is ascending within each unit, and the unit price is emphasised'), prices.length >= 10 && ordered && unitSwitches <= 1, `${prices.length} cards with unit price; first ${JSON.stringify(prices[0])}`);
  check(T('ranking note explains that g and ml are ranked apart'), /每100ml/.test(await text(page, '#sort-note')) && /每100g/.test(await text(page, '#sort-note')), (await text(page, '#sort-note')).slice(0, 70));
  check(T('the ranking is kept in the address and survives a reload'), /sort=unit-price-asc/.test(page.url()), page.url().split('?')[1]);
  await page.reload({ waitUntil: 'networkidle' }); await ready(page);
  check(T('reload restores the unit-price ranking'), (await page.inputValue('#sort')) === 'unit-price-asc');
  await axe(page, `${label} unit-price ranking`);

  // Comparison table. "Ask the AI" is offered only when the served settings have a working link and Mode 2 is marked as tested.
  await open(page, '?sort=sodium-asc&compare=P000000304,P000000298,P000000014');
  await page.click('#open-comparison'); await page.waitForTimeout(400);
  check(T(`with the served settings, "ask the AI to explain" is ${shipped.explain ? 'offered' : 'not offered'}`), (await page.locator('#explain-comparison').count() === 1) === shipped.explain && await page.locator('#share-comparison').isVisible());
  await closeDialogs(page);
  await useAssistant(page);
  await open(page, '?sort=sodium-asc&compare=P000000304,P000000298,P000000014');
  await page.click('#open-comparison'); await page.waitForTimeout(400);
  const rows = await page.$$eval('#comparison-rows tr > th:first-child', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  check(T('sodium follows carbohydrates and sugars in the comparison'), rows[2].startsWith('碳水化合物') && rows[3].startsWith('糖') && rows[4].startsWith('鈉'), rows.slice(1, 6).join(' | '));
  check(T('the ranked row is marked and shows the gap 701.9 mg'), /目前排序項目/.test(rows[4]) && /高低相差 701\.9 mg/.test(rows[4]) && await page.locator('#comparison-rows tr.sorted-row').count() === 1, rows[4]);
  const marks = await page.$$eval('#comparison-rows tr', trs => trs.map(tr => ({ name: tr.querySelector('th')?.childNodes[0]?.textContent.trim() ?? '', lowest: !!tr.querySelector('.lowest-tag'), gap: !!tr.querySelector('.row-difference'), unknown: [...tr.querySelectorAll('td')].some(td => td.innerText.trim().startsWith('—')) })));
  check(T('"lowest" and the gap appear only on rows with no unknown value'), marks.some(m => m.lowest) && marks.every(m => !(m.unknown && (m.lowest || m.gap))), marks.filter(m => m.lowest).map(m => m.name).join('、'));
  await axe(page, `${label} comparison with ranked row`);
  await page.screenshot({ path: path.join(SHOTS, `${label}-compare.png`) });

  // Ask the AI to explain
  const table = await page.locator('#compare-content').innerText();
  await page.click('#explain-comparison'); await page.waitForTimeout(300);
  const block = await page.inputValue('#ai-explain-text');
  const { unsupportedNumbers } = await import(CHECKER);
  const notOnScreen = unsupportedNumbers(table + ' 食品 1 食品 2 食品 3', block);
  check(T('explain text starts with the fixed header and uses only figures shown in the table'), block.startsWith('【NutriCompare 比較資料】') && notOnScreen.length === 0, `${block.length} chars; not on screen: ${notOnScreen.map(n => n.raw).join(',') || 'none'}`);
  check(T('explain text writes unknown as 未知 and gives no health verdict of its own'), /反式脂肪：未知/.test(block) && /唔好評價邊款好啲/.test(block) && !/較健康|適合糖尿病/.test(block));
  // The AI is told not to rank exactly the rows the table itself does not rank.
  const gapLine = /網站已計嘅高低相差：(.*)/.exec(block)?.[1] ?? '';
  const noRankLine = /唔可以直接比高低：(.*)/.exec(block)?.[1] ?? '';
  const tableGaps = marks.filter(m => m.gap).map(m => m.name);
  const nutrientGapsInText = tableGaps.filter(name => name !== '每 100 g／ml').every(name => gapLine.includes(name));
  const unknownRows = marks.filter(m => m.unknown && ['能量', '碳水化合物', '糖', '鈉', '蛋白質', '總脂肪', '飽和脂肪', '反式脂肪', '膳食纖維'].includes(m.name)).map(m => m.name);
  check(T('explain text: gaps match the table, and rows the site does not rank are named as "do not rank"'), tableGaps.length > 0 && nutrientGapsInText && /碳水化合物（各款碳水化合物定義唔同或者未寫明）/.test(noRankLine) && unknownRows.length > 0 && unknownRows.every(name => noRankLine.includes(name)) && !gapLine.includes('碳水化合物') && /列喺「唔可以直接比高低」嘅項目，只可以逐款讀出數字/.test(block), `gaps: ${gapLine} || no rank: ${noRankLine}`);
  await page.click('#copy-ai-explain'); await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  check(T('"copy" puts exactly that text on the clipboard'), clip === block, await text(page, '#ai-explain-status'));
  check(T('with a tested assistant link, the explain dialog offers the link'), await page.locator('#ai-explain-link').isVisible() && await page.locator('#ai-explain-pending').isHidden());
  await axe(page, `${label} explain dialog`);
  await page.screenshot({ path: path.join(SHOTS, `${label}-explain.png`) });
  await closeDialogs(page);
  await page.unroute('**/ai-config.mjs*');

  // Privacy receipt
  await open(page);
  await page.click('#privacy-button'); await page.waitForTimeout(300);
  const receipt = await text(page, '#privacy-content');
  check(T('privacy receipt: every request went to the site itself, 0 cookies'), new RegExp(`${host.replace('.', '\\.')}.*呢個網站本身`).test(receipt) && /全部請求都係連去呢個網站本身/.test(receipt) && /網頁程式讀到嘅 Cookie：0 個/.test(receipt) && !/其他網站 ·|個請求 · 其他網站/.test(receipt), receipt.slice(0, 120));
  check(T('privacy receipt says the page address is not passed on, and no request carried a Referer'), /都唔會附上你而家嘅網址/.test(receipt) && withReferer.length === 0, `${requests.length} requests so far, ${withReferer.length} with a Referer`);
  await axe(page, `${label} privacy receipt`);
  await page.screenshot({ path: path.join(SHOTS, `${label}-privacy.png`) });
  await closeDialogs(page);
  await page.click('#text-size-toggle'); await page.click('#privacy-button'); await page.waitForTimeout(300);
  check(T('privacy receipt lists the text-size setting once it is saved'), /瀏覽器儲存：1 項（A\+ 大字設定：nc-text-size）/.test(await text(page, '#privacy-content')));
  await axe(page, `${label} privacy receipt A+`);
  await closeDialogs(page);

  // Label lesson (still in A+ mode)
  await page.click('#label-lesson-button'); await page.waitForTimeout(300);
  const first = page.locator('#label-lesson-dialog .sample-label summary').first();
  await first.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  check(T('label lesson rows open with the keyboard'), await page.locator('#label-lesson-dialog .sample-label details').first().evaluate(d => d.open));
  const summaries = page.locator('#label-lesson-dialog .sample-label summary');
  for (let i = 1; i < await summaries.count(); i++) await summaries.nth(i).click();
  const lesson = await text(page, '#label-lesson-dialog');
  check(T('label lesson explains 1+7, the reference amount, sugars within carbohydrates, and "may contain"'), /1\+7/.test(lesson) && /參考量/.test(lesson) && /糖係碳水化合物嘅一部分/.test(lesson) && /唔等於一定冇沾到/.test(lesson) && /示範標籤 · 唔係真實產品/.test(lesson));
  const spoken = await page.locator('#label-lesson-dialog .sample-label').ariaSnapshot();
  const lessonLinks = await page.$$eval('#label-lesson-dialog .lesson-foot a', els => els.map(a => new URL(a.href).host));
  check(T('label lesson rows are announced without the open/close sign, and all 4 sources are government pages'), /飽和脂肪 9 克/.test(spoken) && !/[＋－]/.test(spoken) && lessonLinks.length === 4 && lessonLinks.every(h => h === 'www.cfs.gov.hk' || h === 'www.gov.hk'), lessonLinks.join(', '));
  await axe(page, `${label} label lesson A+ (all rows open)`);
  await page.screenshot({ path: path.join(SHOTS, `${label}-lesson.png`) });
  await closeDialogs(page);
  await page.click('#text-size-toggle');

  // Detail: nutrition first, lesson reachable from there
  await open(page, '?q=' + encodeURIComponent('出前一丁碗麵'));
  await page.click('[data-detail="P000000304"]'); await page.waitForTimeout(400);
  const heads = await page.$$eval('#detail-content h3', els => els.map(e => e.textContent.trim()));
  check(T('product details: nutrition comes before the label-checking record'), heads[0] === '營養標籤比較' && heads[1] === '香港標籤核對紀錄', heads.slice(0, 3).join(' | '));
  await page.click('#detail-content [data-open-label-lesson]'); await page.waitForTimeout(300);
  check(T('label lesson opens from product details'), await page.locator('#label-lesson-dialog').evaluate(d => d.open));
  await axe(page, `${label} label lesson over details`);
  await closeDialogs(page);

  await open(page, '?sort=price-asc&compare=P000000304,P000000298');
  await page.click('#open-comparison'); await page.waitForTimeout(400);
  const priceRow = await page.$$eval('#comparison-rows tr', trs => trs.filter(tr => tr.querySelector('th')?.innerText.includes('整包單件價')).map(tr => ({ cls: tr.className, text: tr.querySelector('th').innerText.replace(/\s+/g, ' ') }))[0]);
  check(T('ranking by price marks the whole-pack price row'), priceRow?.cls === 'sorted-row' && /目前排序項目/.test(priceRow.text) && await page.locator('#comparison-rows tr.sorted-row').count() === 1, JSON.stringify(priceRow));
  await closeDialogs(page);

  const offHost = requests.filter(u => !u.startsWith('data:') && new URL(u).host !== host);
  check(T('every request went to the site itself, none carried a Referer, no cookies, no page errors'), offHost.length === 0 && withReferer.length === 0 && (await ctx.cookies()).length === 0 && errors.length === 0, `${requests.length} requests; errors: ${errors.slice(0, 2).join(' | ') || 'none'}`);
  await ctx.close();
}

async function failureFlow(browser) {
  const phoneCtx = () => browser.newContext({ ...devices['iPhone 13'] });
  const failOnce = async (page, pattern) => { let n = 0; await page.route(pattern, r => (n++ === 0 ? r.fulfill({ status: 503, body: 'x' }) : r.continue())); };
  const failAlways = (page, pattern) => page.route(pattern, r => r.fulfill({ status: 503, body: 'x' }));
  const focusId = page => page.evaluate(() => { const el = document.activeElement; return el?.id || (el?.hasAttribute?.('data-retry-load') ? `retry in ${el.closest('#load-notice') ? 'notice' : 'grid'}` : el?.tagName); });
  const cards = page => page.locator('#product-grid .product-card').count();
  const query = '?q=' + encodeURIComponent('即食麵') + '&avoid=crustaceans&sort=sodium-asc&compare=P000000304,P000000014';

  // F1. One file fails once while a link asks to avoid an allergen: results are held back, then restored by "try again".
  {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await failOnce(page, '**/off-nutrition-library.json*');
    await open(page, query);
    const notice = await text(page, '#load-notice');
    check('hold: a missing file is reported above the results with a retry button', /有 1 份資料未能載入（營養參考資料）/.test(notice) && /唔會顯示過敏篩選結果/.test(notice) && !/排得較後/.test(notice) && await page.locator('#load-notice [data-retry-load]').isVisible(), notice.slice(0, 80));
    const held = { count: await text(page, '#result-count'), cards: await cards(page), message: await text(page, '#product-grid .hold-message') };
    check('hold: with an allergen chosen and a file missing, no food is listed at all', /暫停顯示過敏篩選結果/.test(held.count) && held.cards === 0 && /寧願唔顯示/.test(held.message) && /請直接睇包裝上嘅標籤/.test(held.message) && await page.locator('#product-grid [data-retry-load]').isVisible(), held.count);
    check('hold: no exclusion counts, no "nothing found" suggestions', await page.locator('#exclusion-toggle').isHidden() && await page.locator('#allergy-notice').isHidden() && await page.locator('#empty-state').isHidden());
    check('hold: compared foods are kept but comparing is paused, and the tray says so', (await text(page, '#compare-count')) === '2' && await page.locator('#open-comparison').isDisabled() && /資料未載入齊，暫停比較/.test(await text(page, '#selected-names')));
    check('hold: the address is left as it arrived, and the banner says the link may be only partly applied', decodeURIComponent(page.url()).includes('compare=P000000304,P000000014') && /部分資料未載入/.test(await text(page, '#link-banner')), decodeURIComponent(page.url().split('?')[1]));
    await axe(page, 'phone allergy hold');
    await page.screenshot({ path: path.join(SHOTS, 'phone-allergy-hold.png') });
    await page.click('#product-grid [data-retry-load]'); await page.waitForTimeout(2500);
    const after = { count: await text(page, '#result-count'), cards: await cards(page), tray: await text(page, '#compare-count'), search: await page.inputValue('#food-search'), sort: await page.inputValue('#sort'), avoid: await page.locator('input[name="allergen"][value="crustaceans"]').isChecked(), focus: await focusId(page), toast: await text(page, '#toast') };
    check('hold: "try again" brings the results back and keeps search, allergy, ranking and compared foods', await page.locator('#load-notice').isHidden() && /項來源未列所選過敏原/.test(after.count) && after.cards > 0 && after.search === '即食麵' && after.sort === 'sodium-asc' && after.avoid && after.tray === '2' && await page.locator('#open-comparison').isEnabled(), JSON.stringify(after));
    check('hold: after "try again" focus moves to the result count and the message says the link was read again', after.focus === 'result-count' && /已經再讀一次連結/.test(after.toast), `${after.focus} | ${after.toast}`);
    const ids = await page.$$eval('#product-grid [data-detail]', els => els.slice(0, 8).map(e => e.dataset.detail));
    const clean = await ctx.newPage(); await open(clean, query);
    const cleanIds = await clean.$$eval('#product-grid [data-detail]', els => els.slice(0, 8).map(e => e.dataset.detail));
    check('hold: the recovered page equals a normal load of the same link', (await text(clean, '#result-count')) === after.count && JSON.stringify(cleanIds) === JSON.stringify(ids) && errors.length === 0, `${after.count}; errors: ${errors.join(' | ') || 'none'}`);
    await ctx.close();
  }

  // F2. A file keeps failing, no allergen chosen: browsing works with a warning; choosing an allergen starts the hold.
  {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    await failAlways(page, '**/off-nutrition-library.json*');
    await open(page, '?q=' + encodeURIComponent('出前一丁'));
    const browsing = await cards(page);
    check('degraded: without an allergen chosen, foods are still listed under the notice', browsing > 0 && await page.locator('#load-notice').isVisible(), `${browsing} cards`);
    await page.click('[data-detail="P000000304"]'); await page.waitForTimeout(400);
    check('degraded: product details warn that the allergen statement may be incomplete, and suggest no alternatives', /部分資料未載入，呢度嘅過敏聲明可能唔完整/.test(await text(page, '#detail-content [data-allergen-evidence]')) && await page.locator('#detail-content .alternatives').count() === 0);
    await axe(page, 'phone details while data is missing');
    await closeDialogs(page);
    await page.click('[data-compare="P000000304"]'); await page.click('[data-compare="P000000014"]'); await page.waitForTimeout(200);
    check('degraded: comparing is paused while any file is missing, even with no allergen chosen', (await text(page, '#compare-count')) === '2' && await page.locator('#open-comparison').isDisabled() && /暫停比較/.test(await text(page, '#selected-names')), await text(page, '#selected-names'));
    await page.evaluate(() => { document.getElementById('filter-details').open = true; });
    await page.check('input[name="allergen"][value="crustaceans"]'); await page.waitForTimeout(300);
    check('degraded: choosing an allergen starts the hold and pauses comparing', (await cards(page)) === 0 && await page.locator('#product-grid .hold-message').isVisible() && await page.locator('#compare-tray').isVisible() && await page.locator('#open-comparison').isDisabled(), await text(page, '#result-count'));
    await page.click('#load-notice [data-retry-load]'); await page.waitForTimeout(1500);
    check('degraded: a retry that still fails says so, keeps the hold, and puts focus back on the retry button', /仍然有資料未能載入/.test(await text(page, '#toast')) && (await cards(page)) === 0 && (await focusId(page)) === 'retry in notice' && await page.locator('#load-notice [data-retry-load]').isEnabled(), `${await focusId(page)} | ${await text(page, '#toast')}`);
    await page.uncheck('input[name="allergen"][value="crustaceans"]'); await page.waitForTimeout(300);
    check('degraded: removing the allergen lists the foods again (comparing stays paused)', (await cards(page)) === browsing && await page.locator('#open-comparison').isDisabled(), `${await cards(page)} cards`);
    await ctx.close();
  }

  // F3. A label file is missing: figures could differ from the reviewed labels, so no food is listed at all.
  {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    await failAlways(page, '**/hk-reviewed-labels.json*');
    await open(page);
    const notice = await text(page, '#load-notice');
    const held = { count: await text(page, '#result-count'), cards: await cards(page), message: await text(page, '#product-grid .hold-message') };
    check('label hold: with a label file missing no food is listed, even with no allergen chosen', /標籤及過敏資料/.test(notice) && /暫時唔顯示食品/.test(notice) && /標籤資料未載入齊/.test(held.count) && held.cards === 0 && /標籤資料未載入齊，所以暫時唔顯示食品/.test(held.message) && /請直接睇包裝上嘅標籤/.test(held.message), `${held.count} | ${notice.slice(0, 60)}`);
    await axe(page, 'phone label hold');
    await page.screenshot({ path: path.join(SHOTS, 'phone-label-hold.png') });
    await ctx.close();
  }

  // F3b. The council's case: two soy sauces whose sodium figures change when the reviewed label file is missing.
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage();
    await failOnce(page, '**/hk-reviewed-labels.json*');
    await open(page, '?sort=sodium-asc&compare=P000002473,P000000663');
    check('label hold: the comparison cannot be opened on incomplete label data', (await cards(page)) === 0 && (await text(page, '#compare-count')) === '2' && await page.locator('#open-comparison').isDisabled(), await text(page, '#result-count'));
    await page.click('#load-notice [data-retry-load]'); await page.waitForTimeout(2500);
    await page.click('#open-comparison'); await page.waitForTimeout(400);
    const sodium = await page.$$eval('#comparison-rows tr', trs => trs.filter(tr => tr.querySelector('th')?.innerText.startsWith('鈉')).map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g, ' ').trim()))[0]);
    check('label hold: after "try again" the comparison shows the reviewed figures (3,920 mg lowest, 6,540 mg)', sodium?.length === 2 && /^3,920 mg/.test(sodium[0]) && /最低/.test(sodium[0]) && /^6,540 mg/.test(sodium[1]) && !/最低/.test(sodium[1]), JSON.stringify(sodium));
    await ctx.close();
  }

  // F4. Data arrives while a dialog is open: the dialog shows the new data and focus stays inside it.
  {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    let n = 0; await page.route('**/off-nutrition-library.json*', async r => { if (n++ === 0) return r.fulfill({ status: 503, body: 'x' }); await new Promise(f => setTimeout(f, 2000)); return r.continue(); });
    await open(page);
    await page.fill('#food-search', '出前一丁碗麵'); await page.press('#food-search', 'Enter'); await page.waitForTimeout(500);
    await page.click('#load-notice [data-retry-load]');
    await page.click('[data-detail="P000000304"]'); await page.waitForTimeout(300);
    const warnedBefore = /部分資料未載入/.test(await text(page, '#detail-content [data-allergen-evidence]'));
    await page.waitForTimeout(3200);
    const state = { open: await page.locator('#detail-dialog').evaluate(d => d.open), warned: /部分資料未載入/.test(await text(page, '#detail-content [data-allergen-evidence]')), focusInside: await page.evaluate(() => document.getElementById('detail-dialog').contains(document.activeElement)), toast: await text(page, '#toast'), search: await page.inputValue('#food-search') };
    check('retry while details are open: the dialog stays open, shows the complete data, and keeps focus inside', warnedBefore && state.open && !state.warned && state.focusInside && /資料已經載入齊，你揀嘅條件保持不變/.test(state.toast) && state.search === '出前一丁碗麵', JSON.stringify(state));
    await ctx.close();
  }

  // F5. Allergens ticked while the data is still loading are never wiped by a link.
  {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    await page.route('**/data/products.json*', async r => { await new Promise(f => setTimeout(f, 2500)); await r.continue(); });
    page.goto(BASE + '?avoid=milk&q=' + encodeURIComponent('餅乾'), { waitUntil: 'commit' }).catch(() => {});
    await page.waitForSelector('input[name="allergen"][value="peanuts"]', { state: 'attached' });
    await page.evaluate(() => { document.getElementById('filter-details').open = true; });
    await page.check('input[name="allergen"][value="peanuts"]');
    const stillLoading = (await page.getAttribute('#product-grid', 'aria-busy')) === 'true';
    await ready(page); await page.waitForTimeout(300);
    const ticked = await page.$$eval('input[name="allergen"]:checked', els => els.map(e => e.value).sort());
    check('early choice: an allergen ticked during loading is kept together with the link\'s allergen', stillLoading && JSON.stringify(ticked) === JSON.stringify(['milk', 'peanuts']) && /avoid=peanuts,milk/.test(decodeURIComponent(page.url())) && /避開花生/.test(await text(page, '#active-filters')) && /避開奶類/.test(await text(page, '#active-filters')), `${ticked.join('+')} | ${await text(page, '#result-count')}`);
    await ctx.close();
    const ctx2 = await phoneCtx(); const p2 = await ctx2.newPage();
    await p2.route('**/data/products.json*', async r => { await new Promise(f => setTimeout(f, 2500)); await r.continue(); });
    p2.goto(BASE, { waitUntil: 'commit' }).catch(() => {});
    await p2.waitForSelector('input[name="allergen"][value="crustaceans"]', { state: 'attached' });
    await p2.evaluate(() => { document.getElementById('filter-details').open = true; });
    await p2.check('input[name="allergen"][value="crustaceans"]');
    await p2.fill('#food-search', '即食麵'); await p2.waitForTimeout(300);
    await ready(p2); await p2.waitForTimeout(300);
    check('early choice: without a link, a search and an allergen entered during loading are both applied', (await p2.inputValue('#food-search')) === '即食麵' && await p2.locator('input[name="allergen"][value="crustaceans"]').isChecked() && /^14 項來源未列所選過敏原/.test(await text(p2, '#result-count')), await text(p2, '#result-count'));
    await ctx2.close();
  }

  // F6. Price catalogue fails: said plainly, and the hold applies there too.
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage();
    await failAlways(page, '**/pricewatch-foods.json*');
    await open(page);
    check('failure: missing price catalogue is stated plainly (not hidden)', /消委會價格目錄未能載入/.test(await text(page, '#load-notice')) && (await cards(page)) > 0, await text(page, '#result-count'));
    await axe(page, 'desktop load notice (prices missing)');
    await page.check('input[name="allergen"][value="milk"]'); await page.waitForTimeout(300);
    check('failure: with the price catalogue missing, an allergy filter is held back as well', (await cards(page)) === 0 && await page.locator('#product-grid .hold-message').isVisible());
    await axe(page, 'desktop allergy hold');
    await page.screenshot({ path: path.join(SHOTS, 'desktop-allergy-hold.png') });
    await ctx.close();
  }

  // F7. Core file fails once: error with retry; the sources button does not break; retry recovers.
  {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await failOnce(page, '**/data/products.json*');
    await page.goto(BASE, { waitUntil: 'networkidle' }); await ready(page);
    const fatal = await text(page, '#product-grid');
    check('failure: core file missing → clear error with a retry button', /暫時載入唔到食品資料/.test(fatal) && await page.locator('#product-grid [data-retry-load]').isVisible(), fatal.slice(0, 60));
    await axe(page, 'phone fatal load error');
    await page.click('#data-info-button'); await page.waitForTimeout(300);
    check('failure: "sources" before any data arrives explains itself instead of breaking', errors.length === 0 && /食品資料未載入/.test(await text(page, '#toast')) && !(await page.locator('#sources-dialog').evaluate(d => d.open)), errors.join(' | ') || await text(page, '#toast'));
    await page.click('#product-grid [data-retry-load]'); await page.waitForTimeout(2500);
    check('failure: retry after a core failure loads the full catalogue and moves focus to the result count', /1,788 項食品/.test(await text(page, '#result-count')) && (await focusId(page)) === 'result-count' && errors.length === 0, `${await text(page, '#result-count')} | focus ${await focusId(page)}`);
    await ctx.close();
  }

  // F8. A stalled file: slow-network hint, then the page still appears.
  {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    await page.route('**/off-nutrition-library.json*', async r => { await new Promise(f => setTimeout(f, 7500)); await r.continue(); });
    page.goto(BASE, { waitUntil: 'commit' }).catch(() => {});
    await page.waitForTimeout(6600);
    check('failure: a slow file shows a "still loading" hint after 6 seconds', /網絡較慢/.test(await text(page, '#result-count')), await text(page, '#result-count'));
    await ready(page);
    check('failure: the page appears once the slow file arrives', /1,788 項食品/.test(await text(page, '#result-count')) && await page.locator('#load-notice').isHidden());
    await ctx.close();
  }

  // F8b. A file that never answers is given up after about 10 seconds; the page then shows what it has, with a notice.
  {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    await page.route('**/off-nutrition-library.json*', () => { /* never answered */ });
    const t0 = Date.now();
    page.goto(BASE, { waitUntil: 'commit' }).catch(() => {});
    await ready(page);
    const waited = Date.now() - t0;
    check('failure: a file that never answers is given up after about 10 seconds', waited > 9000 && waited < 14000 && await page.locator('#load-notice').isVisible() && (await cards(page)) > 0, `${waited} ms`);
    await ctx.close();
  }

  // F9. A typing mistake in the assistant settings no longer stops the site.
  for (const [name, body] of [['a missing quote mark', "export const AI_ASSISTANT = Object.freeze({ url: 'https://maas.example/x, platform: 'EdUHK MaaS', linkExpires: '2026-12-31' });"], ['curly quotes', "export const AI_ASSISTANT = Object.freeze({ url: ‘https://maas.example/x’, platform: 'EdUHK MaaS', linkExpires: '2026-12-31' });"]]) {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const warnings = []; page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
    await page.route('**/ai-config.mjs*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body }));
    await open(page);
    await page.click('#assistant-toggle'); await page.waitForTimeout(200);
    check(`settings slip (${name}): the site still loads, the AI button stays hidden, and the console says why`, /1,788 項食品/.test(await text(page, '#result-count')) && await page.locator('#ai-assistant-link').isHidden() && await page.locator('#ai-assistant-pending').isVisible() && errors.length === 0 && warnings.some(w => /ai-config\.mjs could not be read/.test(w)), `${await text(page, '#result-count')}; errors ${errors.length}`);
    await ctx.close();
  }

  // F10. A program file is missing or damaged: a plain message and a reload button, not "loading" forever.
  for (const [name, setup] of [
    ['a program file is missing', page => page.route('**/data-loader.mjs*', r => r.fulfill({ status: 404, body: 'not found' }))],
    ['a program file is damaged', page => page.route('**/pack-values.mjs*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const broken = ;' }))],
  ]) {
    const ctx = await phoneCtx(); const page = await ctx.newPage();
    await setup(page);
    await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
    const state = { count: await text(page, '#result-count'), grid: await text(page, '#product-grid'), busy: await page.getAttribute('#product-grid', 'aria-busy'), reload: await page.locator('#reload-page').isVisible().catch(() => false) };
    check(`program cannot start (${name}): the page says so and offers a reload`, /網站程式未能啟動/.test(state.count) && /網站程式載入唔到/.test(state.grid) && state.busy === 'false' && state.reload, JSON.stringify(state).slice(0, 150));
    await axe(page, `phone program failed to start (${name})`);
    await ctx.close();
  }
}

async function assistantFlow(browser) {
  const cases = [
    { name: 'working link, Mode 2 tested', expires: '2099-12-31', tested: true, button: true, explain: true },
    { name: 'working link, Mode 2 not tested yet', expires: '2099-12-31', tested: false, button: true, explain: false },
    { name: 'expired link', expires: '2020-01-01', tested: true, button: false, explain: false },
    { name: 'no link yet', url: '', expires: '', tested: false, button: false, pending: true, explain: false },
  ];
  for (const item of cases) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await useAssistant(page, { url: item.url, expires: item.expires, tested: item.tested });
    await open(page, '?compare=P000000304,P000000298');
    await page.click('#assistant-toggle'); await page.waitForTimeout(200);
    const linkVisible = await page.locator('#ai-assistant-link').isVisible();
    const pending = await text(page, '#ai-assistant-pending');
    const expiryNote = await text(page, '#ai-assistant-expiry');
    if (item.button) check(`assistant (${item.name}): button shown with the expiry date`, linkVisible && /連結有效至 2099年12月31日/.test(expiryNote) && (await page.getAttribute('#ai-assistant-link', 'href')) === 'https://maas.example.org/agent/abc', expiryNote);
    else if (item.pending) check(`assistant (${item.name}): no button, and the page says the assistant is being set up`, !linkVisible && /AI 助手設定中/.test(pending), pending.slice(0, 60));
    else check(`assistant (${item.name}): button hidden and the page says the link expired`, !linkVisible && /已經喺 2020年1月1日 到期/.test(pending), pending.slice(0, 60));
    await axe(page, `phone assistant panel (${item.name})`);
    await page.click('#open-comparison'); await page.waitForTimeout(300);
    const offered = await page.locator('#explain-comparison').count() === 1;
    check(`assistant (${item.name}): "ask the AI to explain" is ${item.explain ? 'offered' : 'not offered'}`, offered === item.explain);
    if (item.explain) {
      await page.click('#explain-comparison'); await page.waitForTimeout(300);
      check(`assistant (${item.name}): the explain dialog opens with the AI link`, await page.locator('#ai-explain-link').isVisible() && (await page.inputValue('#ai-explain-text')).startsWith('【NutriCompare 比較資料】'));
    }
    await ctx.close();
  }
}

(async () => {
  // What the served settings file says right now (read over HTTP, so it is the copy the browser gets).
  const settingsSource = await (await fetch(new URL('app/ai-config.mjs', BASE))).text();
  const { AI_ASSISTANT } = await import('data:text/javascript,' + encodeURIComponent(settingsSource));
  const { assistantState } = await import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'app', 'assistant-state.mjs')).href);
  const status = assistantState(AI_ASSISTANT);
  shipped = { state: status.state, url: status.url, explain: status.state === 'ready' && AI_ASSISTANT.explainTested === true };
  console.log(`served assistant settings: ${shipped.state}${shipped.explain ? ', Mode 2 on' : ', Mode 2 off'}`);
  const browser = await chromium.launch();
  for (const [label, options] of [['phone', { ...devices['iPhone 13'] }], ['desktop', { viewport: { width: 1366, height: 900 } }]]) {
    try { await flow(browser, label, options); } catch (e) { check(`${label} flow crashed`, false, e.message.split('\n')[0]); }
  }
  try { await failureFlow(browser); } catch (e) { check('failure flow crashed', false, e.message.split('\n')[0]); }
  try { await assistantFlow(browser); } catch (e) { check('assistant flow crashed', false, e.message.split('\n')[0]); }
  await browser.close();
  console.log('\n==== axe (WCAG 2.1 A/AA)');
  for (const a of axeLog) console.log(`${a.violations.length ? 'FAIL' : 'ok  '}  ${a.label}${a.violations.length ? ': ' + a.violations.map(v => `${v.id} ×${v.n} ${v.targets.join(' ; ')}`).join(' | ') : ''}`);
  const failed = log.filter(l => !l.pass).length;
  console.log(`\n${log.length - failed} passed, ${failed} failed; axe screens ${axeLog.length}, with violations ${axeLog.filter(a => a.violations.length).length}`);
  fs.writeFileSync(path.join(SHOTS, 'v110-results.json'), JSON.stringify({ log, axeLog }, null, 1));
})();
