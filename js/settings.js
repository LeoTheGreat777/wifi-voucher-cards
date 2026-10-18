// Card design and printer settings, saved in this browser only.

export const DEFAULTS = Object.freeze({
  title: 'Guest Wi-Fi',
  subtitle: 'Valid for 12 hours',
  footer: 'Connect to the guest network and sign in with the details above.',
  userLabel: 'USERNAME',
  passLabel: 'PASSWORD',
  codeLabel: 'CODE',
  accent: '#7dba00',
  ink: '#002e63',
  logo: 'builtin', // 'builtin' | 'custom' | 'none'
  customLogo: '', // data URL
  logoStyle: 'dither', // 'dither' | 'threshold'
  qr: false,
  ssid: '',
  wifiKey: '',
  // Printer
  dpi: 203,
  darkness: '',
  speed: '',
  offsetX: 0, // mm
  offsetY: 0, // mm
  copies: 1,
  output: 'zebra', // 'zebra' | 'a4'
});

export const BUILTIN_LOGO = 'assets/logo.png';

const KEY = 'wifi-voucher-cards.settings.v1';
const LIST_KEY = 'wifi-voucher-cards.vouchers.v1';

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function loadSettings() {
  const saved = safe(() => JSON.parse(localStorage.getItem(KEY) || '{}'), {});
  return { ...DEFAULTS, ...saved };
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
