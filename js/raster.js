// Draws a card as a 1-bit bitmap at the printer's resolution (browser only).
import { CARD_W, CARD_H, FONT_SANS, FONT_MONO, WIFI_PATH, layoutCard } from './card.js';

const measureCtx = document.createElement('canvas').getContext('2d');

/** Text width in mm, using the real web fonts. */
export function measure(text, f) {
  measureCtx.font = `${f.weight} 100px ${f.mono ? FONT_MONO : FONT_SANS}`;
  return (measureCtx.measureText(text).width / 100) * f.size + (f.spacing || 0) * text.length;
}

/** Waits until the card fonts are ready, so measuring and drawing are right. */
export async function loadFonts() {
  const want = [
    `500 20px Inter`,
    `700 20px Inter`,
    `800 20px Inter`,
    `800 20px "JetBrains Mono"`,
  ];
  await Promise.all(want.map((f) => document.fonts.load(f, 'Aa0Ωω')));
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Turns the logo into black dots at an exact size in dots.
 * 'dither' keeps light colours as a dot pattern; 'threshold' makes them white or black.
 */
export function logoBits(img, w, h, style = 'dither') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Perceived lightness 0..1
      const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      let black;
      if (style === 'threshold') black = l < 0.5;
      else {
        // Dark colours (like navy text) print solid, near-white prints blank,
        // mid tones (like green) become an even dot pattern.
        if (l > 0.9) black = false;
        else if (l < 0.33) black = true;
        else black = (l - 0.33) / 0.57 < (BAYER4[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      }
      bits[y * w + x] = black ? 1 : 0;
    }
  return bits;
}

/**
 * Renders one card to a 1-bit bitmap.
 * @param {{user: string, pass: string}} v
 * @param {object} s settings
 * @param {{dpmm: number, logo: HTMLImageElement|null, logoStyle?: string,
 *          qr?: {size: number, isDark: Function}|null, logoCache?: Map}} o
 * @returns {{width: number, height: number, bits: Uint8Array}}
 */
export function rasterCard(v, s, o) {
  const k = o.dpmm;
  const W = Math.round(CARD_W * k);
  const H = Math.round(CARD_H * k);
  const logoDims = o.logo ? { w: o.logo.naturalWidth, h: o.logo.naturalHeight } : null;
  const L = layoutCard(v, s, { measure, logo: logoDims, qr: !!o.qr });

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  // Accent bar
  ctx.fillRect(0, 0, W, Math.round(1.4 * k));

  const text = (t, x, y, f, align = 'left') => {
    if (!t) return;
    ctx.font = `${f.weight} ${f.size * k}px ${f.mono ? FONT_MONO : FONT_SANS}`;
    ctx.textAlign = align;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(f.spacing || 0) * k}px`;
    ctx.fillText(t, x * k, y * k);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  };

  const align = (a) => (a === 'end' ? 'right' : 'left');
  text(L.title.text, L.title.x, L.title.y, L.title.font, align(L.title.anchor));
  text(L.subtitle.text, L.subtitle.x, L.subtitle.y, L.subtitle.font, align(L.subtitle.anchor));

  if (L.icon) {
    const s32 = (L.icon.size * k) / 32;
    ctx.save();
    ctx.translate(L.icon.x * k, L.icon.y * k);
    ctx.scale(s32, s32);
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.stroke(new Path2D(WIFI_PATH));
    ctx.beginPath();
    ctx.arc(16, 24, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const b = L.box;
  ctx.lineWidth = Math.max(2, Math.round(0.4 * k));
  ctx.beginPath();
  const inset = ctx.lineWidth / 2;
  ctx.roundRect(b.x * k + inset, b.y * k + inset, b.w * k - 2 * inset, b.h * k - 2 * inset, 2 * k);
  ctx.stroke();
  for (const row of L.rows) {
    text(row.label, row.labelX, row.labelY, row.labelFont);
    text(row.value, row.valueX, row.valueY, row.valueFont);
  }
  text(L.footer.text, L.footer.x, L.footer.y, L.footer.font);

  // Antialiased drawing -> pure black and white.
  const px = ctx.getImageData(0, 0, W, H).data;
  const bits = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) bits[i] = px[i * 4 + 1] < 150 ? 1 : 0;

  // Logo and QR go straight onto the dot grid so they stay sharp.
  if (L.logo && o.logo) {
    const lx = Math.round(L.logo.x * k);
    const ly = Math.round(L.logo.y * k);
    const lw = Math.round(L.logo.w * k);
    const lh = Math.round(L.logo.h * k);
    const key = `${lw}x${lh}:${o.logoStyle}`;
    let lb = o.logoCache?.get(key);
    if (!lb) {
      lb = logoBits(o.logo, lw, lh, o.logoStyle);
      o.logoCache?.set(key, lb);
    }
    for (let y = 0; y < lh; y++)
      for (let x = 0; x < lw; x++) if (lb[y * lw + x]) bits[(ly + y) * W + lx + x] = 1;
  }
  if (L.qr && o.qr) {
    const n = o.qr.size;
    const box = Math.round(L.qr.size * k);
    const m = Math.floor(box / (n + 2));
    const x0 = Math.round(L.qr.x * k) + Math.floor((box - m * n) / 2);
    const y0 = Math.round(L.qr.y * k) + Math.floor((box - m * n) / 2);
    for (let r = 0; r < n; r++)
      for (let cc = 0; cc < n; cc++)
        if (o.qr.isDark(r, cc))
          for (let y = 0; y < m; y++) bits.fill(1, (y0 + r * m + y) * W + x0 + cc * m, (y0 + r * m + y) * W + x0 + cc * m + m);
  }
  return { width: W, height: H, bits };
}

/** Draws a bitmap onto a canvas (for the on-screen thermal preview). */
export function bitmapToCanvas(bmp) {
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(bmp.width, bmp.height);
  for (let i = 0; i < bmp.bits.length; i++) {
    const v = bmp.bits[i] ? 20 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
