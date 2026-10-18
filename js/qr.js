import qrcode from '../vendor/qrcode.mjs';

const escWifi = (s) => String(s).replace(/([\;,:"])/g, '\\$1');

/** Standard "join this Wi-Fi" QR payload. Open network when there's no key. */
export function wifiPayload(ssid, key) {
  return key
    ? `WIFI:T:WPA;S:${escWifi(ssid)};P:${escWifi(key)};;`
    : `WIFI:T:nopass;S:${escWifi(ssid)};;`;
}

/** Returns {size, isDark(row, col)} or null. */
export function makeQr(text) {
  if (!text) return null;
  const q = qrcode(0, 'M');
  q.addData(unescape(encodeURIComponent(text)), 'Byte');
  q.make();
  const size = q.getModuleCount();
  return { size, isDark: (r, c) => q.isDark(r, c) };
}
