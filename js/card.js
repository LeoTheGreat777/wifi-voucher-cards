// The card design, as an SVG in millimetres (90 x 50, or 103 x 78 for big Zebra labels).
// One layout feeds every output: the on-screen preview, the A4 sheet,
// the driver print and the ZPL graphic.

export const CARD_W = 90;
export const CARD_H = 50;

/** Where everything goes on each label size, in mm. A4 sheets always use 90 x 50. */
export const SIZES = {
  '90x50': {
    w: 90, h: 50, pad: 4.5, bar: 1.4, barColour: 1.6,
    logo: { y: 3.9, w: 36, h: 10.5 }, headGap: 3,
    logoTitle: { size: 4.6, y: 9.4, yAlone: 11 }, logoSub: { size: 2.5, y: 13.4 },
    icon: { y: 4.1, size: 10 },
    iconTitle: { size: 5.2, y: 9.3, yAlone: 10.9 }, iconSub: { size: 2.6, y: 13.3 },
    titleMin: 2.4, subMin: 1.6,
    box: { y: 17.6, h: 21, r: 2.2 }, qr: 21, qrGap: 2.5,
    label: { size: 2.05, spacing: 0.22 }, labelX: 3.6, labelGap: 3.2, valueEnd: 3,
    value: { two: 5.3, one: 6.4, min: 2 }, rows: [6.4, 14.6], rule: 1.2,
    footer: { size: 2.15, min: 1.4, y: 45.2 },
  },
  '103x78': {
    w: 103, h: 78, pad: 5.5, bar: 1.8, barColour: 2,
    logo: { y: 5, w: 50, h: 17 }, headGap: 3.5,
    logoTitle: { size: 6.2, y: 13, yAlone: 15.4 }, logoSub: { size: 3.2, y: 18.6 },
    icon: { y: 5, size: 15 },
    iconTitle: { size: 7, y: 12.6, yAlone: 15 }, iconSub: { size: 3.4, y: 18.4 },
    titleMin: 3, subMin: 2,
    box: { y: 26, h: 37, r: 2.8 }, qr: 37, qrGap: 3,
    label: { size: 2.7, spacing: 0.28 }, labelX: 4.5, labelGap: 4, valueEnd: 3.8,
    value: { two: 8, one: 9.5, min: 2.6 }, rows: [11, 26], rule: 1.6,
    footer: { size: 2.8, min: 1.8, y: 71.8 },
  },
};

/** The size of a Zebra label, from the settings. */
export const labelGeom = (key) => SIZES[key] || SIZES['90x50'];

export const FONT_SANS = "Inter, 'Segoe UI', Arial, sans-serif";
export const FONT_MONO = "'JetBrains Mono', Consolas, 'Courier New', monospace";

const MUTED = '#5f6b7a';

/** Wi-Fi arcs drawn in a 32 x 32 box (dot at 16,24). Used when a card has no logo. */
export const WIFI_PATH = 'M6 13.5a14 14 0 0 1 20 0M9.8 17.3a8.6 8.6 0 0 1 12.4 0M13.5 21a3.4 3.4 0 0 1 5 0';
const BOX_FILL = '#eef3f8';

/**
 * Measures text width in mm.
 * @callback Measure
 * @param {string} text
 * @param {{mono?: boolean, weight: number, size: number, spacing?: number}} font
 * @returns {number}
 */

/** Rough fallback measurer, used when no canvas is available (tests). */
export const roughMeasure = (text, f) =>
  text.length * f.size * (f.mono ? 0.6 : 0.56) + (f.spacing || 0) * text.length;

