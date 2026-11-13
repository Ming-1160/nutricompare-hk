import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_ASSISTANT } from '../ai-config.mjs?v=111';
import { assistantState } from '../assistant-state.mjs?v=111';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const rootPage = read('../../index.html');
const appPage = read('../index.html');
const program = read('../app.mjs');

test('the root page and app/ page are the same page, apart from the one <base> line', () => {
  const lines = rootPage.split('\n');
  const baseLines = lines.filter(line => line.includes('<base href="./app/">'));
  assert.equal(baseLines.length, 1);
  assert.equal(lines.filter(line => !line.includes('<base href="./app/">')).join('\n'), appPage);
});

test('both pages say so when the program cannot start, instead of showing "loading" forever', () => {
  for (const [name, page] of [['index.html', rootPage], ['app/index.html', appPage]]) {
    const safetyNet = page.indexOf("window.addEventListener('error'");
    const programTag = page.indexOf('<script type="module" src="app.mjs?v=111">');
    assert.ok(safetyNet > 0 && programTag > safetyNet, `${name}: the safety net is in place before the program is loaded`);
    assert.match(page, /網站程式載入唔到/, name);
    assert.match(page, /document\.documentElement\.dataset\.app/, name);
  }
  assert.match(program, /document\.documentElement\.dataset\.app='started'/, 'the program reports that it started');
});

test('a typing mistake in the assistant settings cannot stop the site: the settings are read on their own', () => {
  assert.doesNotMatch(program, /^import[^\n]*ai-config/m, 'ai-config.mjs is not part of the start-up chain');
  assert.match(program, /import\('\.\/ai-config\.mjs\?v=111'\)\.then\(/);
  assert.match(program, /\.catch\(error=>console\.warn\('app\/ai-config\.mjs could not be read/);
});

test('assistant settings have the expected shape, and 「叫 AI 解釋」 is never switched on without a working link', () => {
  assert.equal(typeof AI_ASSISTANT.url, 'string');
  assert.equal(typeof AI_ASSISTANT.platform, 'string');
  assert.equal(typeof AI_ASSISTANT.linkExpires, 'string');
  assert.equal(typeof AI_ASSISTANT.explainTested, 'boolean');
  assert.match(AI_ASSISTANT.linkExpires, /^(?:\d{4}-\d{2}-\d{2})?$/, 'linkExpires is empty or YYYY-MM-DD');
  if (AI_ASSISTANT.url) assert.match(AI_ASSISTANT.url, /^https:\/\//, 'the assistant link is an https address');
  if (AI_ASSISTANT.explainTested) assert.notEqual(assistantState(AI_ASSISTANT, new Date('2000-01-01')).state, 'pending', 'explainTested needs a link');
  // The button in the comparison is drawn only through explainReady(): link usable and tests passed.
  assert.match(program, /const explainReady=\(\)=>assistantState\(AI_ASSISTANT\)\.state==='ready'&&AI_ASSISTANT\.explainTested===true;/);
  assert.match(program, /\$\{explainReady\(\)\?'<button type="button" class="secondary-button" id="explain-comparison">叫 AI 解釋<\/button>':''\}/);
});

test('one name for the sentence filter: the old name is gone from the pages and the program', () => {
  for (const [name, text] of [['index.html', rootPage], ['app/app.mjs', program], ['project.html', read('../../project.html')]]) {
    assert.doesNotMatch(text, /離線(?:快速)?解讀|離線規則/, name);
  }
});
