import test from 'node:test';
import assert from 'node:assert/strict';
import { valueSpread } from '../compare-highlights.mjs?v=110';

test('the gap between highest and lowest uses the printed values', () => {
  // 出前一丁碗麵 2,091.9 mg vs 公仔碗麵 1,601.9 mg sodium per 100 g, as printed in the table.
  assert.deepEqual(valueSpread([2091.9, 1601.9]), { min: 1601.9, max: 2091.9, difference: 490, complete: true });
  assert.deepEqual(valueSpread([57.5, 55.8, 58.6]), { min: 55.8, max: 58.6, difference: 2.8, complete: true });
  assert.equal(valueSpread([0.1, 0.3]).difference, 0.2, 'no floating-point tail');
  assert.equal(valueSpread([10.1, 8.56], 2).difference, 1.54);
});

test('unknown values are never treated as zero', () => {
  const partial = valueSpread([2.3, null, 6.4]);
  assert.deepEqual([partial.min, partial.max, partial.complete], [2.3, 6.4, false]);
  assert.equal(valueSpread([null, 5]), null, 'one known value is not a comparison');
  assert.equal(valueSpread([null, undefined]), null);
  assert.equal(valueSpread([]), null);
  // A real zero is a value, not a gap in the data.
  assert.deepEqual(valueSpread([0, 1.5]), { min: 0, max: 1.5, difference: 1.5, complete: true });
});

test('equal values give no lowest mark and no gap', () => {
  assert.equal(valueSpread([4.6, 4.6]), null);
  assert.equal(valueSpread([4.6, 4.6, null]), null);
});
