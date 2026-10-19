// Random voucher codes, made with the browser's secure random numbers.

export const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  // No spaces, commas, quotes or backslashes, so codes are easy to type and paste.
  symbols: '!@#$%&*+-=?',
};

/** Characters that are easy to mix up when read off a card. */
export const LOOK_ALIKE = 'Il1|O0oB8S5Z2';

export const GEN_DEFAULTS = Object.freeze({
  count: 30,
  length: 8,
  mode: 'read', // 'say' (letters only) | 'read' (no look-alikes) | 'all'
  upper: true,
  lower: true,
  digits: true,
  symbols: false,
  userMode: 'numbered', // 'numbered' | 'random'
  prefix: 'guest',
  start: 1,
});

/** A whole number from 0 to n - 1, without bias. */
export function randomInt(n, rand = crypto) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    rand.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** The character types in use after applying the mode. */
export function activeSets(o) {
  const say = o.mode === 'say';
  const sets = [];
  for (const k of ['upper', 'lower', 'digits', 'symbols']) {
    if (!o[k] || (say && (k === 'digits' || k === 'symbols'))) continue;
    let chars = SETS[k];
    if (o.mode === 'read') chars = [...chars].filter((c) => !LOOK_ALIKE.includes(c)).join('');
    sets.push(chars);
  }
  if (!sets.length) sets.push(SETS.lower);
  return sets;
}

/** One random code. Each chosen character type appears at least once. */
export function makeCode(o, rand = crypto) {
  const sets = activeSets(o);
  const pool = sets.join('');
  const len = Math.max(sets.length, Math.min(64, Math.floor(o.length) || 8));
  const out = sets.map((s) => s[randomInt(s.length, rand)]);
  while (out.length < len) out.push(pool[randomInt(pool.length, rand)]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rand);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

/** How hard a code is to guess, in bits, and a rough rating. */
export function strength(o) {
  const pool = activeSets(o).join('').length;
  const bits = Math.round(Math.max(1, Math.floor(o.length) || 8) * Math.log2(pool));
  return { bits, level: bits < 36 ? 'weak' : bits < 60 ? 'fair' : 'strong' };
}

/**
 * A batch of vouchers. Usernames are numbered (guest0001, guest0002, ...) or random.
 * `taken` is a set of usernames already in the list, so no username repeats.
 */
export function makeVouchers(o, taken = new Set(), rand = crypto) {
  const n = Math.max(1, Math.min(1000, Math.floor(o.count) || 1));
  const list = [];
  const used = new Set(taken);
  const userOpts = { length: 8, mode: 'read', lower: true, digits: true };
  let num = Math.max(0, Math.floor(o.start) || 0);
  const width = Math.max(4, String(num + n - 1).length);
  while (list.length < n) {
    let user;
    if (o.userMode === 'random') user = makeCode(userOpts, rand);
    else user = `${o.prefix ?? ''}${String(num++).padStart(width, '0')}`;
    if (used.has(user)) continue;
    used.add(user);
    list.push({ user, pass: makeCode(o, rand) });
  }
  return list;
}
