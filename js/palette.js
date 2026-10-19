// Brand colours from a logo, and a full light/dark theme built from them.
// The maths is plain functions, so it can be tested in Node; only colorsFromImage needs a browser.

/** The theme when there is no logo (or the logo has no colours): navy and teal. */
export const DEFAULT_PALETTE = Object.freeze({ p: '#1f3a68', a: '#12a594', g: null });

// ---------- colour helpers ----------

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]) {
  h = (((h % 360) + 360) % 360) / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const hsl = (hex) => rgbToHsl(hexToRgb(hex));
const fromHsl = (h, s, l) => rgbToHex(hslToRgb([h, clamp(s), clamp(l)]));

/** Mixes two colours: t = 0 gives a, t = 1 gives b. */
export function mix(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}

function luminance(hex) {
  const c = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Makes a colour darker (or lighter) until it reaches the contrast against `bg`. */
function reach(hex, bg, ratio, dir = -1) {
  let [h, s, l] = hsl(hex);
  let out = hex;
  for (let i = 0; i < 100 && contrast(out, bg) < ratio; i++) {
    l = clamp(l + dir * 0.01);
    out = fromHsl(h, s, l);
    if (l <= 0 || l >= 1) break;
  }
  return out;
}

const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(', ')}, ${a})`;

// ---------- reading a logo ----------

/**
 * Finds a logo's brand colours from its pixels (RGBA, as from canvas getImageData).
 * White, black, grey and see-through pixels are left out. Returns
 * {p: main colour, a: second colour or null, g: a grey used in the logo or null},
 * or null when the logo has no real colour (for example a black-and-white logo).
 */
export function paletteFromPixels(data) {
  const BINS = 24; // 15° of hue each
  const hue = Array.from({ length: BINS }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  const grey = Array.from({ length: 10 }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  let solid = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    solid++;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const [h, s, l] = rgbToHsl(rgb);
    const chroma = Math.max(...rgb) - Math.min(...rgb);
    if (l > 0.93 || l < 0.06) continue; // white and black
    const bin = s < 0.22 || chroma < 28 ? grey[Math.min(9, Math.floor(l * 10))] : hue[Math.floor(h / 15) % BINS];
    bin.n++;
    bin.r += rgb[0];
    bin.g += rgb[1];
    bin.b += rgb[2];
  }
  // Groups of neighbouring hues, biggest first.
  const used = new Set();
  const groups = [];
  for (;;) {
    let top = -1;
    for (let i = 0; i < BINS; i++) if (!used.has(i) && hue[i].n && (top < 0 || hue[i].n > hue[top].n)) top = i;
    if (top < 0) break;
    const g = { n: 0, r: 0, g: 0, b: 0, at: top };
    for (const d of [-1, 0, 1]) {
      const i = (top + d + BINS) % BINS;
      if (used.has(i)) continue;
      used.add(i);
      g.n += hue[i].n;
      g.r += hue[i].r;
      g.g += hue[i].g;
      g.b += hue[i].b;
    }
    groups.push(g);
  }
  const colour = (g) => rgbToHex([g.r / g.n, g.g / g.n, g.b / g.n]);
  const first = groups[0];
  // Too few coloured pixels: treat the logo as having no colour.
  if (!first || first.n < Math.max(12, solid * 0.004)) return null;
  const second = groups.slice(1).find((g) => {
    const d = Math.abs(g.at - first.at) % BINS;
    return Math.min(d, BINS - d) >= 2 && g.n >= first.n * 0.06;
  });
  // A grey that is a real part of the logo (not a thin outline), light enough to be a colour of its own.
  const greys = grey.slice(2, 8).filter((b) => b.n >= first.n * 0.15);
  const g = greys.sort((x, y) => y.n - x.n)[0];
  return { p: colour(first), a: second ? colour(second) : null, g: g ? colour(g) : null };
}

/** Reads a loaded <img> and returns its palette (see paletteFromPixels). */
export function paletteFromImage(img) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) return null;
  const k = Math.min(1, 200 / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k));
  c.height = Math.max(1, Math.round(h0 * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  try {
    return paletteFromPixels(ctx.getImageData(0, 0, c.width, c.height).data);
  } catch {
    return null;
  }
}

// ---------- building the theme ----------

/**
 * Decides which colour does what. The darker colour leads (header, buttons, card text);
 * the other one is the accent (highlights, the line under the header, the card's top bar).
 */
export function roles(pal) {
  pal = pal || DEFAULT_PALETTE;
  let p = pal.p;
  let a = pal.a;
  if (a && luminance(a) < luminance(p)) [p, a] = [a, p];
  // The lead colour carries white text, so it must be dark enough.
  const lead = reach(p, '#ffffff', 4.5);
  const [ph, ps, pl] = hsl(lead);
  // One-colour logos: the accent is a brighter shade of the same colour.
  const ui = a || fromHsl(ph, Math.max(ps, 0.6), clamp(pl + 0.2, 0.35, 0.5));
  return {
    lead,
    accent: reach(ui, '#ffffff', 2, -1),
    // On the card a grey from the logo reads better than a second shade of the same colour.
    cardAccent: a || pal.g || ui,
  };
}

/** The colour tokens for light and dark mode, for css/app.css. */
export function themeTokens(pal) {
  const { lead: P, accent: A } = roles(pal);
  const [ph, ps] = hsl(P);
  const [ah, as] = hsl(A);
  const W = '#ffffff';
  const markL = contrast(A, P) >= 2.5 ? A : mix(W, P, 0.25);
  // Greys with a hint of the lead colour (more hint for strong colours, none for grey ones).
  const k = Math.min(1, ps) * 0.7;
  const tint = (sat, l) => fromHsl(ph, sat * k, l);
  const light = {
    brand: P,
    'brand-2': mix(P, W, 0.15),
    accent: A,
    'accent-soft': mix(A, W, 0.9),
    'accent-ink': reach(A, mix(A, W, 0.9), 4.5),
    bg: tint(0.35, 0.96),
    'panel-2': tint(0.4, 0.98),
    line: tint(0.3, 0.915),
    'line-2': tint(0.24, 0.85),
    'row-line': tint(0.3, 0.95),
    text: tint(0.33, 0.13),
    muted: tint(0.14, 0.45),
    faint: tint(0.13, 0.65),
    link: P,
    primary: P,
    'primary-hover': mix(P, W, 0.15),
    selected: tint(0.55, 0.96),
    ring: P,
    focus: A + '66',
    'help-text': tint(0.25, 0.23),
    toast: tint(0.3, 0.16),
    tb1: mix(P, '#000000', 0.25),
    tb2: P,
    tb3: mix(P, W, 0.12),
    desk: tint(0.3, 0.935),
    'top-muted': mix(W, P, 0.22),
    'top-ink': P,
    mark: markL,
    'primary-shadow': rgba(P, 0.2),
  };
  const D = reach(fromHsl(ph, Math.min(ps, 0.75), 0.42), W, 4.5);
  const AD = fromHsl(ah, Math.min(as, 0.8), Math.max(hsl(A)[2], 0.55));
  const panel = tint(0.35, 0.12);
  const dark = {
    brand: fromHsl(ph, Math.min(ps, 0.7), 0.76),
    'brand-2': fromHsl(ph, Math.min(ps, 0.7), 0.82),
    accent: AD,
    'accent-soft': mix(panel, AD, 0.16),
    'accent-ink': fromHsl(ah, Math.min(as, 0.7), 0.78),
    bg: tint(0.4, 0.075),
    panel,
    'panel-2': tint(0.38, 0.1),
    field: tint(0.38, 0.095),
    line: tint(0.3, 0.19),
    'line-2': tint(0.27, 0.25),
    'row-line': tint(0.32, 0.15),
    text: tint(0.35, 0.93),
    muted: tint(0.15, 0.64),
    faint: tint(0.13, 0.44),
    link: fromHsl(ph, Math.min(ps, 0.7), 0.76),
    primary: D,
    'primary-hover': mix(D, W, 0.1),
    selected: mix(panel, D, 0.28),
    ring: fromHsl(ph, Math.min(ps, 0.6), 0.6),
    focus: AD + '55',
    'help-text': tint(0.25, 0.81),
    toast: tint(0.3, 0.21),
    tb1: mix('#050608', P, 0.25),
    tb2: mix('#0a0c10', P, 0.4),
    tb3: mix('#0e1116', P, 0.6),
    desk: tint(0.36, 0.09),
    'top-muted': fromHsl(ph, Math.min(ps, 0.3), 0.8),
    'top-ink': P,
    mark: contrast(AD, mix('#0a0c10', P, 0.4)) >= 2.5 ? AD : '#d6d9de',
    'primary-shadow': 'rgba(0, 0, 0, .3)',
  };
  return { light, dark };
}

const block = (sel, vars) => `${sel} {\n${Object.entries(vars).map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}\n`;

/**
 * The CSS that puts a palette on the page. Its selectors are a little stronger than
 * the ones in app.css, so it wins in light, dark and "follow the system" alike.
 */
export function themeCss(pal) {
  const { light, dark } = themeTokens(pal);
  return (
    block('html:root', light) +
    `@media (prefers-color-scheme: dark) {\n${block('html:root:not([data-theme="light"])', dark)}}\n` +
    block('html:root[data-theme="dark"]', dark)
  );
}

/** The card's own colours for a palette: text colour and accent (top bar). */
export function cardColours(pal) {
  const r = roles(pal);
  return { ink: r.lead, accent: r.cardAccent };
}

/** A favicon in the theme's colours. */
export function faviconFor(pal) {
  const { light } = themeTokens(pal);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='${light.tb2}'/>` +
    `<path d='M7 13.5a13 13 0 0 1 18 0M10.5 17a8 8 0 0 1 11 0M14 20.5a3 3 0 0 1 4 0' stroke='${light.mark}' stroke-width='2.4' fill='none' stroke-linecap='round'/>` +
    `<circle cx='16' cy='24' r='1.8' fill='${light.mark}'/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
