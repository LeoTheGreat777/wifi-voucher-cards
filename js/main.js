import { parseVouchers, parseLines, parseBest } from './parse.js';
import { cardSvg, sheetSvg, A4 } from './card.js';
import { measure, loadFonts, rasterCard, bitmapToCanvas } from './raster.js';
import { labelZpl, dotsPerMm } from './zpl.js';
import { makeQr, wifiPayload } from './qr.js';
import { DEFAULTS, BUILTIN_LOGO, loadSettings, saveSettings, loadVouchers, saveVouchers } from './settings.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const PREVIEW_MAX = 12;
const SAMPLE = [
  { user: 'user0161', pass: 'bexchzgf' },
  { user: 'user0162', pass: '3bvxeqx7' },
];

let settings = loadSettings();
/** @type {Array<{user: string, pass: string, on: boolean}>} */
let vouchers = loadVouchers();

// ---------- helpers ----------

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), isError ? 5000 : 3200);
}

const selected = () => vouchers.filter((v) => v.on && v.user);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

function persist() {
  saveVouchers(vouchers);
}

// ---------- logo ----------

const logoCache = new Map(); // href -> Promise<HTMLImageElement|null>
const logoBitsCache = new Map();

function logoHref() {
  if (settings.logo === 'builtin') return BUILTIN_LOGO;
  if (settings.logo === 'custom' && settings.customLogo) return settings.customLogo;
  return null;
}

function loadImage(href) {
  if (!logoCache.has(href)) {
    logoCache.set(
      href,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = href;
      })
    );
  }
  return logoCache.get(href);
}

async function currentLogo() {
  const href = logoHref();
  if (!href) return null;
  const img = await loadImage(href);
  if (!img || !img.naturalWidth) return null;
  return { href, img, w: img.naturalWidth, h: img.naturalHeight };
}

/** Shrinks an uploaded logo to a sensible size and stores it as PNG. */
function readLogoFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be opened.'));
      img.onload = () => {
        const w0 = img.naturalWidth || 600;
        const h0 = img.naturalHeight || 300;
        const k = Math.min(1, 1000 / Math.max(w0, h0));
        const c = document.createElement('canvas');
        c.width = Math.round(w0 * k);
        c.height = Math.round(h0 * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function currentQr() {
  if (!settings.qr || !settings.ssid.trim()) return null;
  return makeQr(wifiPayload(settings.ssid.trim(), settings.wifiKey));
}

// ---------- voucher list ----------

function addVouchers(list) {
  const have = new Set(vouchers.map((v) => `${v.user}\u0000${v.pass}`));
  let added = 0;
  for (const v of list) {
    const key = `${v.user}\u0000${v.pass}`;
    if (!v.user || have.has(key)) continue;
    have.add(key);
    vouchers.push({ user: v.user, pass: v.pass || '', on: true });
    added++;
  }
  persist();
  renderList();
  schedulePreview();
  return { added, skipped: list.length - added };
}

function renderList() {
  const list = $('#list');
  list.textContent = '';
  const frag = document.createDocumentFragment();
  vouchers.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'vrow' + (v.on ? '' : ' off');
    row.setAttribute('role', 'listitem');
    row.innerHTML = `
      <input type="checkbox" aria-label="Print this voucher">
      <span class="n">${i + 1}</span>
      <input class="u" aria-label="Username" spellcheck="false">
      <input class="p" aria-label="Password" spellcheck="false" placeholder="(no password)">
      <button class="del" type="button" aria-label="Remove" title="Remove">×</button>`;
    const [cb, u, p] = $$('input', row);
    cb.checked = v.on;
    u.value = v.user;
    p.value = v.pass;
    cb.addEventListener('change', () => {
      v.on = cb.checked;
      row.classList.toggle('off', !v.on);
      persist();
      updateCounts();
      schedulePreview();
    });
    u.addEventListener('input', () => {
      v.user = u.value.trim();
      persist();
      schedulePreview();
    });
    p.addEventListener('input', () => {
      v.pass = p.value.trim();
      persist();
      schedulePreview();
    });
    $('.del', row).addEventListener('click', () => {
      vouchers.splice(vouchers.indexOf(v), 1);
      persist();
      renderList();
      schedulePreview();
    });
    frag.appendChild(row);
  });
  list.appendChild(frag);
  $('#empty').hidden = vouchers.length > 0;
  updateCounts();
}

