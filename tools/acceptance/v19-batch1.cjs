// Browser checks for NutriCompare v1.9 batch 1 (A1–A5, B1–B4) plus axe and network checks. See README.md in this folder.
// Usage: node v19-batch1.cjs [base url] [screenshot folder]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.argv[2] || 'http://127.0.0.1:8800/';
const SHOTS = process.argv[3] || path.join(require('os').tmpdir(), 'nutricompare-v19-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const host = new URL(BASE).host;
const log = [];
const axeLog = [];
const check = (name, pass, detail = '') => { log.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const note = (name, detail) => { log.push({ name, pass: null, detail }); console.log(`INFO  ${name} — ${detail}`); };

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#product-grid')?.getAttribute('aria-busy') === 'false', null, { timeout: 30000 });
  await page.waitForTimeout(250);
}
async function open(page, qs = '') { await page.goto(BASE + qs, { waitUntil: 'networkidle' }); await ready(page); }
const ids = page => page.$$eval('#product-grid [data-detail]', els => els.map(e => e.dataset.detail));
const count = async page => (await page.locator('#result-count').innerText()).trim();
async function axe(page, label) {
  await page.addScriptTag({ content: axeSrc });
  const r = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  axeLog.push({ label, violations: r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })) });
}
async function search(page, text) {
  await page.fill('#food-search', text);
  await page.press('#food-search', 'Enter');
  await page.waitForTimeout(500); await ready(page);
}
async function quick(page, text) {
  if (!(await page.locator('#request-input').isVisible())) await page.click('#assistant-toggle');
  await page.fill('#request-input', text);
  await page.press('#request-input', 'Enter');
  await page.waitForTimeout(500); await ready(page);
}
async function textSize(page) { await page.click('#text-size-toggle'); await page.waitForTimeout(200); }

