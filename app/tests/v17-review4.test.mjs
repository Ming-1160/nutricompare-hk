// Regression tests for the fourth independent review of v1.7: refusal wording, the negation safety net and speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from '../engine.mjs';
import { filtersFromParams } from '../url-state.mjs';

const sorted = list => [...list].sort();
const same = (text, ids) => assert.deepEqual(sorted(parseRequest(text).allergens), sorted(ids), text);

test('a second exclusion that starts with 唔可以 is kept', () => {
  same('唔食得花生同埋唔可以飲牛奶', ['peanuts', 'milk']);
  same('唔可以食花生同埋唔可以飲牛奶', ['peanuts', 'milk']);
  same('唔食得花生同埋唔可以飲豆漿', ['peanuts', 'soy']);
  assert.equal(parseRequest('唔食得花生同埋唔可以飲牛奶').allergyUnclear, false);
});

test('Chinese refusals before or after the food avoid it and never search it', () => {
  for (const text of ['唔想飲牛奶', '牛奶唔要', '我唔想食花生', '我唔要食花生', '花生唔要', '花生就唔好', '花生唔得', '唔可以有花生', '唔好買有花生嘅', '有花生嘅唔要', '含有花生嘅都唔要', '我好怕花生', '除咗花生之外，其他都得', '除咗花生，乜都食得', '我食開花生會痕，最好避開', '戒咗花生', '花生戒咗', '唔好俾花生我', '我唔會食花生', '花生對我嚟講好危險']) {
    const parsed = parseRequest(text);
    assert.equal(parsed.allergens.length, 1, text);
    assert.ok(!parsed.query, `${text} → ${parsed.query}`);
  }
  const juice = parseRequest('我唔想飲牛奶，想要果汁');
  assert.deepEqual(juice.allergens, ['milk']);
  assert.equal(juice.query, '果汁');
  assert.deepEqual(filtersFromParams(`?q=${encodeURIComponent('唔想飲牛奶')}&src=ai`, { storeIds: [], base: { allergens: [] } }).filters.allergens, ['milk']);
});

test('English refusals avoid the allergen', () => {
  for (const [text, ids] of [["I mustn't have milk", ['milk']], ['anything except milk is fine', ['milk']], ['keep away from peanuts', ['peanuts']], ["I'm not allowed to eat peanuts", ['peanuts']], ['stay away from dairy', ['milk']], ['steer clear of peanuts', ['peanuts']], ["shouldn't have dairy", ['milk']], ["won't eat eggs", ['eggs']], ['peanuts are off limits', ['peanuts']], ['I get a reaction from peanuts', ['peanuts']], ['nothing containing nuts', ['peanuts', 'tree-nuts']], ["can't tolerate lactose", ['milk']], ['zero peanuts please', ['peanuts']], ['I can eat anything except peanuts', ['peanuts']], ['I cannot consume peanuts', ['peanuts']], ['skip peanuts', ['peanuts']], ['not peanuts', ['peanuts']], ['peanut sensitivity', ['peanuts']]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(sorted(parsed.allergens), sorted(ids), text);
    assert.ok(!parsed.query || !/peanut|milk|dairy|egg|lactose|nut/i.test(parsed.query), `${text} → ${parsed.query}`);
  }
});

test('a refused chocolate is named back, not searched; an allowed exception is not added', () => {
  for (const [text, category] of [['唔想食朱古力', 'all'], ['朱古力就唔要', 'all'], ['我唔鍾意朱古力，想買餅乾', 'biscuits'], ['snacks, anything but chocolate', 'snacks'], ['biscuits but not chocolate ones', 'biscuits']]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [], text);
    assert.equal(parsed.query, '', text);
    assert.equal(parsed.category, category, text);
    assert.ok(parsed.avoidedFoods.some(food => /朱古力|chocolate/.test(food)), text);
  }
  const exception = parseRequest('allergic to peanuts but not tree nuts');
  assert.deepEqual(exception.allergens, ['peanuts']);
  assert.ok(exception.notices.some(notice => notice.includes('當作可以食')));
});

test('space-joined allergens stop before a product they describe', () => {
  for (const [text, ids, query] of [['no peanuts milk chocolate', ['peanuts'], '巧克力'], ['冇花生 牛奶朱古力', ['peanuts'], '巧克力'], ['唔要花生 牛奶糖', ['peanuts'], null], ['唔要花生 牛奶', ['peanuts', 'milk'], null], ['no nuts butter cookies', ['peanuts', 'tree-nuts'], null]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(sorted(parsed.allergens), sorted(ids), text);
    if (query !== null) assert.equal(parsed.query, query, text);
  }
});

test('molluscs are reported as unfilterable, never read as fish; 牛油果 is not butter', () => {
  for (const text of ['對魷魚過敏', '對鮑魚過敏', '唔食得墨魚', 'allergic to octopus']) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [], text);
    assert.deepEqual(parsed.unsupportedAllergens, ['軟體貝類'], text);
    assert.equal(parsed.allergyUnclear, false, text);
  }
  same('對魚同魷魚過敏', ['fish']);
  same('唔要牛油果', []);
  same('唔要牛油', ['milk']);
});

test('the negation safety net never hides a product the person asked for', () => {
  for (const [text, query] of [['唔該，我想要花生醬', '花生醬'], ['唔知有冇花生醬', '花生醬'], ['不如買花生', '花生'], ['唔要太甜嘅花生醬', '花生醬'], ['冇糖花生醬', '花生醬'], ['peanut butter, not too sweet', 'peanut butter'], ['唔要辣嘅花生', '花生'], ['冇問題，牛奶都得', '牛奶'], ['不錯嘅芝士', '芝士'], ['百佳沒有花生醬嗎', '花生醬'], ['鮮奶不耐放，想買盒裝牛奶', '牛奶'], ['no problem, milk is fine', '牛奶']]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [], text);
    assert.equal(parsed.query, query, text);
  }
  const guessed = parseRequest('花生對我嚟講好危險');
  assert.deepEqual(guessed.allergens, ['peanuts']);
  assert.ok(guessed.notices.some(notice => notice.includes('網站唔肯定你嘅意思')), 'a guessed exclusion is explained and can be removed');
});

test('long repeated allergen lists are parsed quickly', () => {
  for (const text of ['nuts and '.repeat(26), 'peanuts '.repeat(30), 'nuts '.repeat(48), 'no nuts and nuts and '.repeat(11), '花生同'.repeat(80), 'nut free '.repeat(26)]) {
    const started = performance.now();
    parseRequest(text);
    assert.ok(performance.now() - started < 250, `${text.slice(0, 20)}… took too long`);
  }
});
