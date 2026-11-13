/**
 * NutriCompare HK: loading the data files.
 *
 * Every file is fetched on its own, so one slow or missing file never hides the others,
 * and every file that did not arrive is reported to the page. Nothing fails silently.
 *
 * What is shown while a file is missing (resultsHold and comparingPaused below):
 *  - Every file decides either which foods exist or which allergen statement a food ends up with, and a
 *    complete statement from a file applied earlier is never replaced by a later file. So with any file
 *    missing, no allergy-filtered result is shown at all.
 *  - Without a label file, some foods would show figures from a lower-ranked source that the complete
 *    catalogue corrects (a soy sauce at 7,592 mg sodium instead of 3,920 mg). So with a label file missing,
 *    no food is listed at all.
 *  - Comparing is paused whenever anything is missing.
 * These rules do not depend on the data. As a second check, app/tests/v110-data-loading.test.mjs goes through
 * every combination of missing files and confirms that, with the data as shipped, no food would pass an
 * allergen filter that it fails with all files loaded, and that the states which still list foods never show
 * a figure different from the complete catalogue.
 */
import { buildCatalogue, mergeLabelSources } from './catalogue.mjs?v=111';
import { enrichCatalogue } from './enrichment.mjs?v=111';
import { applyHkLabelReview } from './hk-labels.mjs?v=111';

export const REQUIRED_FILE = 'products.json';
export const OFF_LABEL_FILE = 'off-hk-labels.json';
export const PRICE_FILES = Object.freeze(['pricewatch-foods.json', 'pricewatch-meta.json']);
export const HK_EXPANSION_FILE = 'hk-nutrition-expansion.json';
export const OFF_LIBRARY_FILE = 'off-nutrition-library.json';
export const REVIEW_FILES = Object.freeze([
  'hk-reviewed-labels.json', 'off-hk-reviewed-labels.json', 'hk-reviewed-labels-extra.json', 'off-hk-reviewed-labels-extra.json',
]);
/** Files with label data read for this project. Their figures and statements outrank the reference files. */
export const LABEL_FILES = Object.freeze([OFF_LABEL_FILE, ...REVIEW_FILES]);
/** Files in the order they are applied. The order decides which source wins, so it never changes with arrival time. */
export const DATA_FILES = Object.freeze([REQUIRED_FILE, OFF_LABEL_FILE, ...PRICE_FILES, HK_EXPANSION_FILE, OFF_LIBRARY_FILE, ...REVIEW_FILES]);

/**
 * Fetch one JSON file. The request is abandoned only when nothing has arrived for timeoutMs, so the page is
 * never stuck loading, yet a large file on a slow line still finishes as long as data keeps coming.
 * No Referer is sent: the page address can carry the allergens a person chose.
 */