function updateCounts() {
  const n = selected().length;
  $('#count').textContent = vouchers.length === n ? String(n) : `${n} of ${vouchers.length}`;
  const allOn = vouchers.length && vouchers.every((v) => v.on);
  $('#toggle-all').textContent = allOn ? 'Select none' : 'Select all';
  $('#toggle-all').hidden = !vouchers.length;
  $('#clear-all').hidden = !vouchers.length;
  const pages = Math.ceil(n / A4.perPage);
  $('#a4-info').textContent = n ? `${plural(n, 'card')} on ${plural(pages, 'page')}` : '';
  const labels = n * Math.max(1, settings.copies || 1);
  for (const id of ['#dl-zpl', '#copy-zpl', '#print-label', '#print-a4']) $(id).disabled = !n;
  $('#dl-zpl').lastChild.textContent = n ? ` Download ZPL (${plural(labels, 'label')})` : ' Download ZPL file';
}

// ---------- import ----------

async function importFiles(files) {
  let total = 0;
  let skipped = 0;
  let validity = '';
  for (const file of files) {
    try {
      let texts;
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const { pdfToText } = await import('./pdf-import.js');
        const t = await pdfToText(new Uint8Array(await file.arrayBuffer()));
        if (!t.stream.trim()) {
          toast(`“${file.name}” has no text in it (is it a scan?). Type the vouchers in instead.`, true);
          continue;
        }
        texts = [t.stream, t.lines];
      } else {
        texts = [await file.text()];
      }
      const res = parseBest(texts);
      if (!res.vouchers.length) {
        toast(`No vouchers found in “${file.name}”.`, true);
        continue;
      }
      const r = addVouchers(res.vouchers);
      total += r.added;
      skipped += r.skipped;
      validity = validity || res.validity;
    } catch (err) {
      console.error(err);
      toast(`Could not read “${file.name}”: ${err.message || err}`, true);
      return;
    }
  }
  if (!total && !skipped) return;
  let msg = `Added ${plural(total, 'voucher')}`;
  if (skipped) msg += ` (${skipped} already in the list)`;
  if (validity) {
    const sub = `Valid for ${validity}`;
    if (settings.subtitle !== sub) {
      settings.subtitle = sub;
      saveSettings(settings);
      fillForm();
      msg += ` · validity set to ${validity}`;
    }
  }
  toast(msg);
  schedulePreview();
}

// ---------- design form ----------

function fillForm() {
  for (const el of $$('[data-s]')) {
    const k = el.dataset.s;
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else el.value = settings[k] ?? '';
  }
  for (const el of $$('[data-show]')) el.textContent = settings[el.dataset.show];
  document.body.classList.toggle('show-qr', !!settings.qr);
  const p = [`${settings.dpi} dpi`];
  if (settings.darkness !== '') p.push(`darkness ${settings.darkness}`);
  if (settings.offsetX || settings.offsetY) p.push('shifted');
  $('#printer-summary').textContent = `· ${p.join(', ')}`;
  setOutput(settings.output, false);
}

function bindForm() {
  for (const el of $$('[data-s]')) {
    const k = el.dataset.s;
    const ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(ev, async () => {
      let val = el.type === 'checkbox' ? el.checked : el.value;
      if ('num' in el.dataset) val = val === '' ? DEFAULTS[k] : Number(val);
      if (k === 'logo' && val === 'custom' && !settings.customLogo) {
        $('#logo-file').click();
      }
      settings[k] = val;
      saveSettings(settings);
      for (const s of $$(`[data-show="${k}"]`)) s.textContent = val;
      if (k === 'qr') document.body.classList.toggle('show-qr', !!val);
      if (['dpi', 'darkness', 'offsetX', 'offsetY', 'copies'].includes(k)) fillForm();
      updateCounts();
      schedulePreview();
    });
  }
  $('#logo-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) {
      if (!settings.customLogo) {
        settings.logo = 'builtin';
        fillForm();
      }
      return;
    }
    try {
      settings.customLogo = await readLogoFile(f);
      settings.logo = 'custom';
      saveSettings(settings);
      fillForm();
      schedulePreview();
      toast('Logo updated');
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#reset-design').addEventListener('click', () => {
    const keep = Object.fromEntries(
      ['dpi', 'darkness', 'speed', 'offsetX', 'offsetY', 'copies', 'output', 'customLogo'].map((k) => [k, settings[k]])
    );
    settings = { ...DEFAULTS, ...keep };
    saveSettings(settings);
    fillForm();
    schedulePreview();
  });
}

