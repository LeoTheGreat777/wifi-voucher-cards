import test from 'node:test';
import assert from 'node:assert/strict';
import { count, validityLine, tr, CARD_TEXT } from '../js/i18n.js';

test('plurals, including Romanian "de" from 20', () => {
  assert.equal(count('en', 1, 'voucher'), '1 voucher');
  assert.equal(count('el', 3, 'card'), '3 κάρτες');
  assert.equal(count('ro', 12, 'hour'), '12 ore');
  assert.equal(count('ro', 24, 'hour'), '24 de ore');
  assert.equal(count('ro', 101, 'voucher'), '101 vouchere');
});

test('validity line per language', () => {
  const d = { d: 0, h: 12, m: 0 };
  assert.equal(validityLine('en', d), 'Valid for 12 hours');
  assert.equal(validityLine('el', d), 'Ισχύει για 12 ώρες');
  assert.equal(validityLine('ro', d), 'Valabil timp de 12 ore');
  assert.equal(validityLine('el', { d: 0, h: 1, m: 30 }), 'Ισχύει για 1 ώρα και 30 λεπτά');
});

test('every language has every card text and falls back to English', () => {
  for (const l of ['en', 'el', 'ro']) assert.deepEqual(Object.keys(CARD_TEXT[l]), Object.keys(CARD_TEXT.en));
  assert.equal(tr('el', 'noSuchKey'), 'noSuchKey');
  assert.equal(tr('ro', 'added', { n: '3 vouchere' }), 'Adăugate: 3 vouchere');
});

test('validity menu round trip', async () => {
  const { durationParts, durationFrom } = await import('../js/i18n.js');
  assert.deepEqual(durationParts({ d: 0, h: 12, m: 0 }), { n: 12, unit: 'h' });
  assert.deepEqual(durationParts({ d: 1, h: 12, m: 0 }), { n: 36, unit: 'h' });
  assert.deepEqual(durationParts({ d: 2, h: 0, m: 0 }), { n: 2, unit: 'd' });
  assert.deepEqual(durationParts({ d: 0, h: 1, m: 30 }), { n: 90, unit: 'm' });
  assert.deepEqual(durationParts(null), { n: '', unit: 'none' });
  assert.deepEqual(durationFrom('45', 'm'), { d: 0, h: 0, m: 45 });
  assert.deepEqual(durationFrom(3, 'd'), { d: 3, h: 0, m: 0 });
  assert.equal(durationFrom(12, 'none'), null);
  assert.equal(durationFrom('', 'h'), null);
  assert.equal(validityLine('ro', durationFrom(20, 'm')), 'Valabil timp de 20 de minute');
});
