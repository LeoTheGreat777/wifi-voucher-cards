import { parseVouchers, parseLines, parseBest } from './parse.js';
import { makeCode, makeVouchers, strength } from './generate.js';
import { cardSvg, sheetSvg, A4 } from './card.js';
import { measure, loadFonts, rasterCard, bitmapToCanvas } from './raster.js';
import { labelZpl, dotsPerMm } from './zpl.js';
import { makeQr, wifiPayload } from './qr.js';
import { defaults, cardTextFor, loadSettings, saveSettings, loadVouchers, saveVouchers, listLogos, findLogo, addLogo, deleteLogo } from './settings.js';
import { LANGS, detectLang, tr, applyI18n, count, formatDuration, durationParts, durationFrom } from './i18n.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const SAMPLE = [
  { user: 'user0161', pass: 'bexchzgf' },
  { user: 'user0162', pass: '3bvxeqx7' },
];
/** A full sample A4 page, so the preview shows what a real sheet looks like. */
const SAMPLE_A4 = [
  ...SAMPLE,
  ...['7493eqa4', 'fu3c2xse', 'ee7nbrbg', 'vahqv53y', 'svrgnuqh', 'fg34qpmr', 'zrp4yc98', '7ubzd2mw'].map((pass, i) => ({ user: `user0${163 + i}`, pass })),
];

let settings = loadSettings(detectLang());
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
/** Text in the app's language. */
const t = (key, vars) => tr(settings.uiLang, key, vars);
const plural = (n, noun) => count(settings.uiLang, n, noun);
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

function persist() {
  saveVouchers(vouchers);
}

// ---------- logo ----------

const logoCache = new Map(); // href -> Promise<HTMLImageElement|null>
const logoBitsCache = new Map();

