/**
 * "Ask the AI to explain" (v1.10): the site writes a plain-text block of a comparison, and the person
 * pastes it into the AI assistant. The AI only puts into words what the site has already worked out:
 * every figure in the block is one shown in the comparison table, and unknown stays unknown.
 * Where the site itself refuses to say which food is higher or lower (different units, different
 * carbohydrate definitions, an unknown value), the block says so and tells the AI not to rank either.
 * tools/check-ai-numbers.mjs can then list any number in the AI's reply that is not in this block.
 */

export const EXPLAIN_HEADER = '【NutriCompare 比較資料】';

/** Instructions carried inside the block, so it is safe to paste even into an assistant without "模式 2". */
export const EXPLAIN_REQUEST = '請只用下面嘅數字，用淺白廣東話解釋呢幾款食品嘅分別。唔好加其他產品或者數字，唔好自己計新數字，唔好評價邊款好啲，亦唔好講啱唔啱食。列喺「唔可以直接比高低」嘅項目，只可以逐款讀出數字，唔好講邊款高、邊款低。講明邊啲係未知，最後提醒我核對包裝。';

/** Digits without thousands separators, so a figure reads the same in the block and in a reply. */
export function plainNumber(value, decimals = 1) {
  // Only a real number counts. An empty box or a missing value is unknown, never 0.
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(amount)) return null;
  const scale = 10 ** decimals;
  return String(Math.round(amount * scale) / scale);
}

const figure = (value, unit, decimals = 1) => {
  const text = plainNumber(value, decimals);
  return text === null ? '未知' : `${text} ${unit}`.trim();
};
const money = value => {
  const text = plainNumber(value, 2);
  return text === null ? '未知' : `HK$${text}`;
};

/**
 * @param {object} comparison
 * @param {string} comparison.basisLabel   e.g. "每 100 g／ml"
 * @param {string} comparison.priceNote    e.g. "所有商戶最低整包價；價格快照 2026年10月21日；未計優惠"
 * @param {Array}  comparison.products     [{ name, sourceLabel, portion, nutrients:[{label,value,unit}], price:{whole,store,per100,per100Unit}, allergy }]
 * @param {Array}  comparison.gaps         [{ label, difference, unit }] gaps the site already shows
 * @param {Array}  comparison.notComparable [{ label, reason }] rows the site does not rank, with the reason
 */
export function buildExplainText({ basisLabel = '', priceNote = '', products = [], gaps = [], notComparable = [] } = {}) {
  const lines = [EXPLAIN_HEADER, EXPLAIN_REQUEST, '', `比較基準：${basisLabel || '未知'}`];
  if (priceNote) lines.push(`價格：${priceNote}`);
  products.forEach((product, index) => {
    lines.push('', `食品 ${index + 1}：${product.name}`);
    lines.push(`資料性質：${product.sourceLabel || '未知'}`);
    lines.push(`比較份量：${product.portion && product.portion !== '—' ? product.portion : '未知'}`);
    for (const nutrient of product.nutrients ?? []) lines.push(`${nutrient.label}：${figure(nutrient.value, nutrient.unit)}`);
    const price = product.price ?? {};
    lines.push(`整包價：${money(price.whole)}${price.whole !== null && price.whole !== undefined && price.store ? `（${price.store}）` : ''}`);
    lines.push(`每 100 ${price.per100Unit || 'g／ml'} 價：${money(price.per100)}`);
    lines.push(`過敏聲明：${product.allergy || '未知'}`);
  });
  lines.push('', gaps.length
    ? `網站已計嘅高低相差：${gaps.map(gap => `${gap.label} ${plainNumber(gap.difference, gap.decimals ?? 1)} ${gap.unit}`.trim()).join('；')}`
    : '網站已計嘅高低相差：冇');
  if (notComparable.length) {
    // Rows that share a reason are written together, so the line stays short.
    const byReason = new Map();
    for (const item of notComparable) byReason.set(item.reason, [...(byReason.get(item.reason) ?? []), item.label]);
    lines.push(`唔可以直接比高低：${[...byReason].map(([reason, labels]) => `${labels.join('、')}（${reason}）`).join('；')}`);
  }
  return lines.join('\n');
}
