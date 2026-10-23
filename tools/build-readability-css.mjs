#!/usr/bin/env node
/**
 * Regenerates the readability layer at the end of app/styles.css.
 *  - Text colours below a 4.5:1 contrast ratio (WCAG 2.2 AA, normal text) on the site's light panels are darkened,
 *    keeping their hue. Decorative marks (illustrations, sparkles, step numbers) are left as designed.
 *  - Informative text smaller than 12px is raised to 12px.
 *  - "A+ 大字" mode (html.large-text) scales every text size up, with a 15px minimum.
 * Usage from the repository root: node tools/build-readability-css.mjs
 */
import fs from 'node:fs';

const FILE = new URL('../app/styles.css', import.meta.url);
const BEGIN = '/* BEGIN generated readability layer: node tools/build-readability-css.mjs */';
const END = '/* END generated readability layer */';
const WORST_BACKGROUND = '#edf2e6'; // the darkest light panel colour used behind text
const TARGET_RATIO = 4.6;
const DEFAULT_MIN_PX = 12;
const LARGE_MIN_PX = 15;
const DECORATIVE = /art-|visual-caption|tiny-leaf|note-symbol|floating-note|pack-|cookie|brand-icon|banner-icon|empty-state>span|how-it-works li>span|close-button|spark/;

const source = fs.readFileSync(FILE, 'utf8');
const base = source.includes(BEGIN) ? source.slice(0, source.indexOf(BEGIN)).trimEnd() : source.trimEnd();

/** Minimal parser for flat CSS with one level of @media nesting. */
function parse(css) {
  const rules = [];
  const walk = (text, media) => {
    let k = 0;
    while (k < text.length) {
      const open = text.indexOf('{', k);
      if (open < 0) break;
      const prelude = text.slice(k, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      let depth = 0, close = open;
      for (let j = open; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') { depth--; if (depth === 0) { close = j; break; } }
      }
      const body = text.slice(open + 1, close);
      if (prelude.startsWith('@media')) walk(body, prelude);
      else if (!prelude.startsWith('@')) rules.push({ selector: prelude, body, media });
      k = close + 1;
    }
  };
  walk(css, null);
  return rules;
}

const hexToRgb = hex => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return [0, 2, 4].map(n => parseInt(h.slice(n, n + 2), 16) / 255);
};
const luminance = rgb => {
  const [r, g, b] = rgb.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgbToHsl = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
};
const hslToRgb = ([h, s, l]) => {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
};
const toHex = rgb => '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
function accessible(hex, body = '') {
  const bg = hexToRgb(WORST_BACKGROUND);
  let rgb = hexToRgb(hex);
  // White or very light text is meant for dark buttons and banners; it is not dark-on-light body text.
  if (luminance(rgb) >= 0.6) return null;
  const ownBackground = body.match(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,6})\b/);
  if (ownBackground && luminance(hexToRgb(ownBackground[1])) < 0.2) return null;
  if (ratio(rgb, bg) >= TARGET_RATIO) return null;
  let [h, s, l] = rgbToHsl(rgb);
  while (l > 0 && ratio(hslToRgb([h, s, l]), bg) < TARGET_RATIO) l -= 0.01;
  return toHex(hslToRgb([h, s, Math.max(0, l)]));
}

const prefix = (selector, scope) => selector.split(',').map(part => {
  const item = part.trim();
  return item.startsWith('html') ? item.replace(/^html/, scope) : `${scope} ${item}`;
}).join(',');
const largeSize = px => px < 16 ? Math.max(LARGE_MIN_PX, Math.round(px * 1.3)) : px <= 24 ? Math.round(px * 1.2) : Math.round(px * 1.1);

const defaults = [], large = [];
let darkened = 0, raised = 0;
for (const rule of parse(base)) {
  if (rule.selector.startsWith(':root') || rule.selector.includes('@')) continue;
  const decorative = DECORATIVE.test(rule.selector);
  const declarations = [];
  const color = rule.body.match(/(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,6})\b/);
  if (color && !decorative) {
    const fixed = accessible(color[1], rule.body);
    if (fixed) { declarations.push(`color:${fixed}`); darkened++; }
  }
  const size = rule.body.match(/font-size:\s*([\d.]+)px\s*(!important)?/);
  if (size && !decorative && Number(size[1]) < DEFAULT_MIN_PX) { declarations.push(`font-size:${DEFAULT_MIN_PX}px${size[2] ?? ''}`); raised++; }
  if (declarations.length) defaults.push({ media: rule.media, css: `${prefix(rule.selector, 'html')}{${declarations.join(';')}}` });
  if (size) large.push({ media: rule.media, css: `${prefix(rule.selector, 'html.large-text')}{font-size:${largeSize(Number(size[1]))}px${size[2] ?? ''}}` });
}
const emit = list => {
  const out = [];
  let media = undefined, buffer = [];
  const flush = () => { if (!buffer.length) return; out.push(media ? `${media}{${buffer.join('')}}` : buffer.join('\n')); buffer = []; };
  for (const item of list) { if (item.media !== media) { flush(); media = item.media; } buffer.push(item.css); }
  flush();
  return out.join('\n');
};
const layer = [BEGIN,
  `/* ${darkened} text colours darkened to >= ${TARGET_RATIO}:1 on ${WORST_BACKGROUND}; ${raised} informative sizes raised to ${DEFAULT_MIN_PX}px. */`,
  emit(defaults),
  '/* A+ 大字 mode */',
  'html.large-text body{font-size:19px}',
  emit(large),
  'html.large-text .product-grid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}',
  END].join('\n');
fs.writeFileSync(FILE, `${base}\n${layer}\n`);
console.log(`readability layer: ${darkened} colours, ${raised} sizes, ${large.length} large-text rules`);
