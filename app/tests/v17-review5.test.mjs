// Regression tests for the fifth independent review of v1.7: additions vs exceptions, symptoms, and no false exclusions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from '../engine.mjs';
import { filtersFromParams } from '../url-state.mjs';

const sorted = list => [...list].sort();
const same = (text, ids) => assert.deepEqual(sorted(parseRequest(text).allergens), sorted(ids), text);

test('"besides X, also Y" adds X; the person is never told an allergen is safe', () => {
  for (const [text, ids] of [['我個仔對好多嘢過敏，除咗花生之外，仲有蝦同蛋', ['peanuts', 'crustaceans', 'eggs']], ['apart from peanuts I am also allergic to milk', ['peanuts', 'milk']], ['除咗花生，仲有芝麻都唔食得', ['peanuts', 'sesame']], ['除咗花生之外，其他都得', ['peanuts']]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(sorted(parsed.allergens), sorted(ids), text);
    assert.ok(!parsed.notices.some(notice => notice.includes('當作可以食')), text);
  }
  assert.ok(parseRequest('allergic to peanuts but not tree nuts').notices.some(notice => notice.includes('當作可以食')));
});

test('symptom wording names the food', () => {
  for (const [text, ids] of [['我一飲牛奶就肚瀉', ['milk']], ['牛奶，佢一飲就肚痛', ['milk']], ['peanuts make my throat swell', ['peanuts']], ['eggs make me break out', ['eggs']], ['我食花生會死', ['peanuts']], ['花生會令我呼吸困難', ['peanuts']], ['花生呀，我個仔食咗會出事', ['peanuts']], ['牛奶，我飲咗會肚痛', ['milk']]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, ids, text);
    assert.equal(parsed.query, '', text);
    assert.equal(parsed.allergyUnclear, false, text);
  }
});

test('incidental negation words never exclude the product asked for', () => {
  for (const text of ['我想買忌廉夾心餅', '忌廉蛋糕', '比較唔同牌子嘅牛奶', '冇咁甜嘅豆奶', '唔甜嘅花生醬', '無蔗糖豆漿', '無添加花生醬', '冇添加防腐劑嘅牛奶', '無鹽牛油', 'milk with no preservatives', 'peanut butter with no palm oil', '我搵唔到花生醬', "I can't find peanut butter at Wellcome", '惠康嘅花生醬冇貨', '我想買唔太貴嘅牛奶', 'not expensive cheese crackers', '有冇唔辣嘅蝦片？', "cheese that doesn't taste too strong", '我唔怕花生，想買花生醬', '我唔介意有花生', "I don't mind nuts", "I don't know which milk is best", "can't decide between milk and soy milk", 'never had soy milk, want to try', "can't wait to try the new peanut butter", '我冇試過杏仁奶，想試吓', '唔記得買牛奶', '戒口嘅人飲咩牛奶好？', '我冇牛奶喇，想買', '屋企冇花生醬，想買啲', '我以前唔鍾意芝士，而家想試', "don't have milk at home, want to buy", "Don't you have peanut butter?"]) {
    assert.deepEqual(parseRequest(text).allergens, [], text);
  }
  for (const q of ['忌廉夾心餅', '唔同牌子嘅牛奶', "can't find peanut butter"]) {
    assert.deepEqual(filtersFromParams(`?q=${encodeURIComponent(q)}&src=ai`, { storeIds: [], base: { allergens: [] } }).filters.allergens, [], q);
  }
  assert.equal(parseRequest('冇咁甜嘅豆奶').sort, 'sugar-asc');
  assert.equal(parseRequest('無鹽牛油').sort, 'sodium-asc');
  assert.equal(parseRequest('我搵唔到花生醬').query, '花生醬');
});

test('more refusals are read', () => {
  for (const [text, ids] of [['唔使有花生', ['peanuts']], ['不用花生', ['peanuts']], ['唔使落花生', ['peanuts']], ['唔可以含有花生', ['peanuts']], ['花生，我食唔到', ['peanuts']], ['我唔會食花生', ['peanuts']], ['not peanuts', ['peanuts']], ['peanuts are a big no', ['peanuts']], ['milk is a hard no', ['milk']], ['peanut allergic family', ['peanuts']], ["milk doesn't agree with me", ['milk']]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, ids, text);
    assert.ok(!parsed.query || !/花生|peanut|milk|牛奶/.test(parsed.query), `${text} → ${parsed.query}`);
  }
  const sugar = parseRequest('I quit sugar, want peanut butter');
  assert.equal(sugar.sort, 'sugar-asc');
  assert.equal(sugar.query, 'peanut butter');
  const avocado = parseRequest('唔要牛油果');
  assert.deepEqual(avocado.allergens, []);
  assert.equal(avocado.query, '');
  assert.deepEqual(avocado.avoidedFoods, ['牛油果']);
});