function logoHref() {
  return settings.logo === 'none' ? null : findLogo(settings.logo)?.data || null;
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
      img.onerror = () => reject(new Error(t('imgFail')));
      img.onload = () => {
        const w0 = img.naturalWidth || 600;
        const h0 = img.naturalHeight || 300;
        // Big enough for a crisp print, small enough to keep several in the browser.
        const k = Math.min(1, 800 / Math.max(w0, h0));
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
      <input type="checkbox" aria-label="${t('printThis')}">
      <span class="n">${i + 1}</span>
      <input class="u" aria-label="${t('phUser')}" spellcheck="false">
      <input class="p" aria-label="${t('phPass')}" spellcheck="false" placeholder="${t('noPassword')}">
      <button class="del" type="button" aria-label="${t('remove')}" title="${t('remove')}">×</button>`;
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
  $('.vlist-wrap').hidden = !vouchers.length;
  $('.vouchers').classList.toggle('has-items', vouchers.length > 0);
  updateCounts();
  fitLayout();
}

function updateCounts() {
  const n = selected().length;
  $('#count').textContent = vouchers.length === n ? String(n) : `${n} / ${vouchers.length}`;
  const allOn = vouchers.length && vouchers.every((v) => v.on);
  $('#toggle-all').textContent = allOn ? t('selectNone') : t('selectAll');
  $('#toggle-all').hidden = !vouchers.length;
  $('#clear-all').hidden = !vouchers.length;
  const pages = Math.ceil(n / A4.perPage);
  $('#a4-info').textContent = n ? t('a4Info', { cards: plural(n, 'card'), pages: plural(pages, 'page') }) : '';
  const labels = n * Math.max(1, settings.copies || 1);
  for (const id of ['#dl-zpl', '#copy-zpl', '#print-label', '#print-a4']) $(id).disabled = !n;
  const dl = $('#dl-zpl-label');
  if (dl) dl.textContent = n ? t('dlZplN', { n: plural(labels, 'label') }) : t('dlZpl');
}

// ---------- import ----------

async function importFiles(files) {
  let total = 0;
  let skipped = 0;
  let validity = null;
  for (const file of files) {
    try {
      let texts;
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const { pdfToText } = await import('./pdf-import.js');
        const t = await pdfToText(new Uint8Array(await file.arrayBuffer()));
        if (!t.stream.trim()) {
          toast(t('noText', { f: file.name }), true);
          continue;
        }
        texts = [t.stream, t.lines];
      } else {
        texts = [await file.text()];
      }
      const res = parseBest(texts);
      if (!res.vouchers.length) {
        toast(t('noneFound', { f: file.name }), true);
        continue;
      }
      const r = addVouchers(res.vouchers);
      total += r.added;
      skipped += r.skipped;
      validity = validity || res.validity;
    } catch (err) {
      console.error(err);
      toast(t('readFail', { f: file.name, e: err.message || err }), true);
      return;
    }
  }
  if (!total && !skipped) return;
  let msg = t('added', { n: plural(total, 'voucher') });
  if (skipped) msg += ' ' + t('alreadyIn', { n: skipped });
  if (validity) {
    settings.validity = validity;
    const sub = cardTextFor(settings.lang, validity).subtitle;
    if (settings.subtitle !== sub) {
      settings.subtitle = sub;
      saveSettings(settings);
      fillForm();
      msg += ' · ' + t('validitySet', { v: formatDuration(settings.uiLang, validity) });
    }
  }
  toast(msg);
  schedulePreview();
}

// ---------- random code generator ----------

const genOpts = () => settings.gen;

/** Shows the generator options, a sample code, its strength and the next username. */
function fillGenerator() {
  const g = genOpts();
  for (const el of $$('[data-g]')) {
    const k = el.dataset.g;
    if (el.type === 'checkbox') el.checked = !!g[k];
    else el.value = g[k];
  }
  for (const b of $$('#gen-mode [data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === g.mode));
  // "Easy to say" uses letters only, so numbers and symbols are switched off.
  for (const k of ['digits', 'symbols']) {
    const cb = $(`[data-g="${k}"]`);
    cb.disabled = g.mode === 'say';
    if (g.mode === 'say') cb.checked = false;
    cb.closest('.chip').classList.toggle('off', g.mode === 'say');
  }
  $('#gen').classList.toggle('gen-users-random', g.userMode === 'random');
  newSample();
}

function newSample() {
  const g = genOpts();
  $('#gen-sample').textContent = makeCode(g);
  const st = strength(g);
  const meter = $('#gen-meter');
  meter.dataset.level = st.level;
  meter.firstElementChild.style.width = Math.min(100, Math.max(8, (st.bits / 90) * 100)) + '%';
  $('#gen-strength').textContent = t({ weak: 'strWeak', fair: 'strFair', strong: 'strStrong' }[st.level]);
  const [ex] = makeVouchers({ ...g, count: 1 }, new Set(vouchers.map((v) => v.user)));
  $('#gen-example').textContent = t('genExample', { u: ex.user, p: ex.pass });
}

function bindGenerator() {
  const save = () => {
    saveSettings(settings);
    fillGenerator();
  };
  for (const el of $$('[data-g]')) {
    const k = el.dataset.g;
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const g = { ...settings.gen };
      if (el.type === 'checkbox') {
        g[k] = el.checked;
        // Keep at least one character type on.
        const on = ['upper', 'lower', 'digits', 'symbols'].filter((c) => g[c] && !(g.mode === 'say' && (c === 'digits' || c === 'symbols')));
        if (!on.length) {
          el.checked = true;
          return;
        }
      } else if (el.type === 'number' || el.type === 'range') {
        if (el.value === '') return;
        const n = Number(el.value);
        if (k === 'length') g.length = Math.max(4, Math.min(32, n));
        else if (k === 'count') g.count = Math.max(1, Math.min(1000, n));
        else g[k] = Math.max(0, n);
      } else g[k] = el.value;
      settings.gen = g;
      saveSettings(settings);
      if (el.type === 'text' || k === 'prefix' || el.type === 'number') {
        // Don't rewrite a box while someone is typing in it.
        for (const other of $$(`[data-g="${k}"]`)) if (other !== el) other.value = g[k];
        newSample();
      } else fillGenerator();
    });
    if (el.type === 'number') el.addEventListener('blur', fillGenerator);
  }
  for (const b of $$('#gen-mode [data-mode]'))
    b.addEventListener('click', () => {
      const g = { ...settings.gen, mode: b.dataset.mode };
      if (g.mode === 'say' && !g.upper && !g.lower) g.lower = true;
      settings.gen = g;
      save();
    });
  $('#gen-refresh').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.classList.remove('spin');
    void btn.offsetWidth;
    btn.classList.add('spin');
    newSample();
  });
  $('#gen-add').addEventListener('click', () => {
    const list = makeVouchers(settings.gen, new Set(vouchers.map((v) => v.user)));
    const r = addVouchers(list);
    // Numbered usernames carry on from where this batch stopped.
    if (settings.gen.userMode === 'numbered') {
      settings.gen = { ...settings.gen, start: (Number(settings.gen.start) || 0) + list.length };
      saveSettings(settings);
    }
    fillGenerator();
    toast(t('genAdded', { n: plural(r.added, 'voucher') }));
    const box = $('#list');
    box.scrollTop = box.scrollHeight;
  });
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
  if (settings.darkness !== '') p.push(t('darknessN', { n: settings.darkness }));
  if (settings.offsetX || settings.offsetY) p.push(t('shifted'));
  $('#card-lang').value = settings.lang;
  const vp = durationParts(settings.validity);
  const vn = $('#valid-n');
  if (vp.unit !== 'none' || !vn.value) vn.value = vp.n === '' ? 8 : vp.n;
  vn.disabled = vp.unit === 'none';
  $('#valid-unit').value = vp.unit;
  renderLogos();
  $('#printer-summary').textContent = `· ${p.join(', ')}`;
  setOutput(settings.output, false);
  setAddTab(settings.addTab, false);
}

function bindForm() {
  for (const el of $$('[data-s]')) {
    const k = el.dataset.s;
    const ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(ev, async () => {
      let val = el.type === 'checkbox' ? el.checked : el.value;
      if ('num' in el.dataset) val = val === '' ? defaults()[k] : Number(val);
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
    if (!f) return;
    try {
      const id = addLogo(f.name.replace(/\.[a-z0-9]+$/i, ''), await readLogoFile(f));
      if (!id) {
        toast(t('logoFull'), true);
        return;
      }
      setLogo(id);
      toast(t('logoSaved'));
    } catch (err) {
      toast(err.message, true);
    }
  });
  const onValidity = () => {
    const unit = $('#valid-unit').value;
    const dur = durationFrom($('#valid-n').value, unit);
    // While the number box is being edited (empty or 0), keep the last good value.
    if (!dur && unit !== 'none') return;
    settings.validity = dur;
    settings.subtitle = cardTextFor(settings.lang, dur).subtitle;
    $('#valid-n').disabled = unit === 'none';
    saveSettings(settings);
    schedulePreview();
  };
  $('#valid-n').addEventListener('input', onValidity);
  $('#valid-unit').addEventListener('change', onValidity);
  $('#valid-n').addEventListener('blur', () => fillForm());
  $('#card-lang').addEventListener('change', (e) => {
    settings.lang = e.target.value;
    Object.assign(settings, cardTextFor(settings.lang, settings.validity));
    saveSettings(settings);
    fillForm();
    schedulePreview();
  });
  $('#reset-design').addEventListener('click', () => {
    const keep = Object.fromEntries(
      ['uiLang', 'theme', 'lang', 'validity', 'gen', 'dpi', 'darkness', 'speed', 'offsetX', 'offsetY', 'copies', 'output'].map((k) => [k, settings[k]])
    );
    settings = { ...defaults(settings.lang), ...keep, ...cardTextFor(settings.lang, settings.validity) };
    saveSettings(settings);
    fillForm();
    schedulePreview();
  });
}

// ---------- logos ----------

function setLogo(id) {
  settings.logo = id;
  saveSettings(settings);
  renderLogos();
  schedulePreview();
}

// Easter egg: the Corinth Pipeworks logo turns the whole site maroon (see css/app.css).
const FAVICON_CPW = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23710030'/%3E%3Cpath d='M7 13.5a13 13 0 0 1 18 0M10.5 17a8 8 0 0 1 11 0M14 20.5a3 3 0 0 1 4 0' stroke='%23d9d9db' stroke-width='2.4' fill='none' stroke-linecap='round'/%3E%3Ccircle cx='16' cy='24' r='1.8' fill='%23d9d9db'/%3E%3C/svg%3E";
let faviconDefault = null;
function applyBrand() {
  const cpw = settings.logo === 'builtin-cpw';
  const root = document.documentElement;
  if (cpw) root.dataset.brand = 'cpw';
  else delete root.dataset.brand;
  const icon = document.querySelector('link[rel=icon]');
  if (icon) {
    faviconDefault ??= icon.getAttribute('href');
    icon.setAttribute('href', cpw ? FAVICON_CPW : faviconDefault);
  }
}

/** The logo picker: no logo, the built-in one, saved ones (deletable) and an add button. */
function renderLogos() {
  applyBrand();
  const box = $('#logos');
  box.textContent = '';
  const opt = (id, inner, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'logo-opt';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(settings.logo === id));
    b.title = label;
    b.innerHTML = inner;
    b.addEventListener('click', () => setLogo(id));
    return b;
  };
  box.appendChild(
    opt('none', `<svg viewBox="0 0 32 32" class="wifi-mini" aria-hidden="true"><path d="M6 13.5a14 14 0 0 1 20 0M9.8 17.3a8.6 8.6 0 0 1 12.4 0M13.5 21a3.4 3.4 0 0 1 5 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="24" r="2" fill="currentColor"/></svg><span>${t('noLogo')}</span>`, t('noLogo'))
  );
  for (const l of listLogos()) {
    const b = opt(l.id, '', l.name);
    const img = document.createElement('img');
    img.src = l.data;
    img.alt = l.name;
    b.appendChild(img);
    if (!l.builtin) {
      const del = document.createElement('span');
      del.className = 'logo-del';
      del.textContent = '×';
      del.title = t('deleteLogo');
      del.setAttribute('role', 'button');
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!(await ask($('#ask-logo'), t('confirmDeleteLogo', { name: l.name }), t('yesDelete')))) return;
        deleteLogo(l.id);
        if (settings.logo === l.id) settings.logo = 'builtin';
        saveSettings(settings);
        renderLogos();
        schedulePreview();
        toast(t('logoDeleted'));
      });
      b.appendChild(del);
    }
    box.appendChild(b);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'logo-opt add';
  add.innerHTML = `<span class="plus">+</span><span>${t('uploadLogo')}</span>`;
  add.addEventListener('click', () => $('#logo-file').click());
  box.appendChild(add);
}

