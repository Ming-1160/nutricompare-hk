// Regression tests for the second independent review of v1.7 (each case was reproduced before the fix).
import test from 'node:test';
import assert from 'node:assert/strict';
import { allergenIdsForWord, parseRequest, unsupportedAllergenLabel } from '../engine.mjs';
import { filtersFromParams } from '../url-state.mjs';

const base = () => ({ query: '', category: '', budget: null, store: '', allergens: [], origin: '', sort: 'relevance', dataScope: '', libraryScope: 'priced' });
const STORES = ['PARKNSHOP', 'WELLCOME', 'JASONS', 'AEON'];
const link = text => filtersFromParams(text, { storeIds: STORES, base: base() });
const sorted = list => [...list].sort();

test('a second allergy word is never searched; an allergy the site cannot name is flagged', () => {
  for (const [text, word] of [['allergic to peanuts and chocolate', 'chocolate'], ['peanut allergy and chocolate allergy', 'chocolate'], ['allergic to peanuts and coffee', 'coffee'], ['對花生同朱古力過敏', '朱古力']]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, ['peanuts'], text);
    assert.equal(parsed.query, '', text);
    assert.equal(parsed.allergyUnclear, true, text);
    assert.ok(parsed.unclearAllergyWords.some(item => item.includes(word)), text);
  }
  assert.deepEqual(sorted(parseRequest('allergic to peanuts and cream').allergens), ['milk', 'peanuts']);
  assert.equal(parseRequest('allergic to peanuts and cream').query, '');
});

test('every allergen in a partly recognised list is kept, and the rest is flagged', () => {
  assert.deepEqual(parseRequest('我對花生同麻油過敏').allergens, ['peanuts', 'sesame']);
  assert.deepEqual(parseRequest('我對花生同忌廉過敏').allergens, ['peanuts', 'milk']);
  assert.deepEqual(parseRequest('allergic to peanuts and butter').allergens, ['peanuts', 'milk']);
  assert.deepEqual(parseRequest('對花生、雞蛋同麵粉過敏').allergens, ['gluten', 'eggs', 'peanuts']);
  for (const [text, word] of [['我對花生同士多啤梨過敏', '士多啤梨'], ['花生芒果過敏', '芒果'], ['allergies: peanuts, strawberries', 'strawberries']]) {
    const parsed = parseRequest(text);
    assert.ok(parsed.allergens.includes('peanuts'), text);
    assert.ok(parsed.unclearAllergyWords.some(item => item.includes(word)), text);
    assert.equal(parsed.query, '', text);
  }
});

test('clear English exclusions are never dropped', () => {
  for (const text of ["I don't eat peanuts", 'must not contain peanuts', 'anaphylactic to peanuts', 'allergens: peanuts', 'I have a severe peanut allergy']) {
    assert.deepEqual(parseRequest(text).allergens, ['peanuts'], text);
  }
});

test('a negated food is never the search; a food the site cannot exclude is named back', () => {
  for (const text of ['我唔飲牛奶', "I don't drink milk", 'does not contain milk', 'non-dairy milk']) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, ['milk'], text);
    assert.equal(parsed.query, '', text);
  }
  for (const [text, food, query] of [['唔飲咖啡，想飲茶', '咖啡', '茶'], ['唔要朱古力', '朱古力', ''], ['no chocolate biscuits', 'chocolate', ''], ['唔要奶茶', '奶茶', '']]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [], text);
    assert.equal(parsed.query, query, text);
    assert.ok(parsed.avoidedFoods.includes(food), text);
    assert.ok(parsed.notices.some(notice => notice.includes('唔可以排除指定食物')), text);
  }
  const chocolate = parseRequest('no milk chocolate');
  assert.deepEqual(chocolate.allergens, ['milk']);
  assert.equal(chocolate.query, '巧克力');
});

