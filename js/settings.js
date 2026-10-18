// Card design, printer settings and saved logos, kept in this browser only.
import { CARD_TEXT, validityLine } from './i18n.js';
import { GEN_DEFAULTS } from './generate.js';

export const BUILTIN_LOGOS = [{ id: 'builtin', name: 'Hellenic Cables', data: 'assets/logo.png', builtin: true }];

const BASE = Object.freeze({
  uiLang: 'en',
  theme: 'auto', // 'auto' (follow the system) | 'light' | 'dark'
  lang: 'en', // card language
  validity: { d: 0, h: 12, m: 0 },
  accent: '#7dba00',
  ink: '#002e63',
  logo: 'builtin', // 'none', 'builtin' or the id of a saved logo
  logoStyle: 'dither', // 'dither' | 'threshold'
  qr: false,
  ssid: 'Guest_WiFi',
  wifiKey: '',
  // Printer
  dpi: 203,
  darkness: '',
  speed: '',
  offsetX: 0, // mm
  offsetY: 0, // mm
  copies: 1,
  output: 'zebra', // 'zebra' | 'a4'
  gen: GEN_DEFAULTS, // random code generator options
});

/** The card texts for a language, with the validity line filled in. */
export function cardTextFor(lang, validity) {
  return { ...CARD_TEXT[lang], subtitle: validityLine(lang, validity) };
}

export function defaults(lang = 'en') {
  return { ...BASE, uiLang: lang, lang, ...cardTextFor(lang, BASE.validity) };
}

const KEY = 'wifi-voucher-cards.settings.v1';
const LIST_KEY = 'wifi-voucher-cards.vouchers.v1';
const LOGOS_KEY = 'wifi-voucher-cards.logos.v1';

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function loadSettings(detectedLang) {
  const saved = safe(() => JSON.parse(localStorage.getItem(KEY) || 'null'), null);
  if (!saved) return defaults(detectedLang);
  const s = { ...defaults(saved.lang || 'en'), ...saved };
  // Older versions kept a single uploaded logo in the settings.
  if (s.customLogo) {
    const id = addLogo('My logo', s.customLogo);
    if (s.logo === 'custom') s.logo = id || 'builtin';
    delete s.customLogo;
  }
  if (s.logo === 'custom') s.logo = 'builtin';
  if (!String(s.ssid || '').trim()) s.ssid = BASE.ssid;
  s.gen = { ...GEN_DEFAULTS, ...(saved.gen || {}) };
  // The validity line always follows the menu.
  s.subtitle = validityLine(s.lang, s.validity);
  return s;
}

export function saveSettings(s) {
  safe(() => localStorage.setItem(KEY, JSON.stringify(s)));
}

/** Vouchers are kept for this tab only (cleared when the tab closes). */
export function loadVouchers() {
  return safe(() => JSON.parse(sessionStorage.getItem(LIST_KEY) || '[]'), []);
}

export function saveVouchers(list) {
  safe(() => sessionStorage.setItem(LIST_KEY, JSON.stringify(list)));
}

// ---------- saved logos ----------

/** @returns {Array<{id: string, name: string, data: string, builtin?: boolean}>} */
export function listLogos() {
  const saved = safe(() => JSON.parse(localStorage.getItem(LOGOS_KEY) || '[]'), []);
  return [...BUILTIN_LOGOS, ...saved];
}

export function findLogo(id) {
  return listLogos().find((l) => l.id === id) || null;
}

/** Saves a logo and returns its id, or null when the browser has no room left. */
export function addLogo(name, data) {
  const saved = listLogos().filter((l) => !l.builtin);
  const existing = saved.find((l) => l.data === data);
  if (existing) return existing.id;
  const id = 'logo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  saved.push({ id, name: String(name || 'Logo').slice(0, 60), data });
  try {
    localStorage.setItem(LOGOS_KEY, JSON.stringify(saved));
    return id;
  } catch {
    return null;
  }
}

export function deleteLogo(id) {
  const saved = listLogos().filter((l) => !l.builtin && l.id !== id);
  safe(() => localStorage.setItem(LOGOS_KEY, JSON.stringify(saved)));
}