/** Largest font size (up to `size`) at which `text` fits in `maxW`. */
export function fitSize(measure, text, font, maxW, minSize = 0) {
  if (!text) return font.size;
  const w = measure(text, font);
  if (w <= maxW) return font.size;
  return Math.max(minSize, (font.size * maxW) / w);
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const r = (n) => Math.round(n * 1000) / 1000;

/**
 * Works out where everything goes. Returned numbers are in mm.
 * @param {{user: string, pass: string}} v
 * @param {object} s settings
 * @param {{measure?: Measure, logo?: {w: number, h: number} | null, qr?: boolean}} o
 */
export function layoutCard(v, s, o = {}) {
  const measure = o.measure || roughMeasure;
  const G = labelGeom(o.size);
  const W = G.w;
  const PAD = G.pad;
  const L = { G, w: W, h: G.h };

  // Logo, top left, fitted in its box (36 x 10.5 mm on the small label).
  if (o.logo && o.logo.w && o.logo.h) {
    const k = Math.min(G.logo.w / o.logo.w, G.logo.h / o.logo.h);
    L.logo = { x: PAD, y: G.logo.y, w: o.logo.w * k, h: o.logo.h * k };
  }
  const hasSub = !!(s.subtitle || '').trim();
  if (L.logo) {
    // Logo on the left, title and validity right-aligned.
    const headW = W - PAD - (L.logo.x + L.logo.w + G.headGap);
    const titleFont = { weight: 800, size: G.logoTitle.size };
    titleFont.size = fitSize(measure, s.title, titleFont, headW, G.titleMin);
    const subFont = { weight: 500, size: G.logoSub.size };
    subFont.size = fitSize(measure, s.subtitle, subFont, headW, G.subMin);
    L.title = { x: W - PAD, y: hasSub ? G.logoTitle.y : G.logoTitle.yAlone, font: titleFont, text: s.title || '', anchor: 'end' };
    L.subtitle = { x: W - PAD, y: G.logoSub.y, font: subFont, text: s.subtitle || '', anchor: 'end' };
  } else {
    // No logo: a Wi-Fi sign, with the title and validity next to it on the left.
    L.icon = { x: PAD, y: G.icon.y, size: G.icon.size };
    const x = PAD + L.icon.size + G.headGap;
    const headW = W - PAD - x;
    const titleFont = { weight: 800, size: G.iconTitle.size };
    titleFont.size = fitSize(measure, s.title, titleFont, headW, G.titleMin);
    const subFont = { weight: 500, size: G.iconSub.size };
    subFont.size = fitSize(measure, s.subtitle, subFont, headW, G.subMin);
    L.title = { x, y: hasSub ? G.iconTitle.y : G.iconTitle.yAlone, font: titleFont, text: s.title || '', anchor: 'start' };
    L.subtitle = { x, y: G.iconSub.y, font: subFont, text: s.subtitle || '', anchor: 'start' };
  }

  // Credentials box.
  const qrSize = o.qr ? G.qr : 0;
  const box = { x: PAD, y: G.box.y, w: W - 2 * PAD - (o.qr ? qrSize + G.qrGap : 0), h: G.box.h, r: G.box.r };
  L.box = box;
  if (o.qr) L.qr = { x: W - PAD - qrSize, y: box.y, size: qrSize };

  const labelFont = { weight: 700, ...G.label };
  const rows = [];
  const hasPass = !!(v.pass || '').length;
  if (hasPass) {
    rows.push({ label: s.userLabel || '', value: v.user });
    rows.push({ label: s.passLabel || '', value: v.pass });
  } else {
    rows.push({ label: s.codeLabel || '', value: v.user });
  }
  const labelW = Math.max(0, ...rows.map((x) => (x.label ? measure(x.label, labelFont) : 0)));
  const valueX = box.x + G.labelX + (labelW ? labelW + G.labelGap : 0);
  const valueMax = box.x + box.w - G.valueEnd - valueX;
  const baseValue = hasPass ? G.value.two : G.value.one;
  // Same size for both rows so they line up.
  const valueSize = Math.min(
    ...rows.map((x) => fitSize(measure, x.value, { mono: true, weight: 800, size: baseValue }, valueMax, G.value.min))
  );
  const centers = hasPass ? G.rows.map((y) => box.y + y) : [box.y + box.h / 2];
  L.rows = rows.map((x, i) => ({
    label: x.label,
    value: x.value,
    labelX: box.x + G.labelX,
    valueX,
    // Baselines: cap height is ~0.73 em, so this centres the text on the line.
    labelY: centers[i] + labelFont.size * 0.36,
    valueY: centers[i] + valueSize * 0.36,
    labelFont,
    valueFont: { mono: true, weight: 800, size: valueSize },
  }));

  const footFont = { weight: 500, size: G.footer.size };
  footFont.size = fitSize(measure, s.footer, footFont, W - 2 * PAD, G.footer.min);
  L.footer = { x: PAD, y: G.footer.y, font: footFont, text: s.footer || '' };
  return L;
}

/**
 * Builds the SVG markup for one card.
 * @param {{user: string, pass: string}} v
 * @param {object} s settings: title, subtitle, footer, userLabel, passLabel, codeLabel, accent, ink
 * @param {{mode?: 'color'|'mono', measure?: Measure,
 *          logo?: {href: string, w: number, h: number} | null,
 *          qr?: {size: number, isDark: (r: number, c: number) => boolean} | null,
 *          omitLogo?: boolean, omitQr?: boolean, fontCss?: string,
 *          width?: string, height?: string, className?: string}} o
 */
export function cardSvg(v, s, o = {}) {
  const mono = o.mode === 'mono';
  const ink = mono ? '#000' : s.ink || '#1f3a68';
  const muted = mono ? '#000' : MUTED;
  const accent = mono ? '#000' : s.accent || '#12a594';
  const L = layoutCard(v, s, { measure: o.measure, logo: o.logo, qr: !!o.qr, size: o.size });
  const { G, w: CW, h: CH } = L;
  const parts = [];
  const w = o.width ?? `${CW}mm`;
  const h = o.height ?? `${CH}mm`;
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `viewBox="0 0 ${CW} ${CH}" width="${w}" height="${h}"` +
      (o.className ? ` class="${o.className}"` : '') +
      ` font-family="${esc(FONT_SANS)}">`
  );
  if (o.fontCss) parts.push(`<style>${o.fontCss}</style>`);
  parts.push(`<rect width="${CW}" height="${CH}" fill="#fff"/>`);
  parts.push(`<rect width="${CW}" height="${mono ? G.bar : G.barColour}" fill="${accent}"/>`);

  if (L.logo && o.logo && !o.omitLogo) {
    parts.push(
      `<image href="${esc(o.logo.href)}" x="${r(L.logo.x)}" y="${r(L.logo.y)}" ` +
        `width="${r(L.logo.w)}" height="${r(L.logo.h)}" preserveAspectRatio="xMinYMid meet"` +
        (mono ? ' style="filter:grayscale(1)"' : '') +
        '/>'
    );
  }

  const text = (t, x, y, f, fill, anchor = 'start', extra = '') =>
    t
      ? `<text x="${r(x)}" y="${r(y)}" font-size="${r(f.size)}" font-weight="${f.weight}" fill="${fill}"` +
        (f.mono ? ` font-family="${esc(FONT_MONO)}"` : '') +
        (f.spacing ? ` letter-spacing="${f.spacing}"` : '') +
        (anchor !== 'start' ? ` text-anchor="${anchor}"` : '') +
        `${extra}>${esc(t)}</text>`
      : '';

  if (L.icon) {
    const ic = L.icon;
    const k = ic.size / 32;
    parts.push(
      `<g transform="translate(${r(ic.x)} ${r(ic.y)}) scale(${r(k)})">` +
        (mono ? '' : `<rect width="32" height="32" rx="8" fill="${ink}"/>`) +
        `<path d="${WIFI_PATH}" stroke="${mono ? '#000' : accent}" stroke-width="${mono ? 3.2 : 2.6}" fill="none" stroke-linecap="round"/>` +
        `<circle cx="16" cy="24" r="${mono ? 2.4 : 2}" fill="${mono ? '#000' : accent}"/></g>`
    );
  }
  parts.push(text(L.title.text, L.title.x, L.title.y, L.title.font, ink, L.title.anchor));
  parts.push(text(L.subtitle.text, L.subtitle.x, L.subtitle.y, L.subtitle.font, muted, L.subtitle.anchor));

  const b = L.box;
  parts.push(
    mono
      ? `<rect x="${r(b.x + 0.2)}" y="${r(b.y + 0.2)}" width="${r(b.w - 0.4)}" height="${r(b.h - 0.4)}" rx="${r(b.r - 0.2)}" fill="none" stroke="#000" stroke-width="0.4"/>`
      : `<rect x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" rx="${b.r}" fill="${BOX_FILL}"/>`
  );
  for (const row of L.rows) {
    parts.push(text(row.label, row.labelX, row.labelY, row.labelFont, muted));
    parts.push(text(row.value, row.valueX, row.valueY, row.valueFont, ink, 'start', ' xml:space="preserve"'));
  }
  if (L.rows.length === 2 && !mono) {
    const y = (L.rows[0].valueY + L.rows[1].labelY) / 2 - G.rule;
    parts.push(
      `<line x1="${r(b.x + G.labelX)}" x2="${r(b.x + b.w - G.labelX)}" y1="${r(y)}" y2="${r(y)}" stroke="#d7e0ea" stroke-width="0.2"/>`
    );
  }

  if (L.qr && o.qr && !o.omitQr) {
    const n = o.qr.size;
    const m = L.qr.size / (n + 2); // one module of quiet zone on each side
    const x0 = L.qr.x + m;
    const y0 = L.qr.y + m;
    let d = '';
    for (let rr = 0; rr < n; rr++)
      for (let c = 0; c < n; c++) if (o.qr.isDark(rr, c)) d += `M${r(x0 + c * m)} ${r(y0 + rr * m)}h${r(m)}v${r(m)}h-${r(m)}z`;
    parts.push(`<path d="${d}" fill="${mono ? '#000' : ink}" shape-rendering="crispEdges"/>`);
  }

  parts.push(text(L.footer.text, L.footer.x, L.footer.y, L.footer.font, muted));
  parts.push('</svg>');
  return parts.join('');
}