test('everyday diabetic or price wording is not an allergy, and the requested search stays', () => {
  for (const text of ['我唔食得糖，想飲豆奶', '我唔食得甜，想飲豆奶', "I can't have sugar, any soy milk?"]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [], text);
    assert.equal(parsed.query, 'soy', text);
    assert.equal(parsed.sort, 'sugar-asc', text);
    assert.equal(parsed.allergyUnclear, false, text);
  }
  const price = parseRequest('我對價錢好敏感…嘉頓餅');
  assert.equal(price.query, '嘉頓');
  assert.equal(price.category, 'biscuits');
  assert.equal(price.allergyUnclear, false);
  for (const text of ['我冇過敏，想搵低糖餅', 'I have no allergies, low sugar biscuits']) {
    const parsed = parseRequest(text);
    assert.equal(parsed.allergyUnclear, false, text);
    assert.equal(parsed.category, 'biscuits', text);
  }
  const spicy = parseRequest('我唔食得辣，想買蠔油');
  assert.equal(spicy.query, '蠔油');
  assert.deepEqual(spicy.unsupportedAllergens, []);
  assert.equal(spicy.allergyUnclear, false);
  assert.ok(spicy.otherRestrictions.includes('辣'));
});

test('沒有／冇 questions ask for the product instead of hiding it', () => {
  for (const [text, query] of [['百佳沒有花生醬嗎', '花生醬'], ['這裡沒有牛奶嗎', '牛奶'], ['惠康冇花生醬咩', '花生醬']]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [], text);
    assert.equal(parsed.query, query, text);
  }
  assert.deepEqual(parseRequest('有冇冇花生嘅餅乾？').allergens, ['peanuts']);
});

test('an allergy elsewhere in the sentence does not suppress the product asked for', () => {
  const coconut = parseRequest('對花生過敏，想飲椰子水');
  assert.deepEqual(coconut.allergens, ['peanuts']);
  assert.equal(coconut.query, '椰青水');
  assert.deepEqual(coconut.unsupportedAllergens, []);
  const oyster = parseRequest('我對蝦過敏，想買蠔油');
  assert.equal(oyster.query, '蠔油');
  assert.deepEqual(oyster.unsupportedAllergens, []);
  const coconutMilk = parseRequest('allergic to dairy, looking for coconut milk');
  assert.deepEqual(coconutMilk.allergens, ['milk']);
  assert.equal(coconutMilk.query, '椰漿');
});

test('budgets survive nearby nutrient words and Cantonese numbers', () => {
  for (const text of ['低糖唔超過20蚊', 'low sugar under 20 dollars']) {
    const parsed = parseRequest(text);
    assert.equal(parsed.budget, 20, text);
    assert.equal(parsed.sort, 'sugar-asc', text);
    assert.equal(parsed.query, '', text);
  }
  for (const [text, budget] of [['百二蚊', 120], ['百五蚊', 150], ['廿蚊以下', 20], ['一百零五蚊', 105], ['廿五蚊', 25], ['預算二十', 20], ['under $12.5', 12.5]]) {
    assert.equal(parseRequest(text).budget, budget, text);
  }
});

test('polite words and question words never become a junk search', () => {
  for (const [text, allergen] of [['唔該幫我搵無花生嘅餅乾', 'peanuts'], ['thanks, peanut-free biscuits', 'peanuts'], ['麻煩你搵冇奶嘅餅', 'milk'], ['只有無花生嘅餅乾先啱', 'peanuts']]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [allergen], text);
    assert.equal(parsed.query, '', text);
    assert.equal(parsed.category, 'biscuits', text);
  }
  assert.equal(parseRequest("I'm allergic to milk and eggs, want cheap biscuits under $15").query, '');
  assert.equal(parseRequest('我老豆有糖尿病，想買啲餅俾佢').query, '');
});

test('lactose-free wording asks for lactose-free milk; lactose intolerance still avoids milk', () => {
  for (const text of ['冇乳糖牛奶', '不含乳糖牛奶', '唔含乳糖嘅牛奶', '無乳糖牛奶', 'lactose free milk']) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [], text);
    assert.equal(parsed.query, '無乳糖', text);
  }
  for (const text of ['乳糖不耐', 'lactose intolerant']) assert.deepEqual(parseRequest(text).allergens, ['milk'], text);
});

test('不耐放, 帶走 and 拎走 are not "without"', () => {
  for (const [text, query] of [['鮮奶不耐放，想買盒裝牛奶', '牛奶'], ['帶走牛奶', '牛奶'], ['拎走奶茶', '奶茶']]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [], text);
    assert.equal(parsed.query, query, text);
  }
});

