import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteFromPixels, roles, cardColours, themeTokens, themeCss, contrast, DEFAULT_PALETTE } from '../js/palette.js';

// Builds RGBA pixels: [count, '#rrggbb', alpha?] ...
const px = (...parts) => {
  const out = [];
  for (const [n, hex, a = 255] of parts) {
    const v = parseInt(hex.slice(1), 16);
    for (let i = 0; i < n; i++) out.push((v >> 16) & 255, (v >> 8) & 255, v & 255, a);
  }
  return new Uint8ClampedArray(out);
};

test('two-colour logo: the darker colour leads, the other is the accent', () => {
  const pal = paletteFromPixels(px([5000, '#ffffff'], [800, '#002e63'], [250, '#7dba00'], [300, '#000000', 0]));
  assert.equal(pal.p, '#002e63');
  assert.equal(pal.a, '#7dba00');
  assert.deepEqual(cardColours(pal), { ink: '#002e63', accent: '#7dba00' });
});

test('one colour plus grey text: grey becomes the card accent', () => {
  const pal = paletteFromPixels(px([3000, '#ffffff'], [400, '#710030'], [500, '#58595b']));
  assert.equal(pal.p, '#710030');
  assert.equal(pal.a, null);
  assert.equal(pal.g, '#58595b');
  assert.deepEqual(cardColours(pal), { ink: '#710030', accent: '#58595b' });
});

test('black-and-white logo has no colours', () => {
  assert.equal(paletteFromPixels(px([3000, '#ffffff'], [900, '#000000'], [200, '#777777'])), null);
});

test('light brand colours are darkened enough for white text', () => {
  const r = roles({ p: '#ffd400', a: null, g: null }); // bright yellow
  assert.ok(contrast(r.lead, '#ffffff') >= 4.5);
  const { light, dark } = themeTokens({ p: '#ffd400', a: '#00a3e0', g: null });
  assert.ok(contrast(light.primary, '#ffffff') >= 4.5);
  assert.ok(contrast(dark.primary, '#ffffff') >= 4.5);
});

test('theme CSS covers light, dark and follow-the-system', () => {
  const css = themeCss(DEFAULT_PALETTE);
  assert.match(css, /html:root \{/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /html:root\[data-theme="dark"\]/);
});
