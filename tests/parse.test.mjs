import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVouchers, parseBest, parseLines, humanizeExpiry } from '../js/parse.js';

// Made-up vouchers in the layout a FortiGate printout uses.
const FORTI_LINES = `User ID    guest0001
Password abcd2345
Expiration 12 hour(s) and 0 minute(s)

User ID    guest0002
Password efgh6789
Expiration 12 hour(s) and 0 minute(s)
`;
// Same PDF read in drawing order: all labels first, then all values.
const FORTI_STREAM = `User ID\n\nPassword\n\nExpiration\n\nUser ID\n\nPassword\n\nExpiration\n\nguest0001\n\nabcd2345\n\n12 hour(s) and 0 minute(s)\n\nguest0002\n\nefgh6789\n\n12 hour(s) and 0 minute(s)\n`;
// Our own A4 sheet read top-to-bottom: two cards side by side get mixed up.
const SHEET_LINES = `Guest Wi-Fi Guest Wi-Fi\nUSERNAME guest0001 USERNAME guest0002\nPASSWORD abcd2345 PASSWORD efgh6789\n`;
const SHEET_STREAM = `Guest Wi-Fi\nUSERNAME\nguest0001\nPASSWORD\nabcd2345\nConnect\nGuest Wi-Fi\nUSERNAME\nguest0002\nPASSWORD\nefgh6789\n`;

const pairs = (r) => r.vouchers.map((v) => `${v.user}/${v.pass}`);

test('FortiGate text with labels and values on one line', () => {
  const r = parseVouchers(FORTI_LINES);
  assert.deepEqual(pairs(r), ['guest0001/abcd2345', 'guest0002/efgh6789']);
  assert.equal(r.validity, '12 hours');
});

test('picks the reading order that pairs vouchers correctly', () => {
  assert.deepEqual(pairs(parseBest([FORTI_STREAM, FORTI_LINES])), ['guest0001/abcd2345', 'guest0002/efgh6789']);
  assert.deepEqual(pairs(parseBest([SHEET_STREAM, SHEET_LINES])), ['guest0001/abcd2345', 'guest0002/efgh6789']);
});

test('never treats a label word as a username or password', () => {
  for (const v of parseVouchers(FORTI_STREAM).vouchers) {
    assert.doesNotMatch(v.user, /^(id|password|expiration)$/i);
    assert.doesNotMatch(v.pass, /^(id|password|expiration)$/i);
  }
});

test('one voucher per line, CSV or tab separated, header skipped', () => {
  const r = parseLines('username,password\nalice, s3cret\nbob\tpw2\ncarol  pw3\n"dave";"pw4"\n');
  assert.deepEqual(r.map((v) => `${v.user}/${v.pass}`), ['alice/s3cret', 'bob/pw2', 'carol/pw3', 'dave/pw4']);
});

test('code-only vouchers', () => {
  const r = parseVouchers('Voucher code: ABCD-1234\nVoucher code: EFGH-5678\n');
  assert.deepEqual(pairs(r), ['ABCD-1234/', 'EFGH-5678/']);
});

test('removes duplicates', () => {
  const r = parseVouchers('a 1\na 1\nb 2\n');
  assert.deepEqual(pairs(r), ['a/1', 'b/2']);
});

test('expiry in plain words', () => {
  assert.equal(humanizeExpiry('12 hour(s) and 0 minute(s)'), '12 hours');
  assert.equal(humanizeExpiry('1 hour(s) and 30 minute(s)'), '1 hour 30 minutes');
  assert.equal(humanizeExpiry('1 day(s)'), '1 day');
  assert.equal(humanizeExpiry('never'), '');
});