async function phoneFlow(browser) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page);
  const firstLoad = requests.length;
  await page.screenshot({ path: path.join(SHOTS, 'phone-home.png') });

  // A1
  const vh = page.viewportSize().height;
  const card = page.locator('#product-grid .product-card').first();
  const strip = card.locator('.nutrient-strip');
  const stripVisible = await strip.isVisible();
  const stripText = stripVisible ? (await strip.innerText()).replace(/\s+/g, ' ') : '';
  check('A1 phone card shows a nutrient line', stripVisible && /碳水/.test(stripText) && /糖/.test(stripText) && /鈉/.test(stripText), stripText.slice(0, 80));
  const heading = (await card.locator('.nutrient-heading').innerText().catch(() => '')).trim();
  note('A1 basis label on first card', heading || '(none)');
  const cardBox = await card.boundingBox();
  const btnBoxes = await card.locator('.card-actions button').evaluateAll(els => els.map(e => e.getBoundingClientRect().bottom));
  check('A1 first card and its buttons fit the first screen (390×664)', cardBox.y + cardBox.height <= vh && Math.max(...btnBoxes) <= vh, `card bottom ${Math.round(cardBox.y + cardBox.height)}px, buttons ${btnBoxes.map(Math.round).join('/')}px, viewport ${vh}px`);
  await page.selectOption('#sort', 'sodium-asc'); await page.waitForTimeout(400); await ready(page);
  const sodiumBold = await page.$$eval('#product-grid .product-card', cards => cards.map(c => !!c.querySelector('strong.card-nutrient[data-nutrient="sodiumMg"]')));
  check('A1 sodium sort: every card shows sodium in bold', sodiumBold.length > 0 && sodiumBold.every(Boolean), `${sodiumBold.filter(Boolean).length}/${sodiumBold.length} cards`);
  await page.screenshot({ path: path.join(SHOTS, 'phone-sodium-sort.png') });
  const unknownShown = await page.$$eval('#product-grid .card-nutrient', els => els.some(e => e.textContent.includes('—')));
  note('A1 unknown shown as —', unknownShown ? 'yes, at least one card shows —' : 'no — on this page');
  await axe(page, 'phone home (sodium sort)');
  await textSize(page); await axe(page, 'phone home A+'); await page.screenshot({ path: path.join(SHOTS, 'phone-home-large.png') });
  const largeBox = await card.boundingBox();
  note('A1 A+ first card bottom', `${Math.round(largeBox.y + largeBox.height)}px`);
  await textSize(page);

  // A3 AI links
  for (const [q, must, brand, first] of [
    ['Vita lemon tea', ['P000000125', 'P000005059'], /維他/, null],
    ['Lee Kum Kee oyster sauce', ['P000000071'], /李錦記/, 'P000000071'],
    ['Nissin cup noodles', [], /日清/, null],
    ['Nestle coffee', [], /雀巢/, null],
  ]) {
    await open(page, `?q=${encodeURIComponent(q)}&src=ai`);
    const got = await ids(page);
    const names = await page.$$eval('#product-grid .product-card .product-identity', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    const allBrand = names.length > 0 && names.every(n => brand.test(n));
    check(`A3 AI link q=${q}`, got.length > 0 && must.every(id => got.includes(id)) && allBrand && (!first || got[0] === first),
      `${got.length} results, first ${got[0]}, all ${brand.source}: ${allBrand}`);
  }
  for (const [q, expect] of [['維他 檸檬茶', /維他/], ['李錦記 蠔油', /李錦記/], ['嘉頓 梳打餅', /嘉頓/]]) {
    await open(page); await quick(page, q);
    const box = await page.inputValue('#food-search');
    const n = (await ids(page)).length;
    check(`A3 quick request 「${q}」 keeps the brand`, expect.test(box) && n > 0, `search box "${box}", ${n} results`);
  }

  // A5
  await open(page); await search(page, '奶油曲奇');
  let got = await ids(page);
  check('A5 奶油曲奇 → butter cookies (Kjeldsens + Walkers), no sandwich biscuits', got.includes('P000000967') && got.includes('P000003211') && !got.includes('P000001318'), `${got.length} results: ${got.slice(0, 6).join(' ')}`);
  await open(page); await quick(page, '低GI 麵包');
  const gi = await page.locator('#search-feedback').innerText();
  const giCount = await count(page);
  check('A5 quick 低GI 麵包 → bread results + no-GI notice', /96/.test(giCount) && /GI/.test(gi), `${giCount} | ${gi.replace(/\s+/g, ' ').slice(0, 90)}`);
  await open(page); await search(page, '蘇打餅');
  got = await ids(page);
  const almond = got.indexOf('P000003660');
  check('A5 蘇打餅: named 梳打/克力架 before category-only matches', ['P000000366', 'P000001187', 'P000000651'].every(id => got.includes(id) && (almond < 0 || got.indexOf(id) < almond)), `first: ${got.slice(0, 4).join(' ')}; almond crisp at #${almond + 1}`);
  for (const q of ['夾心麵包', '忌廉蛋糕']) {
    await open(page); await quick(page, q);
    const cat = await page.evaluate(() => [...document.querySelectorAll('#active-filters *')].map(e => e.textContent).join(' '));
    const n = (await ids(page)).length;
    check(`A5 quick 「${q}」 keeps the bakery category`, /麵包|蛋糕|bakery/.test(cat) && !/餅乾/.test(cat) && n > 0, `${n} results; filters: ${cat.replace(/\s+/g, ' ').slice(0, 80)}`);
  }
  await open(page); await quick(page, '想搵即食麵，20蚊以下，避開花生，少鈉');
  const cardText = await page.locator('#product-grid .product-card').first().innerText();
  check('A5 card allergy wording 「來源未列所選過敏原 · 請核對包裝」', cardText.includes('來源未列所選過敏原 · 請核對包裝'), '');
  const allergyNotice = await page.locator('#allergy-notice').innerText().catch(() => '');
  check('A5 allergy notice says 「唔等於安全保證」', allergyNotice.includes('唔等於安全保證'), allergyNotice.replace(/\s+/g, ' ').slice(0, 100));

  // B1
  await open(page); await quick(page, '我對花生過敏，想食夾心餅，20蚊以下');
  const n0 = (await ids(page)).length;
  const toggle = page.locator('#exclusion-toggle');
  const tText = (await toggle.innerText()).trim();
  await toggle.click(); await page.waitForTimeout(300);
  const panel = page.locator('#exclusion-panel');
  const pText = (await panel.innerText()).replace(/\s+/g, ' ');
  const groups = await panel.locator('li').count();
  const compareInPanel = await panel.locator('[data-compare], .compare-add').count() + (pText.includes('加入比較') ? 1 : 0);
  const cardStyle = await panel.locator('.product-card').count();
  const order = await page.evaluate(() => {
    const p = document.querySelector('#exclusion-panel'), g = document.querySelector('#product-grid'), e = document.querySelector('#empty-state');
    return { afterGrid: !!(g.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING), afterEmpty: !!(e.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING), emptyShown: !e.hidden };
  });
  check('B1 flagship: 0 results, 「已排除 14 款」', n0 === 0 && /14/.test(tText), `${n0} results; toggle "${tText}"`);
  check('B1 panel has 4 listed + 10 insufficient', /4/.test(pText) && /10/.test(pText) && groups === 14, `${groups} items; ${pText.slice(0, 120)}`);
  check('B1 panel has no compare buttons and no result-card styling', compareInPanel === 0 && cardStyle === 0, `compare controls ${compareInPanel}, cards ${cardStyle}`);
  check('B1 panel comes after the results / empty state', order.afterGrid && order.afterEmpty, JSON.stringify(order));
  check('B1 insufficient wording', pText.includes('冇完整成分或警告紀錄，未能確認，唔代表安全'), '');
  await page.screenshot({ path: path.join(SHOTS, 'phone-exclusions.png'), fullPage: true });
  await axe(page, 'phone exclusion panel');

  // A2 + B2 + share via a compare link
  await open(page, '?compare=P000001128,P000000015');
  const tray = (await page.locator('#compare-count').innerText()).trim();
  await page.click('#open-comparison'); await page.waitForTimeout(400);
  await page.selectOption('#comparison-basis', 'package'); await page.waitForTimeout(400);
  const table = (await page.locator('#compare-content').innerText()).replace(/\s+/g, ' ');
  check('A2 compare link restores 2 items', /2/.test(tray), `tray "${tray}"`);
  check('A2 per-inner-pack header 「每小包 91g（5 包裝）」 and 53.8g carbs', table.includes('每小包 91g（5 包裝）') && (table.match(/53\.8/g) || []).length >= 2, table.slice(0, 160));
  await page.screenshot({ path: path.join(SHOTS, 'phone-compare-pack.png'), fullPage: true });
  await axe(page, 'phone compare dialog (per pack)');
  await ctx.close();

  const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
  const p2 = await ctx2.newPage();
  const req2 = []; p2.on('request', r => req2.push(r.url()));
  await open(p2, '?compare=P000000939,P000000014');
  await p2.click('#open-comparison'); await p2.waitForTimeout(400);
  const badges = await p2.$$eval('#compare-content .comparison-source-badge', els => els.map(e => e.textContent.trim()));
  check('A4 compare header tags differ (營多 vs 出前一丁)', badges.length === 2 && badges[0] !== badges[1], badges.join(' | '));
  // B2 via keyboard
  const carbBtn = p2.locator('#compare-content [data-nutrient-evidence="carbohydrates"][data-evidence-product="P000000014"]').first();
  await carbBtn.focus(); await p2.keyboard.press('Enter'); await p2.waitForTimeout(400);
  const evOpen = await p2.locator('#nutrient-evidence-dialog').evaluate(d => d.open);
  const ev = evOpen ? (await p2.locator('#nutrient-evidence-content').innerText()).replace(/\s+/g, ' ') : '';
  check('B2 P000000014 carbs evidence (keyboard): official Nissin source, 90g 52.7g → 58.6g/100g', evOpen && /日清/.test(ev) && /90/.test(ev) && /52\.7/.test(ev) && /58\.6/.test(ev), ev.slice(0, 220));
  await p2.screenshot({ path: path.join(SHOTS, 'phone-evidence.png') });
  await axe(p2, 'phone nutrient evidence dialog');
  await p2.keyboard.press('Escape'); await p2.waitForTimeout(200);
  const dashBtn = p2.locator('#compare-content .nutrient-evidence-button', { hasText: '—' }).first();
  if (await dashBtn.count()) {
    await dashBtn.click(); await p2.waitForTimeout(300);
    const t = (await p2.locator('#nutrient-evidence-content').innerText()).replace(/\s+/g, ' ');
    check('B2 「—」 is clickable and explains 「冇來源數值」', /冇來源數值/.test(t), t.slice(0, 140));
    await p2.keyboard.press('Escape');
  } else note('B2 「—」', 'no unknown cell in this comparison');
  await ctx2.close();

  // B3 detail swaps
  const ctx3 = await browser.newContext({ ...devices['iPhone 13'] });
  const p3 = await ctx3.newPage();
  await open(p3); await search(p3, '出前一丁碗麵');
  await p3.click('[data-detail="P000000304"]'); await p3.waitForTimeout(500);
  const alt = (await p3.locator('#detail-content .alternatives').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('B3 P000000304 suggests 公仔碗麵日式豬骨 at 惠康 $10 → $8.5 with 鈉較低 2,091.9 → 1,601.9', /公仔 · 碗麵 - 日式豬骨濃湯味/.test(alt) && /惠康 · 原款 HK\$10(?:\.0)?，呢款 HK\$8\.5/.test(alt) && /鈉較低 · 每100g由 2,091\.9 mg 至 1,601\.9 mg/.test(alt), alt.slice(0, 300));
  check('B3 wording never says 較健康', !/較健康|更健康/.test(alt), '');
  await p3.screenshot({ path: path.join(SHOTS, 'phone-detail-swaps.png'), fullPage: false });
  await p3.locator('#detail-content .alternatives').scrollIntoViewIfNeeded().catch(() => {});
  await p3.screenshot({ path: path.join(SHOTS, 'phone-detail-swaps-2.png') });
  await axe(p3, 'phone detail with swaps');
  await ctx3.close();

  // B4 restore + notes + QR
  const ctx4 = await browser.newContext({ ...devices['iPhone 13'] });
  const p4 = await ctx4.newPage();
  const req4 = []; p4.on('request', r => req4.push(r.url()));
  await open(p4, '?compare=P000000304,P000000298,P000000014,BAD123,P000000304,P000000015');
  const banner = (await p4.locator('#link-banner').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const tray4 = (await p4.locator('#compare-count').innerText()).trim();
  check('B4 link keeps max 3 catalogue IDs and reports skipped ones', /3/.test(tray4) && /略過/.test(banner), `tray "${tray4}" | ${banner.slice(0, 160)}`);
  await open(p4, '?avoid=peanuts&compare=P000000037,P000000014');
  const banner2 = (await p4.locator('#link-banner').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('B4 link with 避開花生 drops the peanut product and says why', /「P000000037」未能符合過敏條件/.test(banner2), banner2.slice(0, 160));
  await open(p4, '?compare=P000000304,P000000298,P000000014');
  await p4.click('#open-comparison'); await p4.waitForTimeout(400);
  const wa = await p4.locator('#compare-content a', { hasText: 'WhatsApp' }).getAttribute('href');
  check('B4 WhatsApp link is https://wa.me/?text=<link> (no phone number)', /^https:\/\/wa\.me\/\?text=/.test(wa) && decodeURIComponent(wa.split('text=')[1]).startsWith(BASE), wa.slice(0, 120));
  await p4.click('#show-comparison-qr'); await p4.waitForTimeout(500);
  const linkField = await p4.inputValue('#comparison-link-field');
  const qrEl = p4.locator('#comparison-qr-image svg');
  let decoded = null;
  if (await qrEl.count()) {
    const buf = await p4.locator('#comparison-qr-image').screenshot();
    const png = PNG.sync.read(buf);
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    decoded = code?.data ?? null;
  }
  check('B4 QR decodes to exactly the share link', decoded === linkField, `decoded ${decoded ? decoded.slice(0, 90) : 'nothing'} | field ${linkField.slice(0, 90)}`);
  await p4.screenshot({ path: path.join(SHOTS, 'phone-share-qr.png') });
  await axe(p4, 'phone share/QR dialog');
  if (decoded) {
    const p5 = await ctx4.newPage(); await open(p5, decoded.replace(BASE, ''));
    const tray5 = (await p5.locator('#compare-count').innerText()).trim();
    check('B4 opening the QR link restores the same 3 products', /3/.test(tray5), `tray "${tray5}"`);
    await p5.close();
  }
  const offHost = [...requests, ...req2, ...req4].filter(u => !u.startsWith('data:') && new URL(u).host !== host);
  check('Rule 6: every browser request goes to the site itself', offHost.length === 0, offHost.slice(0, 5).join(' '));
  note('Network: requests on first phone load', `${firstLoad}`);
  check('No cookies set', (await ctx4.cookies()).length === 0, `${(await ctx4.cookies()).length} cookies`);
  check('No page errors (phone)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx4.close();
}

async function desktopFlow(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page);
  await axe(page, 'desktop home');
  await textSize(page); await axe(page, 'desktop home A+'); await textSize(page);
  await quick(page, '我對花生過敏，想食夾心餅，20蚊以下');
  await page.click('#exclusion-toggle'); await page.waitForTimeout(300);
  await axe(page, 'desktop exclusion panel');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-exclusions.png'), fullPage: true });
  await open(page, '?compare=P000001128,P000000015,P000000939');
  await page.click('#open-comparison'); await page.waitForTimeout(400);
  await axe(page, 'desktop compare dialog');
  await page.selectOption('#comparison-basis', 'package'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-compare-pack.png') });
  await axe(page, 'desktop compare dialog per pack');
  await page.locator('#compare-content .nutrient-evidence-button').first().click(); await page.waitForTimeout(300);
  await axe(page, 'desktop evidence dialog');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.click('#show-comparison-qr'); await page.waitForTimeout(400);
  await axe(page, 'desktop share/QR dialog');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await open(page); await search(page, '出前一丁碗麵');
  await page.click('[data-detail="P000000304"]'); await page.waitForTimeout(400);
  await axe(page, 'desktop detail with swaps');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await textSize(page);
  await page.click('[data-detail="P000000304"]'); await page.waitForTimeout(400);
  await axe(page, 'desktop detail A+'); await page.screenshot({ path: path.join(SHOTS, 'desktop-detail-large.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await textSize(page);
  await page.click('#sources-button'); await page.waitForTimeout(400);
  await axe(page, 'desktop sources dialog');
  check('No page errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
  // second entry point
  const p = await browser.newPage(); await p.goto(BASE + 'app/', { waitUntil: 'networkidle' }); await ready(p);
  check('app/ entry point loads', (await ids(p)).length > 0, (await count(p)));
  await p.close();
}

(async () => {
  const browser = await chromium.launch();
  if (!process.env.DESKTOP_ONLY) try { await phoneFlow(browser); } catch (e) { check('phone flow crashed', false, e.message.split('\n')[0]); }
  try { await desktopFlow(browser); } catch (e) { check('desktop flow crashed', false, e.message.split('\n')[0]); }
  await browser.close();
  console.log('\n==== axe (WCAG 2.1 A/AA)');
  for (const a of axeLog) console.log(`${a.violations.length ? 'FAIL' : 'ok  '}  ${a.label}${a.violations.length ? ': ' + a.violations.map(v => `${v.id} ×${v.n} ${v.targets.join(' ; ')}`).join(' | ') : ''}`);
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify({ log, axeLog }, null, 1));
})();
