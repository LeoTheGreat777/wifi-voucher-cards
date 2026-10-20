import test from 'node:test';
import assert from 'node:assert/strict';
import { bitmapToHexRows, compressRows, decompressRows, labelZpl, DOTS_PER_MM } from '../js/zpl.js';

function bitmap(width, height, fn) {
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bits[y * width + x] = fn(x, y) ? 1 : 0;
  return { width, height, bits };
}

test('packs 8 dots per byte, first dot is the high bit', () => {
  const { rows, bytesPerRow } = bitmapToHexRows(bitmap(12, 1, (x) => x === 0 || x === 9));
  assert.equal(bytesPerRow, 2);
  assert.deepEqual(rows, ['8040']);
});

test('compression uses Zebra repeat letters and row shortcuts', () => {
  assert.equal(compressRows(['0000']), ',');
  assert.equal(compressRows(['FFFF']), '!');
  assert.equal(compressRows(['F000', 'F000']), 'F,:');
  assert.equal(compressRows(['AAAA' + '0'.repeat(4)]), 'JA,');
  // 45 x "C" = g(20)+g(20)... -> h(40) + K(5)
  assert.equal(compressRows(['C'.repeat(45) + 'D']), 'hKCD');
});

test('compression round-trips on a busy label-sized image', () => {
  const bmp = bitmap(720, 400, (x, y) => (x * 7 + y * 13) % 11 < 3 || (y > 100 && y < 140) || (x > 600 && y % 50 < 25));
  const { rows, bytesPerRow } = bitmapToHexRows(bmp);
  const packed = compressRows(rows);
  assert.deepEqual(decompressRows(packed, bytesPerRow), rows);
  assert.ok(packed.length < rows.join('').length);
});

test('label has the ZD421 90 x 50 mm size at 203 dpi', () => {
  const k = DOTS_PER_MM;
  const z = labelZpl(bitmap(90 * k, 50 * k, () => 0), { copies: 2, darkness: 18, name: 'user^01' });
  assert.match(z, /^\^XA/);
  assert.match(z, /\^PW720\n\^LL400/);
  assert.match(z, /\^GFA,36000,36000,90,/);
  assert.match(z, /~SD18/);
  assert.match(z, /\^PQ2\n\^XZ$/);
  assert.match(z, /\^FX user01/); // ^ removed from the comment
});

test('103 x 78 mm labels are 824 x 624 dots and everything fits on them', async () => {
  const { layoutCard, labelGeom } = await import('../js/card.js');
  const G = labelGeom('103x78');
  assert.equal(G.w * DOTS_PER_MM, 824);
  assert.equal(G.h * DOTS_PER_MM, 624);
  const s = { title: 'Guest_WiFi', subtitle: 'Valid for 8 hours', footer: 'Connect to the guest network.', userLabel: 'User ID', passLabel: 'Password' };
  for (const size of ['90x50', '103x78']) {
    const g = labelGeom(size);
    for (const opts of [{}, { logo: { w: 400, h: 150 }, qr: true }]) {
      const L = layoutCard({ user: 'guest0001', pass: 'abcd1234' }, s, { ...opts, size });
      assert.ok(L.box.x + L.box.w <= g.w && L.box.y + L.box.h < L.footer.y, size);
      assert.ok(L.footer.y < g.h, size);
      if (L.qr) assert.ok(L.qr.x + L.qr.size <= g.w && L.qr.y + L.qr.size <= g.h, size);
      if (L.logo) assert.ok(L.logo.x + L.logo.w < L.title.x, size);
    }
  }
});
