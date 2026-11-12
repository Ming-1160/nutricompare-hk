import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPLAIN_HEADER, buildExplainText, plainNumber } from '../ai-explain.mjs?v=110';
import { numbersIn, unsupportedNumbers } from '../../tools/check-ai-numbers.mjs';

const comparison = {
  basisLabel: '每 100 g／ml',
  priceNote: '所有商戶最低整包價；價格快照 2026年10月21日；未計優惠',
  products: [
    { name: '日清 · 出前一丁碗麵 - 麻油味 99克', sourceLabel: '香港標籤已讀', portion: '100 g',
      nutrients: [{ label: '能量', value: 425.3, unit: 'kcal' }, { label: '糖', value: 4.6, unit: 'g' }, { label: '鈉', value: 2091.9, unit: 'mg' }, { label: '反式脂肪', value: null, unit: 'g' }],
      price: { whole: 10, store: '惠康', per100: 10.101, per100Unit: 'g' }, allergy: '含有：含麩質穀物、大豆' },
    { name: '公仔 · 碗麵 - 日式豬骨濃湯味 106克', sourceLabel: '香港標籤已讀', portion: '100 g',
      nutrients: [{ label: '能量', value: 436.8, unit: 'kcal' }, { label: '糖', value: 6.4, unit: 'g' }, { label: '鈉', value: 1601.9, unit: 'mg' }, { label: '反式脂肪', value: 0, unit: 'g' }],
      price: { whole: null, store: '', per100: null, per100Unit: '' }, allergy: '過敏資料未齊，未能確認' },
  ],
  gaps: [{ label: '能量', difference: 11.5, unit: 'kcal' }, { label: '糖', difference: 1.8, unit: 'g' }, { label: '鈉', difference: 490, unit: 'mg' }],
  notComparable: [{ label: '碳水化合物', reason: '各款碳水化合物定義唔同或者未寫明' }, { label: '反式脂肪', reason: '有數字未知' }, { label: '整包價', reason: '有價錢未知' }, { label: '每 100 g／ml 價', reason: '有價錢未知' }],
};
const text = buildExplainText(comparison);

test('the block starts with the fixed header and carries its own limits', () => {
  assert.ok(text.startsWith(`${EXPLAIN_HEADER}\n`));
  assert.match(text, /請只用下面嘅數字/);
  assert.match(text, /唔好評價邊款好啲，亦唔好講啱唔啱食/);
  assert.doesNotMatch(text, /較健康|適合糖尿病/, 'the block itself never uses verdict wording');
  assert.match(text, /比較基準：每 100 g／ml/);
  assert.match(text, /食品 1：日清 · 出前一丁碗麵 - 麻油味 99克/);
  assert.match(text, /食品 2：公仔 · 碗麵 - 日式豬骨濃湯味 106克/);
});

test('figures are written plainly, and unknown is never written as zero', () => {
  assert.match(text, /鈉：2091\.9 mg/, 'no thousands separator');
  assert.match(text, /反式脂肪：未知/);
  assert.match(text, /反式脂肪：0 g/, 'a real zero stays zero');
  assert.match(text, /整包價：HK\$10（惠康）/);
  assert.match(text, /每 100 g 價：HK\$10\.1\n/);
  assert.match(text, /整包價：未知\n每 100 g／ml 價：未知/);
  assert.match(text, /網站已計嘅高低相差：能量 11\.5 kcal；糖 1\.8 g；鈉 490 mg\n/);
  // A price gap keeps two decimals.
  assert.match(buildExplainText({ ...comparison, gaps: [{ label: '每 100 g／ml 價', difference: 1.54, unit: '港元', decimals: 2 }] }), /網站已計嘅高低相差：每 100 g／ml 價 1\.54 港元\n/);
  assert.equal(plainNumber(null), null);
  assert.equal(plainNumber(1601.94), '1601.9');
  assert.equal(plainNumber(8.5, 2), '8.5');
  // Only a real number is a figure: an empty box, a blank or a switch is unknown, never 0.
  for (const value of ['', '   ', undefined, NaN, Infinity, true, false, [], {}, 'abc']) assert.equal(plainNumber(value), null, String(value));
  assert.equal(plainNumber(0), '0');
  assert.equal(plainNumber('20'), '20');
  const empty = buildExplainText({ products: [{ name: 'X', nutrients: [], price: {} }] });
  assert.match(empty, /比較基準：未知/);
  assert.match(empty, /過敏聲明：未知/);
});

