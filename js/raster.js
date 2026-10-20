// Draws a card as a 1-bit bitmap at the printer's resolution (browser only).
import { labelGeom, FONT_SANS, FONT_MONO, WIFI_PATH, layoutCard } from './card.js';

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
const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/**
 * The main colours of a logo, as a few flat inks: white first, then up to four others,
 * most used first. The soft edge pixels between colours are too few to count.
 */
function logoInks(px) {
  const bins = new Map();
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235) continue;
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    let b = bins.get(key);
    if (!b) bins.set(key, (b = [0, 0, 0, 0]));
    b[0] += px[i];
    b[1] += px[i + 1];
    b[2] += px[i + 2];
    b[3]++;
    total++;
  }
  const inks = [[255, 255, 255]];
  for (const b of [...bins.values()].sort((a, c) => c[3] - a[3])) {
    if (b[3] < total * 0.02 || inks.length === 5) break;
    const c = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    if (lum(c) > 0.9) continue;
    if (inks.some((k) => dist(k, c) < 4900)) continue;
    inks.push(c);
  }
  return inks;
}
const dist = (a, b) => 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;

/**
 * Turns the logo into black dots at an exact size in dots, for a 203 dpi thermal printer.
 * The logo is drawn 4x larger, each pixel is matched to one of the logo's flat colours, and
 * every printer dot looks at the 16 pixels under it. That keeps edges and thin lines clean
 * instead of ragged. Dark colours print solid. With 'dither', light colours become an even
 * dot pattern with a solid outline; with 'threshold' they are left white.
 */
export function logoBits(img, w, h, style = 'dither') {
  const S = 4;
  const c = document.createElement('canvas');
  c.width = w * S;
  c.height = h * S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const inks = logoInks(px);
  // 1 = solid black, a fraction = share of dots in the pattern, 0 = white.
  const tone = inks.map((k, i) => {
    if (i === 0) return 0;
    const l = lum(k);
    if (l < 0.5) return 1;
    return style === 'threshold' ? 0 : Math.min(0.4, Math.max(0.15, (1 - l) * 0.9));
  });

  // Coverage of each ink under every dot.
  const n = inks.length;
  const cover = new Uint8Array(w * h * n);
  const W = c.width;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const p = [px[i], px[i + 1], px[i + 2]];
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < n; k++) {
        const d = dist(inks[k], p);
        if (d < bd) (bd = d), (best = k);
      }
      cover[(((y / S) | 0) * w + ((x / S) | 0)) * n + best]++;
    }

  // 0 white, 1 solid, 2 pattern area.
  const kind = new Uint8Array(w * h);
  const bits = new Uint8Array(w * h);
  const full = S * S;
  for (let d = 0; d < w * h; d++) {
    let solid = 0;
    let light = 0;
    let lightInk = 0;
    for (let k = 1; k < n; k++) {
      const v = cover[d * n + k];
      if (tone[k] === 1) solid += v;
      else if (tone[k] > 0 && v > light) (light = v), (lightInk = k);
    }
    // A dot 40% covered by a dark colour prints, so thin lines and small text survive.
    if (solid >= full * 0.5) (kind[d] = 1), (bits[d] = 1);
    else if (light && solid + light >= full * 0.5) {
      kind[d] = 2;
      const x = d % w;
      const y = (d / w) | 0;
      bits[d] = tone[lightInk] > (BAYER4[(y % 4) * 4 + (x % 4)] + 0.5) / 16 ? 1 : 0;
    }
  }
  // Light areas get a solid edge where they meet white paper, so their shape stays sharp.
  if (style !== 'threshold')
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = y * w + x;
        if (kind[d] !== 2) continue;
        const white = (xx, yy) => xx < 0 || yy < 0 || xx >= w || yy >= h || kind[yy * w + xx] === 0;
        if (white(x - 1, y) || white(x + 1, y) || white(x, y - 1) || white(x, y + 1)) bits[d] = 1;
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
  const G = labelGeom(s.labelSize);
  const W = Math.round(G.w * k);
  const H = Math.round(G.h * k);
  const logoDims = o.logo ? { w: o.logo.naturalWidth, h: o.logo.naturalHeight } : null;
  const L = layoutCard(v, s, { measure, logo: logoDims, qr: !!o.qr, size: s.labelSize });

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
  ctx.fillRect(0, 0, W, Math.round(G.bar * k));

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
  ctx.roundRect(b.x * k + inset, b.y * k + inset, b.w * k - 2 * inset, b.h * k - 2 * inset, (b.r - 0.2) * k);
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
