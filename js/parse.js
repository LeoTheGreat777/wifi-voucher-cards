// Turns text (from a PDF, CSV or a paste) into a list of vouchers.
// Pure functions only, so they can be tested in Node.

const USER_LABEL = String.raw`(?:user\s*-?\s*id|user\s*name|username|user|login|όνομα\s+χρήστη|αναγνωριστικό\s+χρήστη|χρήστης|id\s+utilizator|nume\s+(?:de\s+)?utilizator|utilizator)`;
const PASS_LABEL = String.raw`(?:pass\s*word|password|passcode|pass|pwd|pin|κωδικός(?:\s+πρόσβασης)?|parol[aă])`;
const EXPIRY_LABEL = String.raw`(?:expiration|expires|expiry|validity|valid\s+for|duration|λήξη|διάρκεια|ισχύς|expirare|valabilitate|durat[aă])`;
const SEP = String.raw`(?![\p{L}\p{N}])\s*[:=]?\s*`;
const B = String.raw`(?<![\p{L}\p{N}])`; // start of a word
const TOKEN = String.raw`([^\s,;]+)`;
const LABEL_WORD = new RegExp(`^(?:${USER_LABEL}|${PASS_LABEL}|${EXPIRY_LABEL}|id|name|code|voucher)[:=]?$`, 'iu');

/**
 * @typedef {{user: string, pass: string, expiry?: string}} Voucher
 */

/** Finds "User ID x Password y [Expiration z]" groups, in reading order. */
export function parseLabeled(text) {
  const re = new RegExp(
    `${B}${USER_LABEL}${SEP}${TOKEN}\\s+${B}${PASS_LABEL}${SEP}${TOKEN}` +
      `(?:\\s+${B}${EXPIRY_LABEL}${SEP}((?:(?!${B}${USER_LABEL}(?![\\p{L}\\p{N}]))[^\\n])*))?`,
    'giu'
  );
  const out = [];
  for (const m of text.matchAll(re)) {
    // A label word where the value should be means the text is out of order.
    if (LABEL_WORD.test(m[1]) || LABEL_WORD.test(m[2])) continue;
    const v = { user: m[1], pass: m[2] };
    if (m[3] && m[3].trim()) v.expiry = m[3].trim();
    out.push(v);
  }
  return out;
}

/** Finds vouchers that only have a code ("Voucher code: ABCD-1234"). */
export function parseCodesOnly(text) {
  const re = /(?<![\p{L}\p{N}])(?:voucher(?:\s*code)?|access\s*code|code)(?![\p{L}\p{N}])\s*[:=#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/giu;
  return [...text.matchAll(re)].map((m) => ({ user: m[1], pass: '' }));
}

/**
 * One voucher per line: "user pass", "user,pass", "user;pass" or "user<TAB>pass".
 * A line with a single token becomes a code-only voucher.
 */
export function parseLines(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line
      .split(/\s*[,;\t]\s*|\s+/)
      .map((p) => p.replace(/^["']|["']$/g, ''))
      .filter(Boolean);
    if (!parts.length) continue;
    if (parts.every((p) => LABEL_WORD.test(p))) continue; // header row or a label on its own
    out.push({ user: parts[0], pass: parts[1] ?? '' });
  }
  return out;
}

/** Removes repeats of the same user + password, keeping the first. */
export function dedupe(list) {
  const seen = new Set();
  return list.filter((v) => {
    const k = `${v.user}\u0000${v.pass}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Best-effort parse of any text. Labeled formats (FortiGate, our own A4 sheet)
 * win; otherwise one voucher per line.
 * @returns {{vouchers: Voucher[], format: string, validity: string}}
 */
export function parseVouchers(text) {
  const clean = text.replace(/ /g, ' ');
  let vouchers = parseLabeled(clean);
  let format = 'labeled';
  if (!vouchers.length) {
    vouchers = parseCodesOnly(clean);
    format = 'codes';
  }
  if (!vouchers.length) {
    vouchers = parseLines(clean);
    format = 'lines';
  }
  vouchers = dedupe(vouchers);
  return { vouchers, format, validity: commonValidity(vouchers) };
}

/**
 * "12 hour(s) and 0 minute(s)" -> {d: 0, h: 12, m: 0}. Returns null when unknown.
 * Understands English, Greek and Romanian unit names.
 */
export function parseDuration(s) {
  if (!s) return null;
  const num = (re) => {
    const m = s.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  const d = num(/(\d+)\s*(?:de\s+)?(?:day|ημέρ|ημερ|μέρ|zi(?!\p{L})|zile)/iu);
  const h = num(/(\d+)\s*(?:de\s+)?(?:hour|hr|ώρ|ωρ|or[ăae](?!\p{L}))/iu);
  const m = num(/(\d+)\s*(?:de\s+)?(?:min|λεπ)/iu);
  if (!d && !h && !m) return null;
  return { d, h, m };
}

/** Parses several versions of the same document's text and keeps the best. */
export function parseBest(texts) {
  // Labeled matches are trusted more than bare codes, and those more than plain lines.
  const rank = { labeled: 3, codes: 2, lines: 1 };
  const score = (r) => (r.vouchers.length ? rank[r.format] * 1e6 + r.vouchers.length : 0);
  let best = null;
  for (const t of texts) {
    if (!t) continue;
    const res = parseVouchers(t);
    if (!best || score(res) > score(best)) best = res;
  }
  return best || { vouchers: [], format: 'none', validity: null };
}

/** If every voucher has the same expiry, returns it as {d, h, m}; otherwise null. */
export function commonValidity(vouchers) {
  const map = new Map();
  for (const v of vouchers) {
    const dur = parseDuration(v.expiry);
    if (dur) map.set(JSON.stringify(dur), dur);
  }
  return map.size === 1 ? [...map.values()][0] : null;
}
