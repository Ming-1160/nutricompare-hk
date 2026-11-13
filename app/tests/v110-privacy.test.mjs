import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseConnections, summariseStorage } from '../privacy-receipt.mjs?v=111';

const page = 'https://ming-1160.github.io/nutricompare-hk/?q=%E5%8D%B3%E9%A3%9F%E9%BA%B5&avoid=peanuts';

test('requests are grouped by host and the site itself is told apart from other sites', () => {
  const own = ['https://ming-1160.github.io/nutricompare-hk/', 'https://ming-1160.github.io/nutricompare-hk/app/app.mjs?v=111', 'https://ming-1160.github.io/nutricompare-hk/app/data/products.json'];
  const summary = summariseConnections(own.map(name => ({ name })), page);
  assert.equal(summary.total, 3);
  assert.equal(summary.ownHost, 'ming-1160.github.io');
  assert.deepEqual(summary.hosts, [{ host: 'ming-1160.github.io', count: 3, own: true }]);
  assert.deepEqual(summary.otherHosts, []);

  const mixed = summariseConnections([...own, 'https://tracker.example/pixel.gif', 'https://cdn.example/lib.js', 'https://cdn.example/font.woff2'], page);
  assert.equal(mixed.total, 6);
  assert.deepEqual(mixed.hosts.map(item => [item.host, item.count, item.own]), [['ming-1160.github.io', 3, true], ['cdn.example', 2, false], ['tracker.example', 1, false]]);
  assert.equal(mixed.otherHosts.length, 2);
});

test('addresses that never leave the device, and unreadable entries, are not counted as requests', () => {
  const summary = summariseConnections(['data:image/svg+xml,<svg/>', 'blob:https://ming-1160.github.io/1', '', null, { name: 'not a url' }, {}], page);
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.hosts, []);
  assert.equal(summariseConnections(undefined, 'not a url').ownHost, '');
});

test('storage is reported by name only, with known items explained', () => {
  const none = summariseStorage({ cookie: '', storageKeys: [] });
  assert.deepEqual(none, { cookieCount: 0, cookieNames: [], items: [] });
  const some = summariseStorage({ cookie: 'a=1; b=secret-value', storageKeys: ['nc-text-size', 'something-else'] });
  assert.equal(some.cookieCount, 2);
  assert.deepEqual(some.cookieNames, ['a', 'b']);
  assert.deepEqual(some.items, [{ key: 'nc-text-size', label: 'A+ 大字設定' }, { key: 'something-else', label: '其他項目' }]);
  assert.ok(!JSON.stringify(some).includes('secret-value'), 'stored values are never shown');
  // A stored item named like a built-in property is still just "other", never a function printed as its label.
  const odd = summariseStorage({ storageKeys: ['constructor', 'toString', '__proto__', 'hasOwnProperty'] });
  assert.deepEqual(odd.items.map(item => item.label), ['其他項目', '其他項目', '其他項目', '其他項目']);
});