export async function fetchJson(url, { timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  let timer;
  const restartClock = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), timeoutMs); };
  try {
    restartClock();
    const response = await fetchImpl(url, { cache: 'no-cache', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader?.();
    if (!reader) return await response.json();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      restartClock();
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    throw new Error(controller.signal.aborted ? `no data for ${Math.round(timeoutMs / 1000)} s` : (error?.message ?? 'failed'));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch every file that is not loaded yet, all at the same time.
 * Files already in `loaded` are kept, so "try again" only asks for what is missing.
 */
export async function loadDataFiles(read, loaded = new Map(), names = DATA_FILES) {
  const wanted = names.filter(name => !loaded.has(name));
  const settled = await Promise.allSettled(wanted.map(name => read(name)));
  const failures = [];
  settled.forEach((result, index) => {
    const usable = result.status === 'fulfilled' && result.value !== null && typeof result.value === 'object';
    if (usable) loaded.set(wanted[index], result.value);
    else failures.push({ file: wanted[index], reason: result.status === 'rejected' ? (result.reason?.message ?? 'failed') : 'not a data object' });
  });
  return { loaded, failures };
}

/**
 * Build the catalogue from whichever files arrived, with the same rules and order as before v1.10.
 * One change: the Hong Kong nutrition file is now used even when the larger Open Food Facts library has
 * not arrived. The reverse is not done. Hong Kong figures outrank Open Food Facts ones, so without the
 * Hong Kong file the library is left out and those figures stay unknown instead of showing a different number.
 * The inputs are never changed, so the catalogue can be rebuilt after a retry.
 */
export function assembleDataset(loaded) {
  const has = name => loaded.get(name) !== null && typeof loaded.get(name) === 'object';
  const missing = DATA_FILES.filter(name => !has(name));
  if (!has(REQUIRED_FILE)) return { dataset: null, missing, fatal: true, priced: false };
  let curated = loaded.get(REQUIRED_FILE);
  if (has(OFF_LABEL_FILE)) curated = mergeLabelSources(curated, loaded.get(OFF_LABEL_FILE));
  // Prices need both files: the second one carries the snapshot date and the shop details.
  const priced = PRICE_FILES.every(has);
  let dataset = priced ? buildCatalogue(curated, loaded.get(PRICE_FILES[0]), loaded.get(PRICE_FILES[1])) : curated;
  if (has(HK_EXPANSION_FILE)) {
    dataset = enrichCatalogue(dataset, loaded.get(HK_EXPANSION_FILE), has(OFF_LIBRARY_FILE) ? loaded.get(OFF_LIBRARY_FILE) : {});
  }
  for (const name of REVIEW_FILES) if (has(name)) dataset = applyHkLabelReview(dataset, loaded.get(name));
  if (!Array.isArray(dataset.products) || !dataset.products.length) return { dataset: null, missing, fatal: true, priced };
  return { dataset, missing, fatal: false, priced };
}

/**
 * Why results are held back, or '' when foods can be listed.
 *  'labels'  : a label file is missing, so nothing is listed (figures and statements could be wrong).
 *  'allergy' : some other file is missing and the person is avoiding an allergen.
 * Deliberately simple: apart from telling label files from the rest, it does not look at which file is missing.
 */
export function resultsHold(missing = [], allergens = []) {
  if (missing.some(name => LABEL_FILES.includes(name))) return 'labels';
  if (missing.length > 0 && allergens.length > 0) return 'allergy';
  return '';
}

/** Comparing, the text for the AI and suggested alternatives are paused whenever any file is missing. */
export const comparingPaused = (missing = []) => missing.length > 0;

/**
 * Plain-language summary of what is missing, for the notice above the results.
 * Returns null when everything loaded.
 */
export function describeMissing(missing = []) {
  if (!missing.length) return null;
  const pricesMissing = missing.some(name => PRICE_FILES.includes(name));
  const labelsMissing = missing.some(name => LABEL_FILES.includes(name));
  const kinds = [];
  if (pricesMissing) kinds.push('消委會價格目錄');
  if (missing.includes(HK_EXPANSION_FILE) || missing.includes(OFF_LIBRARY_FILE)) kinds.push('營養參考資料');
  if (labelsMissing) kinds.push('標籤及過敏資料');
  const count = `有 ${missing.length} 份資料未能載入（${kinds.join('、')}）。`;
  const message = labelsMissing
    ? `${count}少咗標籤資料，部分營養數字同過敏聲明會同核對過嘅標籤唔同，所以網站暫時唔顯示食品。`
    : pricesMissing
      ? '消委會價格目錄未能載入，而家只顯示小量逐件核對嘅食品，大部分食品同價錢都未出現。'
      : `${count}部分食品嘅營養數字同過敏資料會顯示為未知。`;
  const note = labelsMissing
    ? '請撳「再試一次」。呢段時間請直接睇包裝上嘅標籤。'
    : '資料未齊嗰陣，網站唔會顯示過敏篩選結果，亦暫停比較，等載入齊先顯示。';
  return { pricesMissing, labelsMissing, kinds, count: missing.length, message, note };
}
