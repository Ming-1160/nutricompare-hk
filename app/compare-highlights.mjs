/**
 * Number-only helpers for the comparison table (v1.10).
 * They describe figures that are already on screen. They never say which food is better.
 */

/**
 * Lowest, highest and gap between the values printed in one row.
 * Pass the values exactly as printed (already rounded); null or undefined means unknown.
 * Returns null when fewer than two values are known, or when the known values are all the same.
 * `complete` is false when any value is unknown. The page shows the gap and the "lowest" mark only for
 * complete rows, because an unknown value could be lower or higher than every known one.
 */
export function valueSpread(shownValues = [], decimals = 1) {
  const known = shownValues.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
  if (known.length < 2) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  if (min === max) return null;
  const scale = 10 ** decimals;
  return { min, max, difference: Math.round((max - min) * scale) / scale, complete: known.length === shownValues.length };
}
