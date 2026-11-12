#!/usr/bin/env node
/**
 * Lists every number in an AI reply that does not appear in the comparison data the AI was given.
 * Use it when testing "模式 2" (explain a comparison) of the MaaS assistant:
 *
 *   1. On the website, open a comparison, press 「叫 AI 解釋」 and copy the data block into data.txt
 *   2. Paste the AI's reply into reply.txt
 *   3. Run:  node tools/check-ai-numbers.mjs data.txt reply.txt
 *
 * A listed number is not always a mistake (the AI may have counted the foods), but a person must look at each one.
 *
 * What this tool cannot do, so a person still has to read every sentence of the reply:
 *   - It only finds numbers that appear nowhere in the data. A real number given to the wrong food or the
 *     wrong nutrient (food 2's sodium quoted as food 1's) passes, because that number is in the data.
 *   - Only digits are checked. Numbers written in Chinese characters (例如「四百」) are not detected.
 *   - It does not read words, so "higher", "lower" or any advice in the reply is not checked at all.
 * Nothing is sent anywhere; the script only reads the two files.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
/** "1." / "2)" / "3、" at the start of a line is list numbering, not a figure about the food. */
const LIST_MARKER = /^[ \t]*(?:[-*•]\s*)?\d{1,2}[.)、．](?!\d)/gm;

const normalise = text => String(text ?? '').normalize('NFKC');

/** Every number in the text with its position. "2,091.9" and "2091.9" are the same number. */
export function numbersIn(text) {
  const source = normalise(text);
  const found = [];
  for (const match of source.matchAll(NUMBER)) {
    const value = Number(match[0].replaceAll(',', ''));
    if (Number.isFinite(value)) found.push({ raw: match[0], value, index: match.index });
  }
  return found;
}

/**
 * Numbers that are in the reply but not in the data.
 * Each result carries a short piece of the reply so the tester can find it.
 */
export function unsupportedNumbers(dataText, replyText) {
  const allowed = new Set(numbersIn(dataText).map(item => item.value));
  const reply = normalise(replyText).replace(LIST_MARKER, marker => marker.replace(/\d/g, ' '));
  return numbersIn(reply)
    .filter(item => !allowed.has(item.value))
    .map(item => ({
      raw: item.raw,
      value: item.value,
      context: reply.slice(Math.max(0, item.index - 12), item.index + item.raw.length + 12).replace(/\s+/g, ' ').trim(),
    }));
}

function main([dataFile, replyFile]) {
  if (!dataFile || !replyFile) {
    console.error('用法：node tools/check-ai-numbers.mjs <比較資料.txt> <AI回覆.txt>');
    return 2;
  }
  const extra = unsupportedNumbers(readFileSync(dataFile, 'utf8'), readFileSync(replyFile, 'utf8'));
  if (!extra.length) {
    console.log('冇發現比較資料以外嘅數字。');
    console.log('注意：呢個工具只查到「資料入面冇嘅數字」。AI 將啱嘅數字講錯食品或者項目、用中文字寫數字、或者講錯高低，佢都查唔到，所以仍然要逐句對一次比較表。');
    return 0;
  }
  console.log(`AI 回覆有 ${extra.length} 個數字唔喺比較資料入面，請逐個睇：`);
  for (const item of extra) console.log(`  ${item.raw}  …${item.context}…`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
