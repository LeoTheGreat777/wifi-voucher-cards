// The card design, as an SVG in millimetres (90 x 50).
// One layout feeds every output: the on-screen preview, the A4 sheet,
// the driver print and the ZPL graphic.

export const CARD_W = 90;
export const CARD_H = 50;
export const PAD = 4.5;

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
  const L = {};

  // Logo, top left, fitted in a 36 x 10.5 box.
  if (o.logo && o.logo.w && o.logo.h) {
    const maxW = 36;
    const maxH = 10.5;
    const k = Math.min(maxW / o.logo.w, maxH / o.logo.h);
    L.logo = { x: PAD, y: 3.9, w: o.logo.w * k, h: o.logo.h * k };
  }
  const hasSub = !!(s.subtitle || '').trim();
  if (L.logo) {
    // Logo on the left, title and validity right-aligned.
    const headW = CARD_W - PAD - (L.logo.x + L.logo.w + 3);
    const titleFont = { weight: 800, size: 4.6 };
    titleFont.size = fitSize(measure, s.title, titleFont, headW, 2.4);
    const subFont = { weight: 500, size: 2.5 };
    subFont.size = fitSize(measure, s.subtitle, subFont, headW, 1.6);
    L.title = { x: CARD_W - PAD, y: hasSub ? 9.4 : 11, font: titleFont, text: s.title || '', anchor: 'end' };
    L.subtitle = { x: CARD_W - PAD, y: 13.4, font: subFont, text: s.subtitle || '', anchor: 'end' };
  } else {
    // No logo: a Wi-Fi sign, with the title and validity next to it on the left.
    L.icon = { x: PAD, y: 4.1, size: 10 };
    const x = PAD + L.icon.size + 3;
    const headW = CARD_W - PAD - x;
    const titleFont = { weight: 800, size: 5.2 };
    titleFont.size = fitSize(measure, s.title, titleFont, headW, 2.4);
    const subFont = { weight: 500, size: 2.6 };
    subFont.size = fitSize(measure, s.subtitle, subFont, headW, 1.6);
    L.title = { x, y: hasSub ? 9.3 : 10.9, font: titleFont, text: s.title || '', anchor: 'start' };
    L.subtitle = { x, y: 13.3, font: subFont, text: s.subtitle || '', anchor: 'start' };
  }

  // Credentials box.
  const qrSize = o.qr ? 21 : 0;
  const box = { x: PAD, y: 17.6, w: CARD_W - 2 * PAD - (o.qr ? qrSize + 2.5 : 0), h: 21 };
  L.box = box;
  if (o.qr) L.qr = { x: CARD_W - PAD - qrSize, y: box.y, size: qrSize };

  const labelFont = { weight: 700, size: 2.05, spacing: 0.22 };
  const rows = [];
  const hasPass = !!(v.pass || '').length;
  if (hasPass) {
    rows.push({ label: s.userLabel || '', value: v.user });
    rows.push({ label: s.passLabel || '', value: v.pass });
  } else {
    rows.push({ label: s.codeLabel || '', value: v.user });
  }
  const labelW = Math.max(0, ...rows.map((x) => (x.label ? measure(x.label, labelFont) : 0)));
  const valueX = box.x + 3.6 + (labelW ? labelW + 3.2 : 0);
  const valueMax = box.x + box.w - 3 - valueX;
  const baseValue = hasPass ? 5.3 : 6.4;
  // Same size for both rows so they line up.
  const valueSize = Math.min(
    ...rows.map((x) => fitSize(measure, x.value, { mono: true, weight: 800, size: baseValue }, valueMax, 2))
  );
  const centers = hasPass ? [box.y + 6.4, box.y + 14.6] : [box.y + box.h / 2];
  L.rows = rows.map((x, i) => ({
    label: x.label,
    value: x.value,
    labelX: box.x + 3.6,
    valueX,
    // Baselines: cap height is ~0.73 em, so this centres the text on the line.
    labelY: centers[i] + labelFont.size * 0.36,
    valueY: centers[i] + valueSize * 0.36,
    labelFont,
    valueFont: { mono: true, weight: 800, size: valueSize },
  }));

  const footFont = { weight: 500, size: 2.15 };
  footFont.size = fitSize(measure, s.footer, footFont, CARD_W - 2 * PAD, 1.4);
  L.footer = { x: PAD, y: 45.2, font: footFont, text: s.footer || '' };
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
  const L = layoutCard(v, s, { measure: o.measure, logo: o.logo, qr: !!o.qr });
  const parts = [];
  const w = o.width ?? `${CARD_W}mm`;
  const h = o.height ?? `${CARD_H}mm`;
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `viewBox="0 0 ${CARD_W} ${CARD_H}" width="${w}" height="${h}"` +
      (o.className ? ` class="${o.className}"` : '') +
      ` font-family="${esc(FONT_SANS)}">`
  );
  if (o.fontCss) parts.push(`<style>${o.fontCss}</style>`);
  parts.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="#fff"/>`);
  parts.push(`<rect width="${CARD_W}" height="${mono ? 1.4 : 1.6}" fill="${accent}"/>`);

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
      ? `<rect x="${r(b.x + 0.2)}" y="${r(b.y + 0.2)}" width="${r(b.w - 0.4)}" height="${r(b.h - 0.4)}" rx="2" fill="none" stroke="#000" stroke-width="0.4"/>`
      : `<rect x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" rx="2.2" fill="${BOX_FILL}"/>`
  );
  for (const row of L.rows) {
    parts.push(text(row.label, row.labelX, row.labelY, row.labelFont, muted));
    parts.push(text(row.value, row.valueX, row.valueY, row.valueFont, ink, 'start', ' xml:space="preserve"'));
  }
  if (L.rows.length === 2 && !mono) {
    const y = (L.rows[0].valueY + L.rows[1].labelY) / 2 - 1.2;
    parts.push(
      `<line x1="${r(b.x + 3.6)}" x2="${r(b.x + b.w - 3.6)}" y1="${r(y)}" y2="${r(y)}" stroke="#d7e0ea" stroke-width="0.2"/>`
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