function setOutput(out, save = true) {
  settings.output = out;
  if (save) saveSettings(settings);
  for (const b of $$('.tabs [data-out]')) b.setAttribute('aria-selected', String(b.dataset.out === out));
  for (const p of $$('.out')) p.classList.toggle('on', p.dataset.for === out);
  if (save) schedulePreview();
}

// ---------- preview ----------

let previewTimer;
let previewToken = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 80);
}

async function renderPreview() {
  const token = ++previewToken;
  await loadFonts();
  const logo = await currentLogo();
  if (token !== previewToken) return;
  const qr = currentQr();
  const list = selected();
  const sample = !list.length;
  const cards = sample ? SAMPLE : list;
  const box = $('#preview');
  const note = $('#preview-note');
  box.textContent = '';

  if (settings.output === 'a4') {
    box.className = 'preview sheet-mode';
    const page = cards.slice(0, A4.perPage);
    const pages = Math.ceil(cards.length / A4.perPage);
    const div = document.createElement('div');
    div.className = 'sheet-shot';
    div.innerHTML = sheetSvg(page, settings, {
      measure,
      logo,
      qr,
      width: '100%',
      height: '100%',
      pageLabel: pages > 1 ? `Page 1 of ${pages}` : '',
    });
    box.appendChild(div);
    note.innerHTML = sample
      ? '<span class="sample-badge">Sample</span> Add vouchers to see your cards'
      : pages > 1
        ? `Page 1 of ${pages}`
        : '';
    return;
  }

  box.className = 'preview';
  const dpmm = dotsPerMm(settings.dpi);
  const shown = cards.slice(0, PREVIEW_MAX);
  note.innerHTML = sample
    ? '<span class="sample-badge">Sample</span> Exactly what the Zebra prints, dot for dot'
    : `Exactly what the Zebra prints, dot for dot${cards.length > shown.length ? ` · first ${shown.length} of ${cards.length}` : ''}`;
  for (const v of shown) {
    const bmp = rasterCard(v, settings, { dpmm, logo: logo?.img || null, logoStyle: settings.logoStyle, qr, logoCache: logoBitsCache });
    if (token !== previewToken) return;
    const shot = document.createElement('div');
    shot.className = 'card-shot thermal';
    shot.title = `${v.user}${v.pass ? ' / ' + v.pass : ''}`;
    shot.appendChild(bitmapToCanvas(bmp));
    box.appendChild(shot);
    await nextFrame();
  }
}

// ---------- outputs ----------

async function buildZpl(onProgress) {
  await loadFonts();
  const logo = await currentLogo();
  const qr = currentQr();
  const dpmm = dotsPerMm(settings.dpi);
  const list = selected();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    const bmp = rasterCard(v, settings, { dpmm, logo: logo?.img || null, logoStyle: settings.logoStyle, qr, logoCache: logoBitsCache });
    out.push(
      labelZpl(bmp, {
        name: v.user,
        offsetX: (settings.offsetX || 0) * dpmm,
        offsetY: (settings.offsetY || 0) * dpmm,
        darkness: settings.darkness === '' ? null : Math.min(30, Math.max(0, Number(settings.darkness))),
        speed: settings.speed === '' ? null : Number(settings.speed),
        copies: settings.copies,
      })
    );
    if (i % 10 === 9) {
      onProgress?.(i + 1, list.length);
      await nextFrame();
    }
  }
  return out.join('\n') + '\n';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function withBusy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  try {
    return await fn((done, total) => (btn.textContent = `${label} ${done}/${total}…`));
  } finally {
    btn.innerHTML = old;
    btn.disabled = false;
    updateCounts();
  }
}

async function downloadZpl() {
  const btn = $('#dl-zpl');
  const zpl = await withBusy(btn, 'Preparing', buildZpl);
  const blob = new Blob([zpl], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wifi-vouchers-${stamp()}.zpl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`ZPL file ready: ${plural(selected().length * (settings.copies || 1), 'label')}`);
}

