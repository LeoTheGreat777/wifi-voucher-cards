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

/** Finds vouchers that only have a code ("Voucher code: ABCD-1234", or UniFi's "12345-67890"). */
export function parseCodesOnly(text) {
  const re = /(?<![\p{L}\p{N}])(?:voucher(?:\s*code)?|access\s*code|code)(?![\p{L}\p{N}])\s*[:=#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/giu;
  const labeled = [...text.matchAll(re)].map((m) => m[1]).filter((c) => /\d/.test(c));
  // UniFi voucher codes are ten digits shown as two groups of five.
  const unifi = labeled.length ? [] : [...text.matchAll(/(?<![\p{L}\p{N}-])(\d{5}-\d{5})(?![\p{L}\p{N}-])/gu)].map((m) => m[1]);
  return [...labeled, ...unifi].map((user) => ({ user, pass: '' }));
}

/** Splits one CSV line, honouring "quoted, cells". */
function splitCsv(line, sep) {
  const cells = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === sep && !q) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const HEAD_USER = new RegExp(`^(?:${USER_LABEL}|voucher(?:\\s*code)?|access\\s*code|code|ticket)$`, 'iu');
const HEAD_PASS = new RegExp(`^${PASS_LABEL}$`, 'iu');
const HEAD_EXPIRY = new RegExp(`^${EXPIRY_LABEL}$`, 'iu');

/**
 * A table with a header row (CSV exports from OPNsense, Cisco, Omada and many others):
 * finds the user/code, password and duration columns by name and ignores the rest.
 */
export function parseTable(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const sep = [',', ';', '\t'].find((c) => lines[0].includes(c));
  if (!sep) return [];
  const head = splitCsv(lines[0], sep).map((h) => h.replace(/[_-]+/g, ' ').trim());
  const u = head.findIndex((h) => HEAD_USER.test(h));
  if (u < 0) return [];
  const p = head.findIndex((h) => HEAD_PASS.test(h));
  const e = head.findIndex((h) => HEAD_EXPIRY.test(h));
  const out = [];
  for (const line of lines.slice(1)) {
    const c = splitCsv(line, sep);
    if (!c[u]) continue;
    const v = { user: c[u], pass: p >= 0 ? c[p] || '' : '' };
    if (e >= 0 && c[e]) v.expiry = c[e];
    out.push(v);
  }
  return out;
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
 * Best-effort parse of any text. Labeled formats (FortiGate, MikroTik, our own A4 sheet)
 * win, then tables with a header row, then bare codes (UniFi), then one voucher per line.
 * @returns {{vouchers: Voucher[], format: string, validity: string}}
 */
export function parseVouchers(text) {
  const clean = text.replace(/ /g, ' ');
  let vouchers = parseLabeled(clean);
  let format = 'labeled';
  const noComments = clean.replace(/^\s*#.*$/gm, '');
  if (!vouchers.length) {
    vouchers = parseTable(clean);
    format = 'table';
  }
  if (!vouchers.length) {
    vouchers = parseCodesOnly(noComments);
    format = 'codes';
  }
  if (!vouchers.length) {
    vouchers = parseLines(clean);
    format = 'lines';
  }
  vouchers = dedupe(vouchers);
  let validity = commonValidity(vouchers);
  // Code-only printouts (UniFi) say how long the codes last next to each code.
  if (!validity && format === 'codes') {
    const re = new RegExp(`${B}${EXPIRY_LABEL}${SEP}([^\\n]*)`, 'giu');
    validity = commonValidity([...clean.matchAll(re)].map((m) => ({ expiry: m[1] })));
  }
  return { vouchers, format, validity };
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
  const rank = { labeled: 4, table: 3, codes: 2, lines: 1 };
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
