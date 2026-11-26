// Применение сохранённого оформления SP на страницах без app.js.
(function () {
  const LOOK_KEY = 'koutnet_sp_look';
  const COLOR_KEYS = ['bg', 'fg', 'card', 'border', 'muted', 'accent', 'accent-fg'];

  function loadLook() {
    try {
      const d = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}');
      return {
        wallpaper: typeof d.wallpaper === 'string' ? d.wallpaper : '',
        wallpaperUrl: typeof d.wallpaperUrl === 'string' ? d.wallpaperUrl : '',
        colors: d.colors && typeof d.colors === 'object' ? d.colors : {},
        auto: d.auto !== false
      };
    } catch (_) {
      return { wallpaper: '', wallpaperUrl: '', colors: {}, auto: true };
    }
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

  async function apply() {
    const html = document.documentElement;
    const look = loadLook();

    const saved = localStorage.getItem('koutnet_sp_theme');
    if (saved === 'dark' || saved === 'light') html.dataset.theme = saved;
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) html.dataset.theme = 'dark';

    const src = look.wallpaper ||
      (look.wallpaperUrl ? '/api/bg-proxy?url=' + encodeURIComponent(look.wallpaperUrl) : '');
    html.classList.toggle('has-wallpaper', !!src);
    html.style.setProperty('--sp-bg-image', src ? 'url("' + src.replace(/"/g, '%22') + '")' : 'none');
    for (const k of COLOR_KEYS) html.style.removeProperty('--' + k);

    let finalBg = '';
    if (src && look.auto !== false) {
      try {
        const palette = paletteFrom(await sampleImage(src));
        finalBg = palette.bg;
        for (const [k, v] of Object.entries(palette)) {
          if (!k.startsWith('_')) html.style.setProperty('--' + k, v);
        }
      } catch (_) {
        /* оставляем базовую палитру или вручную выбранные цвета */
      }
    }

    for (const [k, v] of Object.entries(look.colors || {})) {
      if (!COLOR_KEYS.includes(k)) continue;
      html.style.setProperty('--' + k, v);
      if (k === 'bg') finalBg = v;
    }

    if (finalBg) {
      html.dataset.theme = luminance(colorToRgb(finalBg)) < 0.45 ? 'dark' : 'light';
    }
  }

  window.KoutnetLook = { apply };
})();
