/**
 * Privacy receipt (v1.10): what this page really connected to and what it keeps on the device.
 * The figures come from the browser's own records at the moment the person asks.
 * Nothing in this module sends anything anywhere.
 */

/** Items this site itself saves in the browser, with the words shown to the person. */
const KNOWN_STORAGE = Object.freeze({ 'nc-text-size': 'A+ 大字設定' });

/**
 * Group the page's network requests by host.
 * `entries` are PerformanceEntry objects (navigation and resource) or plain URLs.
 * data: and blob: addresses never leave the device, so they are not counted.
 */
export function summariseConnections(entries = [], pageUrl = '') {
  let ownHost = '';
  try { ownHost = new URL(pageUrl).host; } catch { ownHost = ''; }
  const counts = new Map();
  let total = 0;
  for (const entry of entries) {
    let url;
    try { url = new URL(typeof entry === 'string' ? entry : entry?.name); } catch { continue; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    total++;
    counts.set(url.host, (counts.get(url.host) ?? 0) + 1);
  }
  const hosts = [...counts].map(([host, count]) => ({ host, count, own: host === ownHost }))
    .sort((a, b) => Number(b.own) - Number(a.own) || b.count - a.count || a.host.localeCompare(b.host));
  return { total, ownHost, hosts, otherHosts: hosts.filter(item => !item.own) };
}

/**
 * Cookies and browser storage for this site. Only names are reported, never the stored values.
 * `cookie` is document.cookie, so only cookies a page script can read are counted (a server could set
 * others that scripts cannot see; this site's host sets none that we know of). `storageKeys` is the list
 * of localStorage keys.
 */
export function summariseStorage({ cookie = '', storageKeys = [] } = {}) {
  const cookieNames = String(cookie ?? '').split(';').map(part => part.trim()).filter(Boolean).map(part => part.split('=')[0]);
  return {
    cookieCount: cookieNames.length,
    cookieNames,
    // Object.hasOwn: a stored item that happens to be called "constructor" or "toString" is still just "other".
    items: storageKeys.map(key => ({ key: String(key), label: Object.hasOwn(KNOWN_STORAGE, key) ? KNOWN_STORAGE[key] : '其他項目' })),
  };
}
