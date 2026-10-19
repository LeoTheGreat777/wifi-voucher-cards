import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVouchers, parseBest, parseLines, parseDuration } from '../js/parse.js';

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
  assert.deepEqual(r.validity, { d: 0, h: 12, m: 0 });
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

test('reads durations in English, Greek and Romanian', () => {
  assert.deepEqual(parseDuration('12 hour(s) and 0 minute(s)'), { d: 0, h: 12, m: 0 });
  assert.deepEqual(parseDuration('1 hour(s) and 30 minute(s)'), { d: 0, h: 1, m: 30 });
  assert.deepEqual(parseDuration('1 day(s)'), { d: 1, h: 0, m: 0 });
  assert.deepEqual(parseDuration('12 ώρα(ες) και 0 λεπτό(ά)'), { d: 0, h: 12, m: 0 });
  assert.deepEqual(parseDuration('1 oră și 30 de minute'), { d: 0, h: 1, m: 30 });
  assert.deepEqual(parseDuration('12 ore'), { d: 0, h: 12, m: 0 });
  assert.equal(parseDuration('never'), null);
});

test('Greek and Romanian labels', () => {
  assert.deepEqual(pairs(parseVouchers('Όνομα χρήστη: guest01\nΚωδικός πρόσβασης: abc123\n')), ['guest01/abc123']);
  assert.deepEqual(pairs(parseVouchers('Utilizator guest02\nParolă xyz789\nExpirare 12 ore\n')), ['guest02/xyz789']);
});

test('UniFi codes, with the duration printed next to them', () => {
  const r = parseVouchers('WiFi Voucher\n12345-67890\nValid for 8 hours\nWiFi Voucher\n23456-78901\nValid for 8 hours\n');
  assert.deepEqual(pairs(r), ['12345-67890/', '23456-78901/']);
  assert.deepEqual(r.validity, { d: 0, h: 8, m: 0 });
});

test('CSV with a header row: picks the right columns', () => {
  const opn = parseVouchers('username,password,vouchergroup,expirytime,validity\n"jKq3sP","XyZ9ab","Lobby","0","28800"\n"mN4tRw","PqR7cd","Lobby","0","28800"\n');
  assert.deepEqual(pairs(opn), ['jKq3sP/XyZ9ab', 'mN4tRw/PqR7cd']);
  const cisco = parseVouchers('User Name,Password,Lifetime,WLAN SSID\nguest01,Ab3dEf,1 day,Guest\n');
  assert.deepEqual(pairs(cisco), ['guest01/Ab3dEf']);
  const codes = parseVouchers('Code;Type;Duration\n482913;Limited Usage;8 hours\n771045;Limited Usage;8 hours\n');
  assert.deepEqual(pairs(codes), ['482913/', '771045/']);
  assert.deepEqual(codes.validity, { d: 0, h: 8, m: 0 });
});

test('pfSense voucher roll: comments skipped, quotes removed', () => {
  const r = parseVouchers('# Voucher Tickets 1..2 for Roll 1\n# Generated on Mon\n"7gQkYzR2Wa"\n"bP3sXhN8cD"\n');
  assert.deepEqual(pairs(r), ['7gQkYzR2Wa/', 'bP3sXhN8cD/']);
});
