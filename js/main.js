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
  updateCounts();
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
  if (vp.unit !== 'none' || !vn.value) vn.value = vp.n === '' ? 12 : vp.n;
  vn.disabled = vp.unit === 'none';
  $('#valid-unit').value = vp.unit;
  renderLogos();
  $('#printer-summary').textContent = `· ${p.join(', ')}`;
  setOutput(settings.output, false);
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

/** The logo picker: no logo, the built-in one, saved ones (deletable) and an add button. */
function renderLogos() {
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
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(t('confirmDeleteLogo', { name: l.name }))) return;
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

let previewObserver = null;

/** Draws preview items only when they scroll into view, so long batches stay fast. */
function whenVisible(el, draw) {
  el._draw = draw;
  previewObserver.observe(el);
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
  const top = box.scrollTop;
  box.textContent = '';
  previewObserver?.disconnect();
  previewObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || token !== previewToken) continue;
        previewObserver.unobserve(e.target);
        e.target._draw();
      }
    },
    { root: box, rootMargin: '600px 0px' }
  );

  if (settings.output === 'a4') {
    box.className = 'preview sheet-mode';
    const pages = Math.ceil(cards.length / A4.perPage);
    for (let p = 0; p < pages; p++) {
      const div = document.createElement('div');
      div.className = 'sheet-shot';
      whenVisible(div, () => {
        div.innerHTML = sheetSvg(cards.slice(p * A4.perPage, (p + 1) * A4.perPage), settings, {
          measure,
          logo,
          qr,
          width: '100%',
          height: '100%',
          pageLabel: pages > 1 ? t('pageOf', { p: p + 1, n: pages }) : '',
          cutNote: t('cutNote'),
        });
      });
      box.appendChild(div);
    }
    note.innerHTML = sample
      ? `<span class="sample-badge">${t('sample')}</span> ${t('sampleA4')}`
      : pages > 1
        ? t('scrollAll', { n: plural(pages, 'page') })
        : '';
    box.scrollTop = top;
    return;
  }

  box.className = 'preview';
  const dpmm = dotsPerMm(settings.dpi);
  note.innerHTML = sample
    ? `<span class="sample-badge">${t('sample')}</span> ${t('zebraNote')}`
    : t('zebraNote') + (cards.length > 4 ? ' · ' + t('scrollAll', { n: plural(cards.length, 'label') }) : '');
  for (const v of cards) {
    const shot = document.createElement('div');
    shot.className = 'card-shot thermal';
    shot.title = `${v.user}${v.pass ? ' / ' + v.pass : ''}`;
    whenVisible(shot, () => {
      const bmp = rasterCard(v, settings, { dpmm, logo: logo?.img || null, logoStyle: settings.logoStyle, qr, logoCache: logoBitsCache });
      // A small 1-bit PNG uses far less memory than keeping a canvas per label.
      const img = new Image();
      img.alt = '';
      img.src = bitmapToCanvas(bmp).toDataURL('image/png');
      shot.appendChild(img);
    });
    box.appendChild(shot);
  }
  box.scrollTop = top;
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

/** Keeps the print column inside the window on computers, so only the preview box scrolls. */
function fitPrintColumn() {
  const col = $('.col-right');
  if (innerWidth <= 980) {
    col.style.maxHeight = '';
    return;
  }
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  // getBoundingClientRect is in window pixels; the column's own sizes are in zoomed pixels.
  const k = CSS_ZOOM_SCALES_RECTS ? 1 : z;
  const top = Math.max(16 * z, col.getBoundingClientRect().top * k);
  // Near the bottom of the page, stay above the footer instead of sliding under the top edge.
  const bottom = Math.min(innerHeight - 16 * z, $('.layout').getBoundingClientRect().bottom * k - 8 * z);
  col.style.maxHeight = Math.max(320, Math.floor((bottom - top) / z)) + 'px';
}
const CSS_ZOOM_SCALES_RECTS = (() => {
  // Browsers differ on whether getBoundingClientRect includes CSS zoom; measure it once.
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  if (z === 1) return true;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;width:100px;height:1px;visibility:hidden';
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return Math.abs(w - 100 * z) < 1;
})();

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
  $('#clear-all').addEventListener('click', () => {
    if (!confirm(t('confirmClear', { n: plural(vouchers.length, 'voucher') }))) return;
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

  for (const ev of ['scroll', 'resize']) addEventListener(ev, fitPrintColumn, { passive: true });
  fitPrintColumn();
  if (document.fonts) document.fonts.addEventListener?.('loadingdone', schedulePreview);
  schedulePreview();
}

init();

// Handy for testing from the console.
window.wifiVoucherCards = { buildZpl, get vouchers() { return vouchers; }, get settings() { return settings; } };