test('lists split by commas or colons, or written without 對, keep every allergen and the food words', () => {
  assert.deepEqual(parseRequest('花生，牛奶過敏').allergens, ['peanuts', 'milk']);
  assert.deepEqual(parseRequest('過敏原：花生、牛奶').allergens, ['peanuts', 'milk']);
  const mustard = parseRequest('allergies: peanuts, milk, mustard');
  assert.deepEqual(mustard.allergens, ['peanuts', 'milk']);
  assert.deepEqual(mustard.unsupportedAllergens, ['芥末']);
  assert.equal(mustard.query, '');
  assert.equal(parseRequest('allergic to peanuts, want chocolate').query, '巧克力');
  const unanchored = parseRequest('低糖餅乾花生過敏');
  assert.deepEqual(unanchored.allergens, ['peanuts']);
  assert.equal(unanchored.category, 'biscuits');
  assert.equal(unanchored.sort, 'sugar-asc');
  assert.equal(unanchored.allergyUnclear, false);
  assert.deepEqual(parseRequest('牛奶朱古力過敏').query, '', 'an allergy statement that names an allergen never searches the rest');
});

test('shellfish wording warns that molluscs are not filtered, in sentences and in links', () => {
  assert.deepEqual(parseRequest('shellfish allergy').unsupportedAllergens, ['軟體貝類']);
  for (const value of ['shellfish', 'seafood', '海鮮']) {
    const state = link(`?avoid=${encodeURIComponent(value)}`);
    assert.ok(state.filters.allergens.includes('crustaceans'), value);
    assert.deepEqual(state.unsupportedAllergens, ['軟體貝類'], value);
    assert.ok(state.notes.some(note => note.includes('軟體貝類')), value);
  }
});

test('links accept the page labels and everyday allergen words, and tell unknown from unfilterable', () => {
  const labels = link('?avoid=蛋類,魚類');
  assert.deepEqual(labels.filters.allergens, ['eggs', 'fish']);
  assert.deepEqual(labels.ignoredAllergens, []);
  for (const [value, ids] of [['含麩質穀物', ['gluten']], ['花生醬', ['peanuts']], ['乳製品', ['milk']], ['芝士', ['milk']], ['almond', ['tree-nuts']], ['cashew', ['tree-nuts']], ['walnut', ['tree-nuts']], ['oats', ['gluten']], ['barley', ['gluten']], ['lobster', ['crustaceans']], ['蟹', ['crustaceans']], ['treenuts', ['tree-nuts']], ['crabs', ['crustaceans']]]) {
    assert.deepEqual(link(`?avoid=${encodeURIComponent(value)}`).filters.allergens, ids, value);
  }
  const treeNuts = link('?avoid=tree%20nuts');
  assert.deepEqual(treeNuts.filters.allergens, ['tree-nuts']);
  assert.deepEqual(treeNuts.ignoredAllergens, []);
  assert.deepEqual(link('?avoid=peanuts%20tree%20nuts').filters.allergens, ['peanuts', 'tree-nuts']);
  const mixed = link('?avoid=peanuts%20mustard,chocolate');
  assert.deepEqual(mixed.filters.allergens, ['peanuts']);
  assert.deepEqual(mixed.unsupportedAllergens, ['芥末']);
  assert.deepEqual(mixed.ignoredAllergens, ['chocolate']);
  assert.deepEqual(allergenIdsForWord('Peanut-Butter'), ['peanuts']);
  assert.equal(unsupportedAllergenLabel('Mustard'), '芥末');
});

test('repeated link values are reported, and every AI search phrase is read for allergies', () => {
  const ai = link('?q=chocolate&q=no%20milk&src=ai');
  assert.equal(ai.filters.query, '巧克力');
  assert.deepEqual(ai.filters.allergens, ['milk']);
  assert.ok(ai.notes.some(note => note.includes('2 個搜尋字詞')));
  const copied = link('?q=a&q=b');
  assert.equal(copied.filters.query, 'a');
  assert.ok(copied.notes.some(note => note.includes('只用第一個')));
  const categories = link('?cat=snacks&cat=drinks');
  assert.equal(categories.filters.category, 'snacks');
  assert.ok(categories.notes.some(note => note.includes('多於一個分類')));
  const negation = link(`?q=${encodeURIComponent("I don't drink milk")}&src=ai`);
  assert.deepEqual(negation.filters.allergens, ['milk']);
  assert.equal(negation.filters.query, '');
});
