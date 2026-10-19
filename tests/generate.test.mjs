import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCode, makeVouchers, strength, activeSets, LOOK_ALIKE, SETS, GEN_DEFAULTS } from '../js/generate.js';

test('codes have the right length and characters', () => {
  for (let i = 0; i < 300; i++) {
    const c = makeCode({ length: 10, mode: 'all', upper: true, lower: true, digits: true, symbols: true });
    assert.equal(c.length, 10);
    assert.match(c, /[A-Z]/);
    assert.match(c, /[a-z]/);
    assert.match(c, /[0-9]/);
    assert.ok([...c].some((ch) => SETS.symbols.includes(ch)));
  }
});

test('easy to read leaves out look-alikes, easy to say uses letters only', () => {
  const read = activeSets({ mode: 'read', upper: true, lower: true, digits: true }).join('');
  for (const ch of LOOK_ALIKE) assert.ok(!read.includes(ch), ch);
  for (let i = 0; i < 200; i++) {
    assert.match(makeCode({ length: 12, mode: 'say', lower: true, upper: true, digits: true, symbols: true }), /^[A-Za-z]{12}$/);
  }
});

test('nothing chosen falls back to lowercase', () => {
  assert.match(makeCode({ length: 8, mode: 'all' }), /^[a-z]{8}$/);
});

test('numbered usernames skip ones already in the list and never repeat', () => {
  const list = makeVouchers({ ...GEN_DEFAULTS, count: 5, start: 1 }, new Set(['guest0002']));
  assert.deepEqual(list.map((v) => v.user), ['guest0001', 'guest0003', 'guest0004', 'guest0005', 'guest0006']);
  const rnd = makeVouchers({ ...GEN_DEFAULTS, count: 500, userMode: 'random' });
  assert.equal(new Set(rnd.map((v) => v.user)).size, 500);
  for (const v of rnd) assert.match(v.pass, /^[A-Za-z0-9]{8}$/);
});

test('strength rating', () => {
  assert.equal(strength({ length: 4, mode: 'read', lower: true }).level, 'weak');
  assert.equal(strength({ ...GEN_DEFAULTS }).level, 'fair');
  assert.equal(strength({ length: 16, mode: 'all', upper: true, lower: true, digits: true, symbols: true }).level, 'strong');
});
