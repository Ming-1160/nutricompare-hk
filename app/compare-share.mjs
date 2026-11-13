import { paramsFromFilters } from './url-state.mjs?v=111';
import qrcode from './vendor/qrcode-generator.mjs?v=111';

export function comparisonShareUrl(pageUrl, filters, compareIds) {
  const url = new URL(pageUrl);
  url.search = paramsFromFilters(filters, { compareIds });
  url.hash = '';
  return url.href;
}

export function whatsappShareUrl(url) {
  return `https://wa.me/?text=${encodeURIComponent(url)}`;
}

export function qrSvg(url) {
  const code = qrcode(0, 'M');
  code.addData(new URL(url).href, 'Byte');
  code.make();
  return code.createSvgTag({ cellSize: 1, margin: 4, scalable: true, title: '比較連結 QR code' });
}

export async function shareComparison(url, navigator = globalThis.navigator) {
  if (navigator?.share) {
    try {
      await navigator.share({ title: 'NutriCompare HK 食品比較', url });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'manual';
  }
}