// ---------- languages ----------

function renderLangs() {
  const box = $('#ui-lang');
  box.textContent = '';
  for (const l of LANGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l.label;
    b.title = l.name;
    b.setAttribute('aria-pressed', String(settings.uiLang === l.code));
    b.addEventListener('click', () => setUiLang(l.code));
    box.appendChild(b);
  }
  const sel = $('#card-lang');
  sel.textContent = '';
  for (const l of LANGS) sel.add(new Option(l.name, l.code));
  sel.value = settings.lang;
}

const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') root.dataset.theme = settings.theme;
  else delete root.dataset.theme;
}

function renderThemes() {
  const box = $('#theme');
  box.textContent = '';
  for (const [id, key] of [['auto', 'themeAuto'], ['light', 'themeLight'], ['dark', 'themeDark']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = THEME_ICONS[id];
    b.title = t(key);
    b.setAttribute('aria-label', t(key));
    b.setAttribute('aria-pressed', String((settings.theme || 'auto') === id));
    b.addEventListener('click', () => {
      settings.theme = id;
      saveSettings(settings);
      applyTheme();
      renderThemes();
    });
    box.appendChild(b);
  }
}

function setUiLang(code) {
  settings.uiLang = code;
  saveSettings(settings);
  translatePage();
  renderList();
  fillForm();
  schedulePreview();
}

function translatePage() {
  applyI18n(settings.uiLang);
  renderLangs();
  renderThemes();
  $('#made-by').textContent = t('madeBy');
  newSample();
}

/** Shows one of the three ways to add vouchers. */
function setAddTab(tab, save = true) {
  if (!['file', 'type', 'gen'].includes(tab)) tab = 'file';
  settings.addTab = tab;
  if (save) saveSettings(settings);
  for (const b of $$('#add-tabs [data-add]')) b.setAttribute('aria-selected', String(b.dataset.add === tab));
  for (const p of $$('.add-pane')) p.classList.toggle('on', p.dataset.pane === tab);
}

function setOutput(out, save = true) {
  settings.output = out;
  previewView = 0;
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

let previewView = 0; // which page (A4) or pair of labels (Zebra) is shown
let previewViews = 1;
let previewPer = 2; // Zebra labels shown at once

/** Shows another page of the preview. */
function goView(i) {
  const n = Math.max(0, Math.min(previewViews - 1, i));
  if (n === previewView) return;
  previewView = n;
  renderPreview();
}

async function renderPreview() {
  const token = ++previewToken;
  await loadFonts();
  const logo = await currentLogo();
  if (token !== previewToken) return;
  const qr = currentQr();
  const list = selected();
  const sample = !list.length;
  const a4 = settings.output === 'a4';
  const cards = sample ? (a4 ? SAMPLE_A4 : SAMPLE) : list;
  const box = $('#preview');
  const note = $('#preview-note');
  sizePreview();
  const per = a4 ? A4.perPage : previewPer;
  previewViews = Math.max(1, Math.ceil(cards.length / per));
  previewView = Math.min(previewView, previewViews - 1);
  const from = previewView * per;
  const shown = cards.slice(from, from + per);
  box.textContent = '';
  box.className = a4 ? 'preview sheet-mode' : 'preview zebra';

  if (a4) {
    const div = document.createElement('div');
    div.className = 'sheet-shot';
    div.innerHTML = sheetSvg(shown, settings, {
      measure,
      logo,
      qr,
      width: '100%',
      height: '100%',
      pageLabel: previewViews > 1 ? t('pageOf', { p: previewView + 1, n: previewViews }) : '',
      cutNote: t('cutNote'),
    });
    box.appendChild(div);
    note.innerHTML = sample
      ? `<span class="sample-badge">${t('sample')}</span> ${t('sampleA4')}`
      : previewViews > 1
        ? plural(previewViews, 'page')
        : '';
  } else {
    const dpmm = dotsPerMm(settings.dpi);
    note.innerHTML = sample
      ? `<span class="sample-badge">${t('sample')}</span> ${t('zebraNote')}`
      : t('zebraNote') + ' · ' + plural(cards.length, 'label');
    for (const v of shown) {
      const shot = document.createElement('div');
      shot.className = 'card-shot thermal';
      shot.title = `${v.user}${v.pass ? ' / ' + v.pass : ''}`;
      const bmp = rasterCard(v, settings, { dpmm, logo: logo?.img || null, logoStyle: settings.logoStyle, qr, logoCache: logoBitsCache });
      const img = new Image();
      img.alt = '';
      img.src = bitmapToCanvas(bmp).toDataURL('image/png');
      shot.appendChild(img);
      box.appendChild(shot);
    }
  }

  // The page bar: arrows, a page number to type, and the total.
  const pager = $('#pager');
  pager.classList.toggle('off', previewViews < 2);
  $('#pg-n').value = String(previewView + 1);
  $('#pg-n').max = String(previewViews);
  $('#pg-total').textContent = String(previewViews);
  $('#pg-what').textContent = a4 ? '' : t('labelsRange', { a: from + 1, b: from + shown.length, n: cards.length });
  $('#pg-prev').disabled = previewView === 0;
  $('#pg-next').disabled = previewView >= previewViews - 1;
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
  const zpl = await withBusy(btn, t('preparing'), buildZpl);
  const blob = new Blob([zpl], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wifi-vouchers-${stamp()}.zpl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(t('zplReady', { n: plural(selected().length * (settings.copies || 1), 'label') }));
}

async function copyZpl() {
  const btn = $('#copy-zpl');
  const zpl = await withBusy(btn, t('preparing'), buildZpl);
  try {
    await navigator.clipboard.writeText(zpl);
    toast(t('copied'));
  } catch {
    toast(t('clipBlocked'), true);
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
        `<div class="a4-page">${sheetSvg(chunk, settings, { measure, logo, qr, cutNote: t('cutNote'), pageLabel: pages > 1 ? t('pageOf', { p: p + 1, n: pages }) : '' })}</div>`
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

/** How much room the page needs at its normal size, then fits it to the window (see index.html). */
let lastFit = '';
function fitLayout() {
  const root = document.documentElement;
  const zoomOf = () => parseFloat(root.style.zoom) || 1;
  let z = zoomOf();
  for (let i = 0; i < 2; i++) {
    root.style.setProperty('--list-min', vouchers.length ? '160px' : '0px');
    root.dataset.measure = '';
    // offsetHeight is in the page's own pixels, so the zoom doesn't change it.
    const layoutH = $('.layout').offsetHeight;
    const need = Math.ceil($('.topbar').offsetHeight + layoutH + $('.foot').offsetHeight) + 2;
    delete root.dataset.measure;
    z = window.fitZoom ? window.fitZoom(need) : 1;
    root.style.setProperty('--layout-h', layoutH + 'px');
    const key = `${z}|${need}|${innerWidth}x${innerHeight}`;
    if (key === lastFit) break;
    lastFit = key;
  }
  sizePreview();
}

/** Sizes the preview to its box: an A4 page as tall as the box, Zebra labels as wide as that page. */
function sizePreview() {
  const body = $('.preview-body');
  const box = $('#preview');
  const h = Math.max(160, body.clientHeight - 4);
  const w = Math.max(160, body.clientWidth - 4);
  const pageW = Math.min(w, h * 210 / 297);
  box.style.setProperty('--ph', Math.floor(pageW * 297 / 210) + 'px');
  // Labels are about as wide as an A4 page in the same box, so both look like the same scale,
  // but never so small that the text is hard to read.
  const cw = Math.floor(Math.min(w, (h - 8) * 90 / 50, Math.max(pageW, 260)));
  const ch = cw * 50 / 90;
  const per = Math.max(1, Math.min(3, Math.floor((h + 14) / (ch + 14))));
  box.style.setProperty('--cw', cw + 'px');
  if (per !== previewPer) {
    previewPer = per;
    schedulePreview();
  }
}

/** Asks a yes/no question inside the page, in the given box. Resolves to true for yes. */
function ask(box, message, yesLabel) {
  box._done?.(false);
  return new Promise((resolve) => {
    box.textContent = '';
    const p = document.createElement('p');
    p.textContent = message;
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn small';
    no.textContent = t('cancel');
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn small danger';
    yes.textContent = yesLabel;
    const btns = document.createElement('div');
    btns.className = 'ask-btns';
    btns.append(no, yes);
    box.append(p, btns);
    box.hidden = false;
    const onKey = (e) => e.key === 'Escape' && done(false);
    const done = (v) => {
      box._done = null;
      box.hidden = true;
      box.textContent = '';
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    box._done = done;
    no.addEventListener('click', () => done(false));
    yes.addEventListener('click', () => done(true));
    document.addEventListener('keydown', onKey);
    no.focus();
  });
}

function init() {
  applyTheme();
  translatePage();
  fillForm();
  bindForm();
  fillGenerator();
  bindGenerator();
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
    if (!r.added) toast(t('dup'), true);
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
      toast(t('nothingToAdd'), true);
      return;
    }
    const r = addVouchers(found);
    toast(t('added', { n: plural(r.added, 'voucher') }) + (r.skipped ? ' ' + t('alreadyIn', { n: r.skipped }) : ''));
    ta.value = '';
  });

  $('#toggle-all').addEventListener('click', () => {
    const allOn = vouchers.every((v) => v.on);
    vouchers.forEach((v) => (v.on = !allOn));
    persist();
    renderList();
    schedulePreview();
  });
  $('#clear-all').addEventListener('click', async () => {
    if (!vouchers.length) return;
    if (!(await ask($('#ask-clear'), t('confirmClear', { n: plural(vouchers.length, 'voucher') }), t('yesRemove')))) return;
    vouchers = [];
    persist();
    renderList();
    schedulePreview();
  });

  for (const b of $$('.tabs [data-out]')) b.addEventListener('click', () => setOutput(b.dataset.out));
  for (const b of $$('#add-tabs [data-add]')) b.addEventListener('click', () => setAddTab(b.dataset.add));
  $('#dl-zpl').addEventListener('click', downloadZpl);
  $('#copy-zpl').addEventListener('click', copyZpl);
  $('#print-label').addEventListener('click', () => printCards('label'));
  $('#print-a4').addEventListener('click', () => printCards('a4'));

  // Keep everything in the window when it changes size or the panels grow (QR on, list filled...).
  let fitFrame = 0;
  const refit = () => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitLayout);
  };
  addEventListener('resize', refit, { passive: true });
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(refit);
    for (const el of $$('.col-add > .panel:first-child, .design .fields, .col-right > .panel, .topbar, .foot')) ro.observe(el);
    new ResizeObserver(sizePreview).observe($('.preview-body'));
  }
  // Page bar, mouse wheel and arrow keys turn the preview pages.
  $('#pg-prev').addEventListener('click', () => goView(previewView - 1));
  $('#pg-next').addEventListener('click', () => goView(previewView + 1));
  $('#pg-n').addEventListener('change', (e) => goView((parseInt(e.target.value, 10) || 1) - 1));
  const stage = $('.preview-body');
  let wheelSum = 0;
  let wheelAt = 0;
  stage.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || previewViews < 2) return;
      e.preventDefault();
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode ? 40 : 1);
      wheelSum += d;
      const now = Date.now();
      // One page per wheel notch; a touchpad's many small moves add up to one page.
      if (Math.abs(wheelSum) < 50 || now - wheelAt < 180) return;
      goView(previewView + Math.sign(wheelSum));
      wheelSum = 0;
      wheelAt = now;
    },
    { passive: false }
  );
  stage.tabIndex = 0;
  stage.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: -1, ArrowUp: -1, PageUp: -1, ArrowRight: 1, ArrowDown: 1, PageDown: 1 }[e.key];
    if (k) {
      e.preventDefault();
      goView(previewView + k);
    } else if (e.key === 'Home') goView(0);
    else if (e.key === 'End') goView(previewViews - 1);
  });
  fitLayout();
  if (document.fonts) document.fonts.addEventListener?.('loadingdone', schedulePreview);
  schedulePreview();
}

init();

// Handy for testing from the console.
window.wifiVoucherCards = { buildZpl, get vouchers() { return vouchers; }, get settings() { return settings; } };
