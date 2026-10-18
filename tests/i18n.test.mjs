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