test('the block tells the AI which rows the site itself does not rank', () => {
  assert.match(text, /列喺「唔可以直接比高低」嘅項目，只可以逐款讀出數字，唔好講邊款高、邊款低/);
  // Rows with the same reason are written together.
  assert.match(text, /\n唔可以直接比高低：碳水化合物（各款碳水化合物定義唔同或者未寫明）；反式脂肪（有數字未知）；整包價、每 100 g／ml 價（有價錢未知）$/);
  // No gap worked out by the site is said in so many words, so the AI has nothing to fill in.
  const noGaps = buildExplainText({ ...comparison, gaps: [], notComparable: [{ label: '全部營養項目', reason: '各款每包份量唔同' }] });
  assert.match(noGaps, /\n網站已計嘅高低相差：冇\n唔可以直接比高低：全部營養項目（各款每包份量唔同）$/);
  // Everything comparable: the line is simply left out.
  assert.doesNotMatch(buildExplainText({ ...comparison, notComparable: [] }), /唔可以直接比高低：/);
});

test('the checker passes a reply that only repeats numbers from the block', () => {
  const reply = '1. 食品 1 每 100 g 有 2,091.9 mg 鈉，食品 2 有 1601.9 mg，相差 490 mg。\n2. 糖方面係 4.6 g 對 6.4 g，相差 1.8 g。\n反式脂肪：食品 1 係未知。買之前請核對包裝。';
  assert.deepEqual(unsupportedNumbers(text, reply), []);
});

test('the checker lists any number the block does not contain', () => {
  const reply = '食品 2 嘅鈉係 1601.9 mg，仲有 12g 纖維，比食品 1 低大約 23%。每日建議唔好超過 2000 mg。食品 1 能量約 425 kcal。';
  const extra = unsupportedNumbers(text, reply);
  assert.deepEqual(extra.map(item => item.raw), ['12', '23', '2000', '425']);
  assert.match(extra[0].context, /12g 纖維/);
});

test('known limit: a real number given to the wrong food is not caught, so a person still has to read the reply', () => {
  const swapped = '食品 1 嘅鈉係 1601.9 mg，食品 2 嘅鈉係 2091.9 mg。';
  assert.deepEqual(unsupportedNumbers(text, swapped), [], 'both numbers are in the data, only attached to the wrong food');
  assert.deepEqual(unsupportedNumbers(text, '食品 1 嘅鈉大約四百毫克。'), [], 'numbers written in Chinese characters are not read');
});

test('number reading handles separators, full-width digits and list numbering', () => {
  assert.deepEqual(numbersIn('２，０９１．９ mg 同 1,390 mg').map(item => item.value), [2091.9, 1390]);
  assert.deepEqual(numbersIn('10.0 同 10').map(item => item.value), [10, 10]);
  const listed = unsupportedNumbers('數字：5', '1. 第一點\n2) 第二點\n3、第三點\n結論係 5 同 7');
  assert.deepEqual(listed.map(item => item.raw), ['7'], 'list numbering is not a figure');
  assert.match(listed[0].context, /同 7$/);
  // A figure at the start of a line is still a figure.
  assert.deepEqual(unsupportedNumbers('數字：5', '10.1 元\n42 g').map(item => item.raw), ['10.1', '42']);
});

test('the command-line tool reports the same result and sets the exit code', () => {
  const folder = mkdtempSync(join(tmpdir(), 'nc-ai-'));
  const tool = fileURLToPath(new URL('../../tools/check-ai-numbers.mjs', import.meta.url));
  writeFileSync(join(folder, 'data.txt'), text);
  writeFileSync(join(folder, 'good.txt'), '食品 1 鈉 2091.9 mg，食品 2 鈉 1601.9 mg。');
  writeFileSync(join(folder, 'bad.txt'), '食品 1 鈉 2091.9 mg，另外有 12g 纖維。');
  const good = execFileSync(process.execPath, [tool, join(folder, 'data.txt'), join(folder, 'good.txt')], { encoding: 'utf8' });
  assert.match(good, /冇發現比較資料以外嘅數字/);
  assert.match(good, /仍然要逐句對一次比較表/, 'a clean result still tells the tester to read the reply');
  const bad = spawnSync(process.execPath, [tool, join(folder, 'data.txt'), join(folder, 'bad.txt')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /有 1 個數字唔喺比較資料入面/);
  assert.match(bad.stdout, /12 /);
  assert.equal(spawnSync(process.execPath, [tool], { encoding: 'utf8' }).status, 2);
});
