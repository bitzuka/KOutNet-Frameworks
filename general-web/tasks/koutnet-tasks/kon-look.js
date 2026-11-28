// Общее оформление KOutNet: тема, цвета и обои, синхронизируемые между SP и Tasks.
(function () {
  const LOOK_KEY = 'kon_look';
  const LOOK_COOKIE = 'koutnet_look';
  const COOKIE_CHUNK = 700;
  const COOKIE_MAX = 3;
  const COLOR_KEYS = ['bg', 'fg', 'card', 'border', 'muted', 'accent', 'accent-fg'];
  let lastShared = '';

  function cookieRaw(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? m[1] : '';
  }
  function cookieWriteRaw(name, value, maxAge = 31536000) {
    document.cookie = name + '=' + value + '; Max-Age=' + maxAge + '; Path=/; Domain=.koutnet.pw; SameSite=Lax';
  }
  function readSharedLook() {
    const n = parseInt(cookieRaw(LOOK_COOKIE + '_n'), 10) || 0;
    if (n > COOKIE_MAX) {
      for (let i = 0; i < 40; i++) cookieWriteRaw(LOOK_COOKIE + '_' + i, '', 0);
      cookieWriteRaw(LOOK_COOKIE + '_n', '', 0);
      return null;
    }
    if (!n) return null;
    let enc = '';
    for (let i = 0; i < n; i++) enc += cookieRaw(LOOK_COOKIE + '_' + i);
    if (!enc) return null;
    try { return JSON.parse(decodeURIComponent(enc)); } catch (_) { return null; }
  }
  function writeSharedLook(state) {
    let payload = state;
    let enc = encodeURIComponent(JSON.stringify(payload));
    // Файловые обои слишком велики для cookie — синхронизируем остальное.
    if (payload.look && payload.look.wallpaper) {
      const lite = { ...payload.look };
      delete lite.wallpaper;
      payload = { ...payload, look: lite };
      enc = encodeURIComponent(JSON.stringify(payload));
    }
    const n = Math.max(1, Math.ceil(enc.length / COOKIE_CHUNK));
    if (n > COOKIE_MAX) return false;
    for (let i = 0; i < n; i++) {
      cookieWriteRaw(LOOK_COOKIE + '_' + i, enc.slice(i * COOKIE_CHUNK, (i + 1) * COOKIE_CHUNK));
    }
    for (let i = n; i < 40; i++) cookieWriteRaw(LOOK_COOKIE + '_' + i, '', 0);
    cookieWriteRaw(LOOK_COOKIE + '_n', String(n));
    lastShared = JSON.stringify(payload);
    return true;
  }

  function loadLook() {
    let local = {};
    try { local = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}'); } catch (_) {}
    const d = { ...local };
    const shared = readSharedLook();
    if (shared && shared.look && typeof shared.look === 'object') {
      for (const k of ['wallpaper', 'wallpaperUrl', 'colors', 'auto']) {
        if (Object.prototype.hasOwnProperty.call(shared.look, k)) d[k] = shared.look[k];
      }
    }
    return {
      wallpaper: typeof d.wallpaper === 'string' ? d.wallpaper : '',
      wallpaperUrl: typeof d.wallpaperUrl === 'string' ? d.wallpaperUrl : '',
      colors: d.colors && typeof d.colors === 'object' ? d.colors : {},
      auto: d.auto !== false
    };
  }

  function saveLook(state) {
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(state)); } catch (_) {}
    const shared = readSharedLook() || {};
    shared.look = state;
    if (!shared.theme) shared.theme = localStorage.getItem('kon_theme') || '';
    writeSharedLook(shared);
  }

  function hexToRgb(value) {
    const m = /^#?([a-f\d]{3}|[a-f\d]{6})$/i.exec(String(value).trim());
    if (!m) return { r: 31, g: 35, b: 40 };
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  function rgbToHex(c) {
    const n = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + n(c.r) + n(c.g) + n(c.b);
  }
  function colorToRgb(value) {
    const s = String(value).trim();
    if (/^#?([a-f\d]{3}|[a-f\d]{6})$/i.test(s)) return hexToRgb(s);
    const m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0 };
    }
    return hexToRgb('#1f2328');
  }
  function mixColor(a, b, t) {
    return {
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t
    };
  }
  const luminance = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;

  function accentFrom(c, dark) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = 0.65, l = dark ? 0.62 : 0.42;
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
  }
  function paletteFrom(rgb) {
    const dark = luminance(rgb) < 0.45;
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    const bg = dark ? mixColor(rgb, black, 0.74) : mixColor(rgb, white, 0.78);
    const card = dark ? mixColor(rgb, black, 0.58) : mixColor(rgb, white, 0.90);
    const border = dark ? mixColor(rgb, white, 0.18) : mixColor(rgb, black, 0.20);
    const fg = dark ? { r: 230, g: 237, b: 243 } : { r: 31, g: 35, b: 40 };
    return {
      bg: rgbToHex(bg),
      fg: rgbToHex(fg),
      card: rgbToHex(card),
      border: rgbToHex(border),
      muted: rgbToHex(mixColor(fg, bg, 0.42)),
      accent: accentFrom(rgb, dark),
      'accent-fg': dark ? '#0d1117' : '#ffffff',
      _dark: dark
    };
  }
  function sampleImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = 32;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no canvas');
          ctx.drawImage(img, 0, 0, size, size);
          const data = ctx.getImageData(0, 0, size, size).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < data.length; i += 16) {
            if (data[i + 3] < 10) continue;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
          }
          if (!n) throw new Error('empty');
          resolve({ r: r / n, g: g / n, b: b / n });
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('image load'));
      img.src = src;
    });
  }
  async function compressImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const target = 350 * 1024;
    let quality = 0.82;
    let out = canvas.toDataURL('image/webp', quality);
    if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', quality);
    while (out.length * 0.75 > target && quality > 0.45) {
      quality -= 0.08;
      out = canvas.toDataURL('image/webp', quality);
      if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', quality);
    }
    return out;
  }

  function themeFromBg(value) {
    if (typeof value !== 'string') return '';
    const s = value.trim();
    if (!/^#?([a-f\d]{3}|[a-f\d]{6})$/i.test(s) && !/^rgba?\(([^)]+)\)$/i.test(s)) return '';
    return luminance(colorToRgb(s)) < 0.45 ? 'dark' : 'light';
  }
  function notify() {
    window.dispatchEvent(new CustomEvent('konlookchange'));
  }
  function normalizeColors() {
    const html = document.documentElement;
    const cs = getComputedStyle(html);
    const lum = (key, fallback) => luminance(colorToRgb(cs.getPropertyValue('--' + key) || fallback));
    const bgLum = lum('bg', '#ffffff');
    let cardLum = lum('card', bgLum < 0.45 ? '#161b22' : '#f6f8fa');
    if (Math.abs(bgLum - cardLum) > 0.3) {
      html.style.setProperty('--card', bgLum < 0.45 ? '#161b22' : '#f6f8fa');
      cardLum = bgLum;
    }
    const surface = (bgLum + cardLum) / 2;
    const lightText = surface < 0.45;
    if (lightText ? lum('fg', '#1f2328') < 0.65 : lum('fg', '#1f2328') > 0.35) {
      html.style.setProperty('--fg', lightText ? '#e6edf3' : '#1f2328');
    }
    if (Math.abs(lum('muted', '#656d76') - surface) < 0.2) {
      html.style.setProperty('--muted', lightText ? '#8d96a0' : '#656d76');
    }
    if (Math.abs(lum('border', '#d0d7de') - surface) < 0.06) {
      html.style.setProperty('--border', lightText ? '#30363d' : '#d0d7de');
    }
    if (Math.abs(lum('accent', '#0969da') - surface) < 0.12) {
      html.style.setProperty('--accent', lightText ? '#4493f8' : '#0969da');
      html.style.setProperty('--accent-fg', lightText ? '#0d1117' : '#ffffff');
    }
  }

  async function applyLook() {
    const html = document.documentElement;
    const shared = readSharedLook() || {};
    const look = loadLook();
    const fromBg = themeFromBg(look.colors && look.colors.bg);
    const manual = shared.theme || localStorage.getItem('kon_theme') || localStorage.getItem('theme');
    const derived = shared.derivedTheme || '';
    if (fromBg) html.dataset.theme = fromBg;
    else if (manual === 'dark' || manual === 'light') html.dataset.theme = manual;
    else if (derived === 'dark' || derived === 'light') html.dataset.theme = derived;
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) html.dataset.theme = 'dark';

    const src = look.wallpaper || look.wallpaperUrl;
    const clearColors = () => {
      for (const k of COLOR_KEYS) html.style.removeProperty('--' + k);
    };
    html.classList.toggle('has-wallpaper', !!src);
    html.style.setProperty('--kon-bg-image', src ? 'url("' + String(src).replace(/"/g, '%22') + '")' : 'none');
    let finalBg = '';
    if (src && look.auto !== false) {
      try {
        const palette = paletteFrom(await sampleImage(src));
        clearColors();
        finalBg = palette.bg;
        for (const [k, v] of Object.entries(palette)) {
          if (!k.startsWith('_')) html.style.setProperty('--' + k, v);
        }
      } catch (_) { /* оставляем цвета из head-скрипта */ }
    } else {
      clearColors();
    }
    for (const [k, v] of Object.entries(look.colors || {})) {
      if (!COLOR_KEYS.includes(k)) continue;
      html.style.setProperty('--' + k, v);
      if (k === 'bg') finalBg = v;
    }
    if (finalBg) {
      const next = luminance(colorToRgb(finalBg)) < 0.45 ? 'dark' : 'light';
      html.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
        localStorage.setItem('kon_theme', next);
      } catch (_) {}
      shared.derivedTheme = next;
      shared.theme = '';
      shared.look = look;
      writeSharedLook(shared);
    }
    normalizeColors();
    fillPanel();
  }

  function setTheme(next) {
    if (next !== 'dark' && next !== 'light') return;
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
      localStorage.setItem('kon_theme', next);
    } catch (_) {}
    const look = loadLook();
    look.auto = false;
    look.colors = {};
    saveLook(look);
    const shared = readSharedLook() || {};
    shared.theme = next;
    shared.derivedTheme = '';
    shared.look = look;
    writeSharedLook(shared);
    applyLook().then(notify);
  }

  function reset() {
    const look = { wallpaper: '', wallpaperUrl: '', colors: {}, auto: true };
    try {
      localStorage.removeItem(LOOK_KEY);
      localStorage.removeItem('kon_theme');
      localStorage.removeItem('theme');
    } catch (_) {}
    writeSharedLook({});
    applyLook().then(notify);
  }

  const STYLE = `
.kon-look { position: fixed; inset: 0; z-index: 200; display: none; align-items: center; justify-content: center;
  padding: 12px; background: rgba(0,0,0,.45); }
.kon-look.open { display: flex; }
.kon-look-box { position: relative; width: 100%; max-width: 460px; max-height: 92vh; overflow: auto;
  padding: 18px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); color: var(--fg); }
.kon-look-close { position: absolute; top: 8px; right: 8px; }
.kon-look h2 { margin: 0 0 12px; font-size: 19px; }
.kon-look label { display: block; margin-bottom: 10px; }
.kon-look input[type="file"], .kon-look input[type="url"] { width: 100%; max-width: 100%; }
.kon-look .kon-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.kon-look .kon-colors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.kon-look .kon-colors label { margin: 0; }
.kon-look .kon-colors input { width: 100%; max-width: 100%; }
.kon-look .kon-hint { margin: 12px 0 0; }
`;
  let panel = null;
  function buildPanel() {
    if (panel) return panel;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    panel = document.createElement('div');
    panel.className = 'kon-look';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'оформление');
    panel.innerHTML = `
      <div class="kon-look-box">
        <button type="button" class="kon-look-close" data-kon="close" title="Закрыть">×</button>
        <h2>оформление</h2>
        <label>свои обои (файл)<input type="file" accept="image/*" data-kon="file"></label>
        <div class="kon-row"><button type="button" data-kon="remove">убрать обои</button></div>
        <label>или url фона<input type="url" data-kon="url" placeholder="https://..."></label>
        <div class="kon-row"><button type="button" data-kon="urlApply">применить url</button></div>
        <label><input type="checkbox" data-kon="auto" checked> подстраивать цвета под фон</label>
        <div class="kon-colors">
          <label>фон<input type="color" data-color="bg"></label>
          <label>текст<input type="color" data-color="fg"></label>
          <label>карточки<input type="color" data-color="card"></label>
          <label>граница<input type="color" data-color="border"></label>
          <label>акцент<input type="color" data-color="accent"></label>
          <label>текст на акценте<input type="color" data-color="accent-fg"></label>
        </div>
        <div class="kon-row"><button type="button" data-kon="reset">сбросить</button></div>
        <p class="muted small kon-hint">всё хранится только в этом браузере и синхронизируется с SP</p>
      </div>`;
    document.body.appendChild(panel);
    const q = (name) => panel.querySelector('[data-kon="' + name + '"]');

    q('close').onclick = close;
    panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    q('file').onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = await compressImage(file);
        const look = loadLook();
        look.wallpaper = data;
        look.wallpaperUrl = '';
        saveLook(look);
        await applyLook();
        notify();
      } catch (_) { /* файл не прочитан */ }
    };
    q('remove').onclick = async () => {
      const look = loadLook();
      look.wallpaper = '';
      look.wallpaperUrl = '';
      saveLook(look);
      await applyLook();
      notify();
    };
    q('urlApply').onclick = async () => {
      const value = q('url').value.trim();
      if (!value) return;
      let u;
      try { u = new URL(value); } catch (_) { return; }
      if (!['http:', 'https:'].includes(u.protocol)) return;
      const look = loadLook();
      look.wallpaperUrl = value;
      look.wallpaper = '';
      saveLook(look);
      await applyLook();
      notify();
    };
    q('auto').onchange = async (e) => {
      const look = loadLook();
      look.auto = e.target.checked;
      saveLook(look);
      await applyLook();
      notify();
    };
    panel.querySelectorAll('[data-color]').forEach((input) => {
      input.oninput = () => {
        const look = loadLook();
        look.colors = look.colors || {};
        look.colors[input.dataset.color] = input.value;
        saveLook(look);
        applyLook().then(notify);
      };
    });
    q('reset').onclick = () => reset();
    return panel;
  }
  function fillPanel() {
    if (!panel) return;
    const q = (name) => panel.querySelector('[data-kon="' + name + '"]');
    const look = loadLook();
    q('url').value = look.wallpaperUrl || '';
    q('auto').checked = look.auto !== false;
    panel.querySelectorAll('[data-color]').forEach((input) => {
      input.value = (look.colors || {})[input.dataset.color] || getComputedStyle(document.documentElement)
        .getPropertyValue('--' + input.dataset.color).trim() || '#ffffff';
    });
  }
  function open() {
    buildPanel();
    fillPanel();
    panel.classList.add('open');
  }
  function close() {
    if (panel) panel.classList.remove('open');
  }

  function watch() {
    const shared = readSharedLook() || {};
    const cur = JSON.stringify(shared);
    if (cur === lastShared) return;
    lastShared = cur;
    applyLook().then(notify);
  }

  lastShared = JSON.stringify(readSharedLook() || {});
  window.KonLook = { apply: applyLook, open, close, setTheme, reset };
  applyLook().then(notify);
  setInterval(watch, 1500);
  window.addEventListener('storage', () => { applyLook().then(notify); });
})();
