import { filterProducts, getAllergenAssessment, normalizeAllergen } from './engine.mjs?v=110';

export function getExclusionReasons(products, filters) {
  const conflicts = [];
  const unknown = [];
  if (!filters.allergens?.length) return { conflicts, unknown };
  const candidates = filterProducts(products, { ...filters, allergens: [] });
  for (const product of candidates) {
    const assessment = getAllergenAssessment(product, filters.allergens);
    if (assessment.status === 'unknown') unknown.push(product);
    if (assessment.status !== 'conflict') continue;
    const contains = new Set((Array.isArray(product.allergens?.contains) ? product.allergens.contains : []).map(normalizeAllergen));
    const mayContain = new Set((Array.isArray(product.allergens?.mayContain) ? product.allergens.mayContain : []).map(normalizeAllergen));
    conflicts.push({
      product,
      contains: assessment.conflicts.filter(id => contains.has(id)),
      mayContain: assessment.conflicts.filter(id => mayContain.has(id)),
    });
  }
  return { conflicts, unknown };
}
