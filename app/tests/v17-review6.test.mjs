// Regression tests for the sixth independent review of v1.7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from '../engine.mjs';

const sorted = list => [...list].sort();

test('除咗X…都 / besides X adds X and never tells the person X is safe', () => {
  for (const [text, ids] of [['除咗花生之外，佢對蛋都過敏', ['peanuts', 'eggs']], ['除咗花生，蝦都唔食得', ['peanuts', 'crustaceans']], ['除咗花生，雞蛋佢都唔食得', ['peanuts', 'eggs']], ['除咗牛奶，佢連蛋都唔食得', ['milk', 'eggs']], ['apart from peanuts, he cannot eat eggs', ['peanuts', 'eggs']], ['besides peanuts he is allergic to eggs', ['peanuts', 'eggs']], ['on top of peanuts, eggs are a problem', ['peanuts', 'eggs']]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(sorted(parsed.allergens), sorted(ids), text);
    assert.ok(!parsed.notices.some(notice => notice.includes('當作可以食')), text);
  }
  const others = parseRequest('除咗杏仁，其他堅果都唔食得');
  assert.ok(others.allergens.includes('tree-nuts'));
  assert.equal(others.allergyUnclear, false);
});

test('symptoms with adverbs or body parts, and English symptom wording, name the food', () => {
  for (const [text, ids] of [['飲牛奶會好肚痛', ['milk']], ['我飲牛奶會作嘔', ['milk']], ['milk upsets my stomach', ['milk']], ['I get sick from milk', ['milk']], ['dairy gives me a stomach ache', ['milk']], ['peanuts make me very ill', ['peanuts']], ['my son swells up if he eats peanuts', ['peanuts']], ['我一食蝦就周身痕', ['crustaceans']], ['食完蝦會全身起疹', ['crustaceans']], ['佢食咗花生會成個人腫晒', ['peanuts']], ['食蛋會好唔舒服', ['eggs']], ['食花生會好辛苦', ['peanuts']]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, ids, text);
    assert.ok(!parsed.query || !/牛奶|milk|蝦|花生|peanut|蛋/.test(parsed.query), `${text} → ${parsed.query}`);
  }
});

test('dislikes and short refusals are read; "can\'t do without X" asks for X', () => {
  for (const [text, ids] of [['I hate milk', ['milk']], ['Milk is not for me', ['milk']], ['佢冇蛋先食得', ['eggs']], ['我冇花生先食得', ['peanuts']], ['花生？唔得㗎', ['peanuts']], ['花生 - NO', ['peanuts']], ['peanuts: no', ['peanuts']], ['not a fan of peanuts', ['peanuts']], ['唔係好鍾意芝士，有冇其他零食', ['milk']], ['我好憎芝士', ['milk']]]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, ids, text);
    assert.equal(parsed.query, '', text);
  }
  const chocolate = parseRequest('唔太鍾意朱古力，想買餅乾');
  assert.equal(chocolate.query, '');
  assert.equal(chocolate.category, 'biscuits');
  for (const [text, query] of [['冇花生醬唔得', '花生醬'], ['冇牛奶我唔得㗎', '牛奶'], ["can't live without peanut butter", 'peanut butter'], ['milk without lactose', '無乳糖'], ['milk with no lactose', '無乳糖'], ['無殼花生', '花生'], ['peanuts without shells', 'peanuts']]) {
    const parsed = parseRequest(text);
    assert.deepEqual(parsed.allergens, [], text);
    assert.equal(parsed.query, query, text);
  }
  assert.deepEqual(parseRequest('without shellfish').allergens, ['crustaceans']);
});
