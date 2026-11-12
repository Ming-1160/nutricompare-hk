/**
 * What the AI assistant area should show: still being set up, ready, or link expired.
 * EdUHK MaaS publish links are created with an expiry date, so a link that worked last week
 * can be dead on the day of the demo. The page says so instead of showing a button that fails.
 */

/** 'YYYY-MM-DD' -> the moment that date ends in Hong Kong (UTC+8). Anything else -> null. */
export function expiryInstant(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const start = Date.UTC(year, month - 1, day);
  const check = new Date(start);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  // Midnight at the end of that day in Hong Kong is 16:00 UTC on the same calendar date.
  return start + 16 * 60 * 60 * 1000;
}

export function assistantState(config = {}, now = Date.now()) {
  let url = '';
  try {
    const parsed = new URL(config.url);
    if (parsed.protocol === 'https:') url = parsed.href;
  } catch { url = ''; }
  if (!url) return { state: 'pending', url: '', expires: '', daysLeft: null, expiryUnreadable: false };
  const expires = String(config.linkExpires ?? '').trim();
  const end = expiryInstant(expires);
  // A date that cannot be read is reported, and the button stays: the group may simply have typed it differently.
  if (end === null) return { state: 'ready', url, expires: '', daysLeft: null, expiryUnreadable: Boolean(expires) };
  const current = now instanceof Date ? now.getTime() : Number(now);
  if (current >= end) return { state: 'expired', url, expires, daysLeft: 0, expiryUnreadable: false };
  return { state: 'ready', url, expires, daysLeft: Math.ceil((end - current) / 86400000), expiryUnreadable: false };
}
