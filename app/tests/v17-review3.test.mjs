// Regression tests for the third independent review of v1.7, plus a systematic allergen matrix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, readAllergenPhrase } from '../engine.mjs';
import { filtersFromParams } from '../url-state.mjs';

const base = () => ({ query: '', category: '', budget: null, store: '', allergens: [], origin: '', sort: 'relevance', dataScope: '', libraryScope: 'priced' });
const link = text => filtersFromParams(text, { storeIds: ['WELLCOME'], base: base() });
const sorted = list => [...list].sort();
const same = (text, ids) => assert.deepEqual(sorted(parseRequest(text).allergens), sorted(ids), text);

test('食唔得／飲唔得 work before or after the food', () => {
  for (const [text, ids] of [['我食唔得花生', ['peanuts']], ['食唔得花生同芝麻', ['peanuts', 'sesame']], ['我個仔食唔得蛋', ['eggs']], ['飲唔得牛奶', ['milk']], ['花生食唔得', ['peanuts']], ['花生，牛奶都唔食得', ['peanuts', 'milk']]]) {
    same(text, ids);
    assert.equal(parseRequest(text).query, '', text);
  }
  assert.deepEqual(link(`?q=${encodeURIComponent('飲唔得牛奶')}&src=ai`).filters.allergens, ['milk']);
});

test('free-from questions keep the exclusion; only "doesn\'t the shop have X?" asks for X', () => {
  for (const [text, ids] of [['有冇無花生餅乾？', ['peanuts']], ['有冇冇花生餅乾呀', ['peanuts']], ['有冇無奶朱古力?', ['milk']], ['有冇無蛋蛋糕？', ['eggs']], ['惠康有冇無麩質麵包？', ['gluten']], ['惠康冇花生餅乾咩', ['peanuts']]]) {
    same(text, ids);
    assert.ok(!/花生|麩質/.test(parseRequest(text).query), text);
  }
  assert.equal(parseRequest('有冇無奶朱古力?').query, '巧克力');
  for (const text of ['百佳沒有花生醬嗎', '惠康冇花生醬咩']) same(text, []);
});

test('comma lists that start with 對 keep the first allergen', () => {
  same('我對花生，芝麻過敏', ['peanuts', 'sesame']);
  same('對花生，牛奶過敏', ['peanuts', 'milk']);
  const chocolate = parseRequest('對花生，朱古力過敏');
  assert.deepEqual(chocolate.allergens, ['peanuts']);
  assert.ok(chocolate.unclearAllergyWords.includes('朱古力'));
  assert.equal(chocolate.query, '');
});

test('"that contains" and "derived from" phrasing still names the allergen', () => {
  for (const [text, ids] of [['I avoid foods that contain gluten', ['gluten']], ['no food that contains peanuts', ['peanuts']], ['please exclude anything that has milk', ['milk']], ['allergic to products derived from milk', ['milk']], ['allergic to anything that contains peanuts', ['peanuts']], ['allergic to things made from peanuts', ['peanuts']], ['唔食得含有花生嘅嘢', ['peanuts']]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, ids, text);
    assert.equal(parsed.query, '', text);
    assert.equal(parsed.allergyUnclear, false, text);
  }
});

test('items after "allergies:" are part of the list, even food words; a wanted product after a comma is not', () => {
  for (const [text, word] of [['allergies: peanuts, chocolate', 'chocolate'], ['過敏：花生，朱古力', '朱古力'], ['allergies: peanuts, coffee', 'coffee']]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, ['peanuts'], text);
    assert.equal(parsed.query, '', text);
    assert.ok(parsed.unclearAllergyWords.includes(word), text);
  }
  const wanted = parseRequest('allergic to peanuts, chocolate biscuits please');
  assert.equal(wanted.query, '巧克力');
  assert.equal(wanted.category, 'biscuits');
  const brand = parseRequest('唔食得花生，嘉頓');
  assert.ok(brand.unclearAllergyWords.includes('嘉頓'));
  assert.ok(brand.notices.some(notice => notice.includes('牌子')), 'a possible brand is named back with a hint, not searched');
});

test('coeliac wording, 敏感食物 lists and allergy-reaction words are read', () => {
  for (const text of ["I'm coeliac", 'celiac disease', '乳糜瀉']) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, ['gluten'], text);
    assert.equal(parsed.query, '', text);
  }
  same('敏感食物：花生', ['peanuts']);
  same('過敏原係花生同蝦', ['crustaceans', 'peanuts']);
  const reaction = parseRequest('對花生有嚴重過敏反應');
  assert.deepEqual(reaction.allergens, ['peanuts']);
  assert.equal(reaction.query, '');
  assert.equal(reaction.allergyUnclear, false);
});

