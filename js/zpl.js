// ZPL output for Zebra printers. Each card is sent as one 1-bit graphic,
// so the label prints exactly like the on-screen thermal preview.
// Pure functions only, so they can be tested in Node.

/**
 * A 1-bit image: `bits[y * width + x]` is 1 for a black dot.
 * @typedef {{width: number, height: number, bits: Uint8Array}} Bitmap
 */

const HEX = '0123456789ABCDEF';

/** Packs a bitmap into rows of hex characters (8 dots per byte, MSB first). */
export function bitmapToHexRows(bmp) {
  const bytesPerRow = Math.ceil(bmp.width / 8);
  const rows = [];
  for (let y = 0; y < bmp.height; y++) {
    let row = '';
    for (let b = 0; b < bytesPerRow; b++) {
      let byte = 0;
      for (let i = 0; i < 8; i++) {
        const x = b * 8 + i;
        if (x < bmp.width && bmp.bits[y * bmp.width + x]) byte |= 0x80 >> i;
      }
      row += HEX[byte >> 4] + HEX[byte & 15];
    }
    rows.push(row);
  }
  return { rows, bytesPerRow };
}

/** Zebra repeat-count prefix: G-Y = 1-19, g-z = 20-400 (in steps of 20). */
function repeatPrefix(n) {
  let s = '';
  while (n >= 400) {
    s += 'z';
    n -= 400;
  }
  if (n >= 20) {
    s += String.fromCharCode('g'.charCodeAt(0) + Math.floor(n / 20) - 1);
    n %= 20;
  }
  if (n > 0) s += String.fromCharCode('G'.charCodeAt(0) + n - 1);
  return s;
}

/** Run-length encodes one hex row; a single character needs no prefix. */
function rle(row) {
  let out = '';
  let i = 0;
  while (i < row.length) {
    const c = row[i];
    let j = i + 1;
    while (j < row.length && row[j] === c) j++;
    const n = j - i;
    out += n === 1 ? c : repeatPrefix(n) + c;
    i = j;
  }
  return out;
}

/**
 * Zebra "compressed ASCII" (ACS) for ^GFA:
 *  ':' repeats the previous row, ',' fills the rest of a row with 0,
 *  '!' fills the rest with 1, letters are repeat counts.
 */
export function compressRows(rows) {
  let out = '';
  let prev = null;
  for (const row of rows) {
    if (row === prev) {
      out += ':';
      continue;
    }
    prev = row;
    const trimmedZero = row.replace(/0+$/, '');
    const trimmedOne = row.replace(/F+$/, '');
    if (!trimmedZero.length) out += ',';
    else if (!trimmedOne.length) out += '!';
    else if (trimmedZero.length < row.length) out += rle(trimmedZero) + ',';
    else if (trimmedOne.length < row.length) out += rle(trimmedOne) + '!';
    else out += rle(row);
  }
  return out;
}

/** Decodes ACS data back into hex rows (used by the tests). */
export function decompressRows(data, bytesPerRow) {
  const width = bytesPerRow * 2;
  const rows = [];
  let row = '';
  let count = 0;
  const flush = () => {
    rows.push(row);
    row = '';
  };
  for (const ch of data) {
    if (ch >= 'G' && ch <= 'Y') count += ch.charCodeAt(0) - 70;
    else if (ch >= 'g' && ch <= 'z') count += (ch.charCodeAt(0) - 102) * 20;
    else if (ch === ':') {
      rows.push(rows[rows.length - 1]);
    } else if (ch === ',' || ch === '!') {
      row = row.padEnd(width, ch === ',' ? '0' : 'F');
      flush();
    } else {
      row += ch.repeat(count || 1);
      count = 0;
      if (row.length >= width) flush();
    }
  }
  return rows;
}

/** One ^GFA field for a bitmap, compressed. */
export function graphicField(bmp) {
  const { rows, bytesPerRow } = bitmapToHexRows(bmp);
  const total = bytesPerRow * bmp.height;
  return `^GFA,${total},${total},${bytesPerRow},${compressRows(rows)}`;
}

/**
 * A complete label format for one card.
 * @param {Bitmap} bmp
 * @param {{offsetX?: number, offsetY?: number, darkness?: number|null,
 *          speed?: number|null, copies?: number, name?: string}} opts
 *   offsets are in dots; darkness 0-30; speed in inches per second.
 */
export function labelZpl(bmp, opts = {}) {
  const lines = ['^XA'];
  if (opts.name) lines.push(`^FX ${opts.name.replace(/[\^~]/g, '')}`);
  lines.push('^CI28', `^PW${bmp.width}`, `^LL${bmp.height}`);
  lines.push(`^LH${Math.round(opts.offsetX || 0)},${Math.round(opts.offsetY || 0)}`);
  if (opts.speed) lines.push(`^PR${opts.speed}`);
  if (opts.darkness != null && opts.darkness !== '') lines.push(`~SD${String(opts.darkness).padStart(2, '0')}`);
  lines.push(`^FO0,0${graphicField(bmp)}^FS`);
  lines.push(`^PQ${Math.max(1, opts.copies || 1)}`, '^XZ');
  return lines.join('\n');
}

/** The ZD421 prints at 203 dpi: 8 dots per mm. */
export const DOTS_PER_MM = 8;