// ---------- A4 sheet: 2 x 5 cards, cut lines like a business-card sheet ----------

export const A4 = { w: 210, h: 297, cols: 2, rows: 5 };
A4.perPage = A4.cols * A4.rows;
A4.x0 = (A4.w - A4.cols * CARD_W) / 2; // 15 mm
A4.y0 = (A4.h - A4.rows * CARD_H) / 2; // 23.5 mm

/**
 * One A4 page as SVG (viewBox in mm) holding up to 10 cards.
 * @param {Array<{user: string, pass: string}>} cards
 * @param {object} s settings
 * @param {object} o same options as cardSvg (mode is always colour)
 */
export function sheetSvg(cards, s, o = {}) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${A4.w} ${A4.h}" width="${o.width ?? '210mm'}" height="${o.height ?? '297mm'}" font-family="${esc(FONT_SANS)}">`,
    `<rect width="${A4.w}" height="${A4.h}" fill="#fff"/>`,
  ];
  cards.slice(0, A4.perPage).forEach((v, i) => {
    const x = A4.x0 + (i % A4.cols) * CARD_W;
    const y = A4.y0 + Math.floor(i / A4.cols) * CARD_H;
    const inner = cardSvg(v, s, { ...o, mode: 'color', width: String(CARD_W), height: String(CARD_H) });
    parts.push(`<g transform="translate(${r(x)} ${r(y)})">${inner}</g>`);
  });
  // Cut lines run edge to edge so they can be lined up on a guillotine.
  const dash = 'stroke="#8d98a6" stroke-width="0.2" stroke-dasharray="1.2 1.2"';
  for (let c = 0; c <= A4.cols; c++) {
    const x = r(A4.x0 + c * CARD_W);
    parts.push(`<line x1="${x}" x2="${x}" y1="0" y2="${A4.h}" ${dash}/>`);
  }
  for (let rr = 0; rr <= A4.rows; rr++) {
    const y = r(A4.y0 + rr * CARD_H);
    parts.push(`<line x1="0" x2="${A4.w}" y1="${y}" y2="${y}" ${dash}/>`);
  }
  parts.push(
    `<text x="${A4.x0 + 3}" y="${A4.h - 8}" font-size="2.4" fill="#8d98a6">${esc(o.cutNote ?? '✂  Cut along the dashed lines  •  Print at 100% / Actual size')}</text>`
  );
  if (o.pageLabel) parts.push(`<text x="${A4.w - A4.x0 - 3}" y="${A4.h - 8}" font-size="2.4" fill="#8d98a6" text-anchor="end">${esc(o.pageLabel)}</text>`);
  parts.push('</svg>');
  return parts.join('');
}