test('exceptions and filler words are not flagged as allergies', () => {
  for (const [text, ids] of [['allergic to peanuts but not tree nuts', ['peanuts']], ['allergic to peanuts but tree nuts are fine', ['peanuts']], ['花生、芝麻、牛奶全部都唔食得', ['peanuts', 'milk', 'sesame']], ['唔食得花生同埋要低糖', ['peanuts']], ["I'm allergic to peanuts, and also to milk", ['peanuts', 'milk']], ['對有機牛奶過敏', ['milk']]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(sorted(parsed.allergens), sorted(ids), text);
    assert.equal(parsed.allergyUnclear, false, `${text}: ${parsed.unclearAllergyWords}`);
  }
  assert.equal(parseRequest('唔食得花生同埋要低糖').sort, 'sugar-asc');
});

test('budgets in words, no-added-sugar sorting, 奶油 and junk words', () => {
  for (const [text, budget] of [['budget twenty dollars', 20], ['under twenty dollars', 20], ['under twenty-five dollars', 25], ['under a hundred and fifty dollars', 150], ['biscuits under thirty', 30]]) {
    const parsed = parseRequest(text);
    assert.equal(parsed.budget, budget, text);
    assert.equal(parsed.query, '', text);
  }
  for (const text of ['無添加糖豆奶', '冇加糖豆奶', 'unsweetened soy milk']) assert.equal(parseRequest(text).sort, 'sugar-asc', text);
  same('唔要奶油嘅蛋糕', ['milk']);
  for (const text of ['help me find nut-free cookies', 'can you help me find gluten free bread', 'pls no peanuts', '邊款最抵？', '好味嘅餅乾', '我鍾意食花生']) {
    assert.ok(!/help|find|pls|最抵|好味|鍾意/.test(parseRequest(text).query), text);
  }
  assert.equal(parseRequest('邊款最抵？').sort, 'price-asc');
});

test('link avoid values read suffixed and joined words', () => {
  for (const [value, ids] of [['牛奶製品', ['milk']], ['花生油', ['peanuts']], ['堅果類', ['peanuts', 'tree-nuts']], ['花生和牛奶', ['peanuts', 'milk']], ['prawns', ['crustaceans']]]) {
    const state = link(`?avoid=${encodeURIComponent(value)}`);
    assert.deepEqual(state.filters.allergens, ids, value);
    assert.deepEqual(state.ignoredAllergens, [], value);
  }
  assert.deepEqual(readAllergenPhrase('__proto__').unknown, ['__proto__']);
  assert.deepEqual(readAllergenPhrase('oyster sauce').unsupported, ['軟體貝類']);
});

test('safety matrix: every allergen word in every exclusion template is set and never searched', () => {
  const zhWords = [['花生', ['peanuts']], ['花生醬', ['peanuts']], ['牛奶', ['milk']], ['芝士', ['milk']], ['雞蛋', ['eggs']], ['麩質', ['gluten']], ['大豆', ['soy']], ['芝麻', ['sesame']], ['蝦', ['crustaceans']], ['魚', ['fish']], ['海鮮', ['fish', 'crustaceans']], ['杏仁', ['tree-nuts']], ['堅果', ['peanuts', 'tree-nuts']], ['亞硫酸鹽', ['sulphites']]];
  const zhTemplates = ['我對X過敏', 'X過敏', '我有X過敏', '對X敏感', '唔食得X', '食唔得X', 'X食唔得', 'X都唔食得', '唔可以食X', '我唔食X', '避免X', '不含X', '唔含X', '唔要X', '冇X嘅', '無X', '過敏原：X', '我對X過敏，想買餅乾', '想買餅乾，對X過敏', '唔含X嘅餅乾', '有冇無X餅乾？', '我對X嚴重過敏'];
  const enWords = [['peanuts', ['peanuts']], ['milk', ['milk']], ['dairy', ['milk']], ['eggs', ['eggs']], ['gluten', ['gluten']], ['wheat', ['gluten']], ['soy', ['soy']], ['sesame', ['sesame']], ['prawns', ['crustaceans']], ['shellfish', ['crustaceans']], ['fish', ['fish']], ['tree nuts', ['tree-nuts']], ['almonds', ['tree-nuts']], ['sulfites', ['sulphites']]];
  const enTemplates = ['allergic to X', 'X allergy', 'I have a severe X allergy', 'allergies: X', 'no X', 'without X', 'X-free', 'free from X', 'exclude X', 'avoid X', "I can't eat X", "I don't eat X", 'must not contain X', 'not containing X', 'anaphylactic to X', 'biscuits without X', 'I avoid foods that contain X', 'my son is allergic to X'];
  const failures = [];
  const check = (text, ids, word) => {
    const parsed = parseRequest(text);
    const missing = ids.filter(id => !parsed.allergens.includes(id));
    const searched = parsed.query && (parsed.query.includes(word.replace(/醬$/, '')) || word.includes(parsed.query));
    if (missing.length || searched) failures.push(`${text} → ${JSON.stringify(parsed.allergens)} q=${parsed.query}`);
  };
  for (const template of zhTemplates) for (const [word, ids] of zhWords) check(template.replaceAll('X', word), ids, word);
  for (const template of enTemplates) for (const [word, ids] of enWords) check(template.replaceAll('X', word), ids, word);
  for (const sep of ['同', '、', '和', '，', ' ']) for (const template of ['我對X過敏', '唔食得X', 'X都唔食得', '唔要X', '過敏原：X']) check(template.replace('X', `花生${sep}牛奶`), ['peanuts', 'milk'], '牛奶');
  for (const sep of [' and ', ', ', ' or ', '/']) for (const template of ['allergic to X', 'X allergies', 'no X', 'without X', 'allergies: X', "I can't eat X"]) check(template.replace('X', `peanuts${sep}milk`), ['peanuts', 'milk'], 'milk');
  assert.deepEqual(failures, []);
});
