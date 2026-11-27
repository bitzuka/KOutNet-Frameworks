// Применение сохранённого оформления SP на страницах без app.js.
(function () {
  const LOOK_KEY = 'koutnet_sp_look';
  const LOOK_COOKIE = 'koutnet_look';
  const COOKIE_CHUNK = 700;
  const COOKIE_MAX = 3;
  const COLOR_KEYS = ['bg', 'fg', 'card', 'border', 'muted', 'accent', 'accent-fg'];

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
    if (payload.look && payload.look.wallpaper) {
      const liteLook = { ...payload.look };
      delete liteLook.wallpaper;
      payload = { ...payload, look: liteLook };
      enc = encodeURIComponent(JSON.stringify(payload));
    }
    const n = Math.max(1, Math.ceil(enc.length / COOKIE_CHUNK));
    if (n > COOKIE_MAX) return false;
    for (let i = 0; i < n; i++) cookieWriteRaw(LOOK_COOKIE + '_' + i, enc.slice(i * COOKIE_CHUNK, (i + 1) * COOKIE_CHUNK));
    for (let i = n; i < 40; i++) cookieWriteRaw(LOOK_COOKIE + '_' + i, '', 0);
    cookieWriteRaw(LOOK_COOKIE + '_n', String(n));
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
    const r = c.r / 255;
    const g = c.g / 255;
    const b = c.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = 0.65;
    const l = dark ? 0.62 : 0.42;
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
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let i = 0; i < data.length; i += 16) {
            if (data[i + 3] < 10) continue;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n++;
          }
          if (!n) throw new Error('empty');
          resolve({ r: r / n, g: g / n, b: b / n });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('image load'));
      img.src = src;
    });
  }

  function syncWallpaper() {
    const layer = document.querySelector('.wallpaper');
    if (!layer) return;
    const vv = window.visualViewport;
    const width = vv ? vv.width : window.innerWidth;
    const height = vv ? vv.height : window.innerHeight;
    const left = vv ? vv.offsetLeft : 0;
    const top = vv ? vv.offsetTop : 0;
    layer.style.width = width + 'px';
    layer.style.height = height + 'px';
    layer.style.left = left + 'px';
    layer.style.top = top + 'px';
  }

  function watchWallpaper() {
    syncWallpaper();
    window.addEventListener('resize', syncWallpaper);
    if (window.visualViewport) {
      visualViewport.addEventListener('resize', syncWallpaper);
      visualViewport.addEventListener('scroll', syncWallpaper);
    }
  }

  function themeFromBg(value) {
    if (typeof value !== 'string') return '';
    const s = value.trim();
    if (!/^#?([a-f\d]{3}|[a-f\d]{6})$/i.test(s) && !/^rgba?\(([^)]+)\)$/i.test(s)) return '';
    return luminance(colorToRgb(s)) < 0.45 ? 'dark' : 'light';
  }

  async function apply() {
    const html = document.documentElement;
    const look = loadLook();

    const shared = readSharedLook() || {};
    const fromBg = themeFromBg(look.colors && look.colors.bg);
    const saved = shared.theme || localStorage.getItem('koutnet_sp_theme');
    const lookTheme = shared.derivedTheme || localStorage.getItem('koutnet_sp_look_theme');
    if (fromBg) html.dataset.theme = fromBg;
    else if (saved === 'dark' || saved === 'light') html.dataset.theme = saved;
    else if (lookTheme === 'dark' || lookTheme === 'light') html.dataset.theme = lookTheme;
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) html.dataset.theme = 'dark';

    const src = look.wallpaper ||
      (look.wallpaperUrl ? '/api/bg-proxy?url=' + encodeURIComponent(look.wallpaperUrl) : '');
    const clearColors = () => {
      for (const k of COLOR_KEYS) html.style.removeProperty('--' + k);
    };
    html.classList.toggle('has-wallpaper', !!src);
    html.style.setProperty('--sp-bg-image', src ? 'url("' + src.replace(/"/g, '%22') + '")' : 'none');
    watchWallpaper();

    let finalBg = '';
    if (src && look.auto !== false) {
      try {
        const palette = paletteFrom(await sampleImage(src));
        // Цвета из <head> убираем только когда готова новая палитра, иначе страница мигает белым.
        clearColors();
        finalBg = palette.bg;
        for (const [k, v] of Object.entries(palette)) {
          if (!k.startsWith('_')) html.style.setProperty('--' + k, v);
        }
      } catch (_) {
        /* сохраняем цвета, уже применённые встроенным скриптом */
      }
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
        localStorage.setItem('koutnet_sp_look_theme', next);
        localStorage.removeItem('koutnet_sp_theme');
      } catch (_) {}
      shared.derivedTheme = next;
      shared.theme = '';
      shared.look = look;
      writeSharedLook(shared);
    }

    normalizeColors();
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

  window.KoutnetLook = { apply };
})();