async function copyZpl() {
  const btn = $('#copy-zpl');
  const zpl = await withBusy(btn, 'Preparing', buildZpl);
  try {
    await navigator.clipboard.writeText(zpl);
    toast('ZPL copied to the clipboard');
  } catch {
    toast('The browser blocked the clipboard. Use Download instead.', true);
  }
}

async function printCards(kind) {
  await loadFonts();
  const logo = await currentLogo();
  const qr = currentQr();
  const list = selected();
  const root = $('#print-root');
  const html = [];
  if (kind === 'label') {
    $('#page-style').textContent = '@page { size: 90mm 50mm; margin: 0; }';
    const copies = Math.max(1, settings.copies || 1);
    for (const v of list)
      for (let c = 0; c < copies; c++)
        html.push(`<div class="label-page">${cardSvg(v, settings, { mode: 'mono', measure, logo, qr })}</div>`);
  } else {
    $('#page-style').textContent = '@page { size: A4 portrait; margin: 0; }';
    const pages = Math.ceil(list.length / A4.perPage);
    for (let p = 0; p < pages; p++) {
      const chunk = list.slice(p * A4.perPage, (p + 1) * A4.perPage);
      html.push(
        `<div class="a4-page">${sheetSvg(chunk, settings, { measure, logo, qr, pageLabel: pages > 1 ? `Page ${p + 1} of ${pages}` : '' })}</div>`
      );
    }
  }
  root.innerHTML = html.join('');
  if (logo) await loadImage(logo.href);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.print();
}

window.addEventListener('afterprint', () => {
  $('#print-root').textContent = '';
});

// ---------- wiring ----------

function init() {
  fillForm();
  bindForm();
  renderList();

  const drop = $('#drop');
  const file = $('#file');
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      file.click();
    }
  });
  file.addEventListener('change', () => {
    importFiles([...file.files]);
    file.value = '';
  });
  for (const ev of ['dragenter', 'dragover'])
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
  for (const ev of ['dragleave', 'drop'])
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    });
  drop.addEventListener('drop', (e) => importFiles([...e.dataTransfer.files]));
  // Dropping anywhere on the page works too.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.target.closest && !e.target.closest('#drop') && e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]);
  });

  $('#add-one').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = $('#one-user');
    const p = $('#one-pass');
    if (!u.value.trim()) {
      u.focus();
      return;
    }
    const r = addVouchers([{ user: u.value.trim(), pass: p.value.trim() }]);
    if (!r.added) toast('That voucher is already in the list', true);
    u.value = '';
    p.value = '';
    u.focus();
    const list = $('#list');
    list.scrollTop = list.scrollHeight;
  });

  $('#add-paste').addEventListener('click', () => {
    const ta = $('#paste');
    const text = ta.value;
    let found = parseVouchers(text).vouchers;
    if (!found.length) found = parseLines(text);
    if (!found.length) {
      toast('Nothing to add. Put one voucher per line.', true);
      return;
    }
    const r = addVouchers(found);
    toast(`Added ${plural(r.added, 'voucher')}${r.skipped ? ` (${r.skipped} already in the list)` : ''}`);
    ta.value = '';
  });

  $('#toggle-all').addEventListener('click', () => {
    const allOn = vouchers.every((v) => v.on);
    vouchers.forEach((v) => (v.on = !allOn));
    persist();
    renderList();
    schedulePreview();
  });
  $('#clear-all').addEventListener('click', () => {
    if (!confirm(`Remove all ${vouchers.length} vouchers from the list?`)) return;
    vouchers = [];
    persist();
    renderList();
    schedulePreview();
  });

  for (const b of $$('.tabs [data-out]')) b.addEventListener('click', () => setOutput(b.dataset.out));
  $('#dl-zpl').addEventListener('click', downloadZpl);
  $('#copy-zpl').addEventListener('click', copyZpl);
  $('#print-label').addEventListener('click', () => printCards('label'));
  $('#print-a4').addEventListener('click', () => printCards('a4'));

  if (document.fonts) document.fonts.addEventListener?.('loadingdone', schedulePreview);
  schedulePreview();
}

init();

// Handy for testing from the console.
window.wifiVoucherCards = { buildZpl, get vouchers() { return vouchers; }, get settings() { return settings; } };
