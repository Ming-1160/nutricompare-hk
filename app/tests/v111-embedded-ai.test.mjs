import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedAssistantUrl, validatedResultUrl, isTrustedAssistantMessage, resultLinkFromAnswer, MAAS_ORIGIN } from '../embedded-ai.mjs?v=111';

const now = Date.UTC(2026, 10, 13);
const config = { url: 'https://maas.eduhk.hk/chat/share?shareId=public-share', linkExpires: '2027-11-12' };

test('the embed URL preserves the public share ID and hides the platform header and history', () => {
  const url = new URL(embeddedAssistantUrl(config, now));
  assert.equal(url.origin, MAAS_ORIGIN);
  assert.equal(url.pathname, '/chat/share');
  assert.equal(url.searchParams.get('shareId'), 'public-share');
  assert.equal(url.searchParams.get('showHead'), '0');
  assert.equal(url.searchParams.get('showHistory'), '0');
  assert.equal(new URL(config.url).searchParams.has('showHead'), false, 'the supplied config is not changed');
});

test('pending, expired, non-MaaS and malformed links never produce an iframe address', () => {
  for (const invalid of [{}, { url: '' }, { ...config, linkExpires: '2026-11-12' },
    { ...config, url: 'http://maas.eduhk.hk/chat/share?shareId=public' },
    { ...config, url: 'https://maas.eduhk.hk.evil.example/chat/share?shareId=public' },
    { ...config, url: 'https://maas.eduhk.hk/other?shareId=public' },
    { ...config, url: 'https://maas.eduhk.hk/chat/share' },
    { ...config, url: 'https://someone@maas.eduhk.hk/chat/share?shareId=public' }]) {
    assert.equal(embeddedAssistantUrl(invalid, now), '', JSON.stringify(invalid));
  }
});

test('only the exact public project page can be imported as a result link', () => {
  const accepted = 'https://ming-1160.github.io/nutricompare-hk/?q=instant%20noodles&avoid=peanuts#results';
  const url = new URL(validatedResultUrl(accepted));
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('q'), 'instant noodles');
  assert.equal(url.searchParams.get('avoid'), 'peanuts');
  for (const invalid of [null, 'javascript:alert(1)', '/nutricompare-hk/?q=milk',
    'http://ming-1160.github.io/nutricompare-hk/',
    'https://ming-1160.github.io.evil.example/nutricompare-hk/',
    'https://ming-1160.github.io/another-project/',
    'https://ming-1160.github.io/nutricompare-hk/app/',
    'https://ming-1160.github.io/nutricompare-hk/%2fother',
    'https://someone@ming-1160.github.io/nutricompare-hk/',
    'https://ming-1160.github.io/nutricompare-hk/?q=' + 'a'.repeat(12000)]) {
    assert.equal(validatedResultUrl(invalid), '', String(invalid).slice(0, 100));
  }
});

test('ready and finish messages require both the exact iframe window and exact MaaS origin', () => {
  const frameWindow = {};
  const good = { source: frameWindow, origin: MAAS_ORIGIN, data: { type: 'shareChatReady' } };
  assert.equal(isTrustedAssistantMessage(good, frameWindow, 'shareChatReady'), true);
  for (const bad of [{ ...good, source: {} }, { ...good, origin: 'https://example.org' },
    { ...good, origin: MAAS_ORIGIN + '.evil.example' }, { ...good, data: 'shareChatReady' },
    { ...good, data: { type: 'shareChatStart' } }, { ...good, data: null }]) {
    assert.equal(isTrustedAssistantMessage(bad, frameWindow, 'shareChatReady'), false);
  }
  assert.equal(isTrustedAssistantMessage(good, null, 'shareChatReady'), false, 'a removed frame cannot be trusted');
  const finished = { ...good, data: { type: 'shareChatFinish', data: { answer: 'text' } } };
  assert.equal(isTrustedAssistantMessage(finished, frameWindow, 'shareChatFinish'), true);
});

test('a completed AI answer yields only a project result link and leaves text as text', () => {
  const result = 'https://ming-1160.github.io/nutricompare-hk/?q=milk&avoid=peanuts';
  assert.equal(resultLinkFromAnswer(`[開啟結果](${result})`), result);
  assert.equal(resultLinkFromAnswer(`條件卡\n${result}\n請核對包裝。`), result);
  assert.equal(resultLinkFromAnswer(`先睇 https://example.org/else 再睇 ${result}`), result);
  assert.equal(resultLinkFromAnswer('https://ming-1160.github.io/another-project/'), '');
  assert.equal(resultLinkFromAnswer('<script>alert(1)</script>'), '');
  assert.equal(resultLinkFromAnswer({ answer: result }), '', 'an unexpected message shape is ignored');
  assert.equal(resultLinkFromAnswer('a'.repeat(100001)), '');
});
