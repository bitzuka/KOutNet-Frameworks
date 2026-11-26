const TASKS = 'https://tasks.koutnet.pw';
const KEY = 'koutnet_sp_token';
let token = localStorage.getItem(KEY) || '';
let me = null;
let pendingImage = '';
let profileYear = new Date().getUTCFullYear();
let profileEditing = false;
let md = null;
const profileCardCache = new Map();
const LOOK_KEY = 'koutnet_sp_look';
let look = loadLook();

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { ...options, headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
  return data;
}

function initTheme() {
  const saved = localStorage.getItem('koutnet_sp_theme');
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
}

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

function saveLook() {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); }
  catch (_) { toast('браузер не дал сохранить настройки.'); }
}

function bgProxy(url) {
  return '/api/bg-proxy?url=' + encodeURIComponent(url);
}

function wallpaperSource() {
  return look.wallpaper || (look.wallpaperUrl ? bgProxy(look.wallpaperUrl) : '');
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

async function applyLook() {
  const html = document.documentElement;
  const src = wallpaperSource();
  html.classList.toggle('has-wallpaper', !!src);
  html.style.setProperty('--sp-bg-image', src ? 'url("' + src.replace(/"/g, '%22') + '")' : 'none');
  for (const k of ['bg', 'fg', 'card', 'border', 'muted', 'accent', 'accent-fg']) {
    html.style.removeProperty('--' + k);
  }

  let finalBg = '';
  if (src && look.auto !== false) {
    try {
      const palette = paletteFrom(await sampleImage(src));
      finalBg = palette.bg;
      for (const [k, v] of Object.entries(palette)) {
        if (!k.startsWith('_')) html.style.setProperty('--' + k, v);
      }
    } catch (_) {
      /* keep base or manually chosen colors */
    }
  }

  for (const [k, v] of Object.entries(look.colors || {})) {
    if (!/^(bg|fg|card|border|muted|accent|accent-fg)$/.test(k)) continue;
    html.style.setProperty('--' + k, v);
    if (k === 'bg') finalBg = v;
  }

  if (finalBg) {
    html.dataset.theme = luminance(colorToRgb(finalBg)) < 0.45 ? 'dark' : 'light';
  }
}

function renderWallpaperPreview() {
  const host = $('#wallpaperPreview');
  if (!host) return;
  host.replaceChildren();
  const src = wallpaperSource();
  if (!src) {
    host.append(el('span', 'muted small', 'обоев нет'));
    return;
  }
  const img = el('img', '', '');
  img.src = src;
  img.alt = '';
  host.append(img);
}

function fillAppearance() {
  const url = $('#wallpaperUrl');
  if (url) url.value = look.wallpaperUrl || '';
  const auto = $('#autoColors');
  if (auto) auto.checked = look.auto !== false;
  document.querySelectorAll('#appearance input[data-color]').forEach((input) => {
    const key = input.dataset.color;
    const raw = (look.colors && look.colors[key]) ||
      getComputedStyle(document.documentElement).getPropertyValue('--' + key).trim();
    input.value = /^#[0-9a-f]{6}$/i.test(raw) ? raw : rgbToHex(colorToRgb(raw));
  });
  const hint = $('#appearanceHint');
  if (hint) {
    hint.textContent = look.wallpaper
      ? 'обои загружены локально и хранятся в этом браузере'
      : (look.wallpaperUrl
        ? 'фон по ссылке загружается через sp.koutnet.pw'
        : 'всё хранится только в этом браузере');
  }
  renderWallpaperPreview();
}

function openAppearance() {
  fillAppearance();
  $('#appearance').classList.remove('hidden');
}

function closeAppearance() {
  $('#appearance').classList.add('hidden');
}

function initAppearance() {
  const panel = $('#appearance');
  if (!panel) return;

  $('#appearanceClose').onclick = closeAppearance;
  panel.addEventListener('click', (e) => { if (e.target === panel) closeAppearance(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAppearance(); });

  $('#wallpaperFile').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await compressImage(file);
      look.wallpaper = data;
      look.wallpaperUrl = '';
      saveLook();
      await applyLook();
      fillAppearance();
      toast('обои применены локально.');
    } catch (_) {
      toast('не удалось прочитать картинку.');
    }
  };

  $('#wallpaperRemove').onclick = async () => {
    look.wallpaper = '';
    look.wallpaperUrl = '';
    saveLook();
    await applyLook();
    fillAppearance();
    toast('обои убраны.');
  };

  $('#wallpaperUrlApply').onclick = async () => {
    const value = $('#wallpaperUrl').value.trim();
    if (!value) { toast('введите ссылку на картинку.'); return; }
    let u;
    try { u = new URL(value); } catch (_) { toast('некорректная ссылка.'); return; }
    if (!['http:', 'https:'].includes(u.protocol)) { toast('нужна ссылка http или https.'); return; }
    try { await sampleImage(bgProxy(value)); }
    catch (_) { toast('не удалось загрузить фон по ссылке.'); return; }
    look.wallpaperUrl = value;
    look.wallpaper = '';
    saveLook();
    await applyLook();
    fillAppearance();
    toast('фон применён.');
  };

  document.querySelectorAll('#appearance input[data-color]').forEach((input) => {
    input.oninput = () => {
      look.colors = look.colors || {};
      look.colors[input.dataset.color] = input.value;
      saveLook();
      applyLook();
    };
  });

  $('#autoColors').onchange = async () => {
    look.auto = $('#autoColors').checked;
    saveLook();
    await applyLook();
    fillAppearance();
  };

  $('#appearanceReset').onclick = async () => {
    look = { wallpaper: '', wallpaperUrl: '', colors: {}, auto: true };
    localStorage.removeItem(LOOK_KEY);
    await applyLook();
    fillAppearance();
    toast('настройки сброшены.');
  };
}


// the same checkmark component as Tasks
function verifiedIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '16');
  s.setAttribute('height', '16');
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', 'Проверенный');
  s.classList.add('verified');
  s.innerHTML = '<title>Проверенный</title>' +
    '<circle cx="12" cy="12" r="11" fill="currentColor"/>' +
    '<path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
}
function nameNode(p, cls) {
  const n = el('strong', cls || '', p.displayName || p.username);
  if (p.verified) n.append(verifiedIcon());
  if (p.adm) n.append(el('span', 'adm-tag', 'adm'));
  return n;
}
function avatar(p, cls) {
  if (p.avatarUrl) {
    const img = el('img', cls, '');
    img.src = p.avatarUrl;
    img.alt = '';
    return img;
  }
  return el('span', cls, (p.displayName || p.username || '?').charAt(0).toUpperCase());
}

function cachedProfileCard(username) {
  const key = String(username).toLowerCase();
  if (!profileCardCache.has(key)) {
    profileCardCache.set(
      key,
      api('/api/profile?username=' + encodeURIComponent(username)).catch(() => null)
    );
  }
  return profileCardCache.get(key);
}

function makeHoverCard(p) {
  const card = el('div', 'hovercard hidden');
  const box = el('div', 'hc-box');

  const banner = el('div', 'hc-banner');
  if (p.bannerUrl) {
    const img = el('img', 'hc-banner-img', '');
    img.src = p.bannerUrl;
    img.alt = '';
    banner.append(img);
  }
  banner.append(el('div', 'banner-shade'));

  const nameBox = el('div', 'hc-name');
  const strong = el('strong', '', p.displayName || p.username);
  if (p.verified) strong.append(verifiedIcon());
  if (p.adm) strong.append(el('span', 'adm-tag', 'adm'));
  nameBox.append(strong);
  nameBox.append(el('span', 'hc-nick', '@' + p.username));
  banner.append(nameBox);

  const avatarPos = el('div', 'hc-avatar-pos');
  avatarPos.append(avatar(p, 'hc-avatar'));
  banner.append(avatarPos);
  box.append(banner);

  const stats = el('div', 'hc-stats');
  for (const [k, label] of [['solved', 'Решено'], ['applies', 'Отклики'], ['comments', 'Сообщения']]) {
    const s = el('div', 'stat');
    s.append(el('b', '', String(p.stats?.[k] ?? 0)));
    s.append(el('span', '', label));
    stats.append(s);
  }
  box.append(stats);
  card.append(box);
  return card;
}

// same trigger and 250ms delay as the Tasks user-link component
function userLink(username, label, flags = {}) {
  const wrap = el('span', 'ul');
  if (!username) {
    wrap.append(el('strong', '', label || 'удалённый аккаунт'));
    return wrap;
  }

  const name = el('a', 'ul-name', '');
  name.href = '/u/' + encodeURIComponent(username);
  name.append(el('strong', '', label || username));
  name.onclick = (e) => { e.preventDefault(); showProfile(username); };
  wrap.append(name);
  if (flags.verified) wrap.append(verifiedIcon());
  if (flags.adm) wrap.append(el('span', 'adm-tag', 'adm'));

  let timer = null;
  let card = null;
  let wanted = false;

  wrap.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    wanted = true;
    timer = setTimeout(async () => {
      if (!wanted) return;
      if (!card) {
        const p = await cachedProfileCard(username);
        if (!wanted || !p) return;
        card = makeHoverCard(p);
        wrap.append(card);
        const rect = wrap.getBoundingClientRect();
        if (rect.left + 300 > window.innerWidth - 12) {
          card.style.left = 'auto';
          card.style.right = '0';
        }
      } else {
        card.classList.remove('hidden');
      }
    }, 250);
  });

  wrap.addEventListener('mouseleave', () => {
    clearTimeout(timer);
    wanted = false;
    if (card) card.classList.add('hidden');
  });

  return wrap;
}

function renderUser() {
  const box = $('#userBox');
  box.replaceChildren();

  const lookBtn = el('button', '', 'оформление');
  lookBtn.title = 'Обои и цвета';
  lookBtn.onclick = openAppearance;
  box.append(lookBtn);

  const theme = el('button', '', document.documentElement.dataset.theme === 'dark' ? '☀' : '☾');
  theme.title = 'Сменить тему';
  theme.onclick = async () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('koutnet_sp_theme', next);
    look.auto = false;
    look.colors = {};
    saveLook();
    await applyLook();
    document.documentElement.dataset.theme = next;
    renderUser();
  };
  box.append(theme);

  if (me) {
    const meBtn = el('button', 'linklike', '');
    meBtn.append(avatar(me, me.avatarUrl ? 'avatar-sm' : 'avatar-fallback'));
    meBtn.append(document.createTextNode(' ' + (me.displayName || me.username)));
    if (me.verified) meBtn.append(verifiedIcon());
    meBtn.onclick = () => showProfile(me.username);
    box.append(meBtn);
    const out = el('button', '', 'Выйти');
    out.onclick = async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
      token = '';
      me = null;
      localStorage.removeItem(KEY);
      renderUser();
      setTab('feed');
    };
    box.append(out);
  } else {
    const link = el('a', 'button-link', 'Войти через Tasks');
    link.href = TASKS + '/sp-login.html?back=' + encodeURIComponent(location.origin + location.pathname);
    box.append(link);
  }
}

function setTab(name, username) {
  const profile = name === 'profile';
  $('#feedPane').classList.toggle('hidden', profile);
  $('#profilePane').classList.toggle('hidden', !profile);
  document.querySelectorAll('nav a[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
  const path = profile ? (username ? '/u/' + encodeURIComponent(username) : '/profile') : '/';
  if (location.pathname !== path) history.pushState({ tab: name, username: username || '' }, '', path);
  if (profile) loadProfile(username);
  else loadPosts();
}

function showProfile(username) {
  profileEditing = false;
  setTab('profile', username);
}

function formatTime(iso, full) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', full
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---- markdown: GitHub-flavored, rendered locally and sanitized ----
function slugifyHeading(s) {
  return String(s).toLowerCase().trim()
    .replace(/[`*_~[\]()#+.!?]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function preprocessAlerts(src) {
  let fence = '';
  return String(src).split('\n').map((line) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      const mark = m[1];
      if (!fence) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = '';
      return line;
    }
    if (!fence) {
      return line.replace(/^ {0,3}> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/, '::: $1');
    }
    return line;
  }).join('\n');
}

function initMarkdown() {
  const MarkdownIt = window.markdownit;
  if (!MarkdownIt || !window.DOMPurify) return;

  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const highlight = (code, lang) => {
    const hljs = window.hljs;
    if (!hljs) return escapeHtml(code);
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch (_) { /* fall through */ }
    }
    try { return hljs.highlightAuto(code).value; } catch (_) { return escapeHtml(code); }
  };

  const engine = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
    typographer: false,
    highlight
  });

  if (window.markdownitTaskLists) {
    engine.use(window.markdownitTaskLists, { enabled: false, label: true, labelAfter: true });
  }
  if (window.markdownitFootnote) engine.use(window.markdownitFootnote);
  if (window.markdownitEmoji) engine.use(window.markdownitEmoji);

  if (window.markdownItAnchor) {
    const opts = { slugify: slugifyHeading, tabIndex: false };
    try {
      const permalink = window.markdownItAnchor.permalink;
      if (permalink && permalink.ariaHidden) {
        opts.permalink = permalink.ariaHidden({ symbol: '#', placement: 'before' });
      }
    } catch (_) { /* headings still get ids */ }
    try { engine.use(window.markdownItAnchor, opts); }
    catch (_) { engine.use(window.markdownItAnchor, { slugify: slugifyHeading, tabIndex: false }); }
  }

  if (window.markdownitContainer) {
    const icons = { NOTE: 'ℹ️', TIP: '💡', IMPORTANT: '❗', WARNING: '⚠️', CAUTION: '🚨' };
    Object.keys(icons).forEach((name) => {
      engine.use(window.markdownitContainer, name, {
        validate: (params) => params.trim().toUpperCase() === name,
        render: (tokens, idx) => tokens[idx].nesting === 1
          ? '<div class="markdown-alert markdown-alert-' + name.toLowerCase() + '"><p class="markdown-alert-title">' + icons[name] + ' ' + name + '</p>\n'
          : '</div>\n'
      });
    });
  }

  md = engine;
}

function imageFileName(src) {
  try {
    const u = new URL(src, location.origin);
    return decodeURIComponent(u.pathname.split('/').pop() || '') || 'изображение';
  } catch (_) {
    return 'изображение';
  }
}

async function downloadViaProxy(href, name, e) {
  e.preventDefault();
  try {
    const r = await fetch('/api/bg-proxy?url=' + encodeURIComponent(href));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (_) {
    window.open(href, '_blank', 'noopener');
  }
}

function addImageDownload(img, wrapClass) {
  if (!img || img.closest('a') || img.parentElement?.classList.contains('image-downloaded')) return;
  const wrap = el('span', (wrapClass || 'image-wrap') + ' image-downloaded');
  if (img.parentNode) {
    img.parentNode.insertBefore(wrap, img);
    wrap.append(img);
  } else {
    wrap.append(img);
  }
  const src = img.getAttribute('src') || img.src;
  const btn = el('a', 'image-download', 'скачать');
  btn.href = src;
  btn.download = imageFileName(src);
  btn.title = 'Скачать изображение';
  let sameOrigin = false;
  try { sameOrigin = new URL(src, location.origin).origin === location.origin; } catch (_) {}
  if (!sameOrigin) btn.onclick = (e) => downloadViaProxy(src, btn.download, e);
  wrap.append(btn);
  return wrap;
}

function renderMarkdown(text) {
  if (!md || !window.DOMPurify) {
    const plain = el('div', 'post-text');
    plain.textContent = text;
    return plain;
  }

  const safe = window.DOMPurify.sanitize(md.render(preprocessAlerts(text)), {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['input'],
    ADD_ATTR: ['target', 'rel', 'id', 'class', 'type', 'checked', 'disabled', 'start', 'aria-label', 'aria-hidden'],
    FORBID_ATTR: ['style'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form']
  });

  const tpl = document.createElement('template');
  tpl.innerHTML = safe;

  tpl.content.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  });

  tpl.content.querySelectorAll('img').forEach((img) => addImageDownload(img));

  tpl.content.querySelectorAll('pre').forEach((pre) => {
    const btn = el('button', 'copy-code', 'Копировать');
    btn.type = 'button';
    btn.onclick = async () => {
      const code = pre.querySelector('code')?.textContent ?? '';
      try { await navigator.clipboard.writeText(code); btn.textContent = 'Скопировано'; }
      catch (_) { btn.textContent = 'Не вышло'; }
      setTimeout(() => { btn.textContent = 'Копировать'; }, 1500);
    };
    pre.append(btn);
  });

  return tpl.content;
}

// ---- comments: Tasks components, Tasks data ----
function short(s) {
  return s.length > 140 ? s.slice(0, 140) + '...' : s;
}

function makeComment(c, all, onReply) {
  const box = el('div', 'comment' + (c.kind === 'apply' ? ' apply' : ''));
  const head = el('div', 'comment-head');
  if (c.username) {
    head.append(userLink(c.username, c.author || c.username, { verified: c.verified, adm: c.adm }));
    head.append(el('span', 'muted small', '@' + c.username));
  } else {
    head.append(el('span', 'user-link', c.author || 'удалённый аккаунт'));
  }
  if (c.kind === 'apply') head.append(el('span', 'badge apply-badge', 'Отклик'));
  const time = el('span', 'muted small', formatTime(c.createdAt, true));
  time.dateTime = c.createdAt;
  head.append(time);
  box.append(head);

  if (c.parentId) {
    const parent = all.find((x) => x.id === c.parentId);
    if (parent) {
      const quote = el('div', 'quote');
      quote.append(el('span', 'small', 'Ответ для ' + (parent.author || 'удалённый аккаунт') + ': '));
      quote.append(document.createTextNode(short(parent.text)));
      box.append(quote);
    }
  }
  box.append(el('div', 'comment-body', c.text));
  const foot = el('div', 'comment-foot');
  const reply = el('button', 'link-btn', 'Ответить');
  reply.onclick = () => onReply(c);
  foot.append(reply);
  box.append(foot);
  return box;
}

async function loadComments(postId, box, btn) {
  try {
    const all = await api('/api/posts/' + encodeURIComponent(postId) + '/comments');
    box.replaceChildren();
    btn.textContent = 'Комментарии (' + all.length + ')';
    box.append(el('h2', 'thread-title', 'Обсуждение (' + all.length + ')'));

    let replyTo = null;
    let inputEl = null;
    const thread = el('div', 'thread');
    if (!all.length) {
      thread.append(el('p', 'muted', 'Пока никто не написал. Можно начать обсуждение.'));
    } else {
      for (const c of all) {
        thread.append(makeComment(c, all, (target) => {
          replyTo = target;
          renderForm();
          if (inputEl) inputEl.focus();
        }));
      }
    }
    box.append(thread);

    const form = el('section', 'panel');
    const renderForm = () => {
      form.replaceChildren();
      if (replyTo) {
        const bar = el('p', 'reply-bar');
        bar.append(document.createTextNode('Ответ для ' + (replyTo.author || 'удалённый аккаунт') + ' '));
        const cancel = el('button', 'link-btn', 'Отменить ответ');
        cancel.onclick = () => { replyTo = null; renderForm(); };
        bar.append(cancel);
        form.append(bar);
      }
      form.append(el('p', 'muted', 'Вы пишете как ' + (me?.displayName || me?.username || '')));
      const input = el('textarea', '');
      inputEl = input;
      input.rows = 3;
      input.maxLength = 2000;
      input.placeholder = 'Ваш комментарий';
      form.append(input);
      const err = el('p', 'form-error', '');
      form.append(err);
      const submit = el('button', 'btn-primary', 'Отправить');
      submit.onclick = async () => {
        const text = input.value.trim();
        if (!text) { err.textContent = 'Напишите комментарий.'; return; }
        err.textContent = '';
        submit.disabled = true;
        try {
          await api('/api/posts/' + encodeURIComponent(postId) + '/comments', {
            method: 'POST',
            body: { text, parentId: replyTo?.id ?? '' }
          });
          replyTo = null;
          await loadComments(postId, box, btn);
        } catch (e) {
          err.textContent = e.message;
          submit.disabled = false;
        }
      };
      form.append(submit);
    };
    renderForm();
    box.append(form);
  } catch (e) {
    box.replaceChildren(el('p', 'muted small', e.message));
  }
}

function makePost(p) {
  const box = el('article', 'post');
  const head = el('div', 'post-head');
  if (p.author && p.author.username) {
    const a = avatar(p.author, p.author.avatarUrl ? 'avatar-sm' : 'avatar-fallback');
    a.style.cursor = 'pointer';
    a.onclick = () => showProfile(p.author.username);
    head.append(a);
    head.append(userLink(p.author.username, p.author.displayName || p.author.username, {
      verified: p.author.verified,
      adm: p.author.adm
    }));
    head.append(el('span', 'muted small', '@' + p.author.username));
  } else {
    head.append(el('span', 'post-author', 'удалённый аккаунт'));
  }
  const time = el('time', '', formatTime(p.createdAt));
  time.dateTime = p.createdAt;
  head.append(time);
  box.append(head);
  const body = el('div', 'post-text markdown-body');
  body.append(renderMarkdown(p.text));
  box.append(body);
  if (p.image) {
    const img = el('img', 'post-image');
    img.src = p.image;
    img.alt = 'Картинка к посту';
    img.loading = 'lazy';
    box.append(img);
    addImageDownload(img, 'post-image-wrap image-wrap');
  }

  const foot = el('div', 'post-foot');
  const toggle = el('button', 'link-btn', 'Комментарии (' + (p.commentCount ?? 0) + ')');
  const comments = el('div', 'comments-box hidden');
  let loaded = false;
  toggle.onclick = () => {
    const opening = comments.classList.contains('hidden');
    comments.classList.toggle('hidden', !opening);
    if (opening && !loaded) {
      loaded = true;
      loadComments(p.id, comments, toggle);
    }
  };
  foot.append(toggle);
  box.append(foot);
  box.append(comments);
  return box;
}

async function loadPosts() {
  const host = $('#posts');
  try {
    const list = await api('/api/posts?limit=50');
    host.replaceChildren();
    if (!list.length) host.append(el('p', 'empty', 'Пока тихо. Напишите первый пост.'));
    else list.forEach((p) => host.append(makePost(p)));
  } catch (e) {
    host.replaceChildren(el('p', 'empty', e.message));
  }
}

// ---- profile and activity: tasks markup, tasks data ----
function calendarCells(p, y) {
  const DAY = 86400000;
  const cal = p.calendar || {};
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y, 11, 31);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const offset = (new Date(start).getUTCDay() + 6) % 7;
  const days = Math.round((end - start) / DAY) + 1;
  const total = Math.ceil((offset + days) / 7) * 7;
  const out = [];
  for (let i = 0; i < total; i++) {
    const t = start + (i - offset) * DAY;
    if (t < start || t > end || t > today) { out.push(null); continue; }
    const key = new Date(t).toISOString().slice(0, 10);
    const n = cal[key] ?? 0;
    const lvl = n === 0 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 19 ? 3 : 4;
    out.push({ key, n, lvl });
  }
  return out;
}

function isOwn(p) {
  return !!me && !!p.username && me.username.toLowerCase() === p.username.toLowerCase();
}

function renderProfile(p) {
  const host = $('#profile');
  host.replaceChildren();
  const own = isOwn(p);

  const section = el('section', 'profile');
  const banner = el('div', 'banner');
  if (p.bannerUrl) {
    const img = el('img', 'banner-img', '');
    img.src = p.bannerUrl;
    img.alt = '';
    banner.append(img);
  }
  banner.append(el('div', 'banner-shade'));
  if (own) {
    const editBtn = el('button', 'banner-edit', profileEditing ? 'Закрыть' : 'Изменить профиль');
    editBtn.onclick = () => { profileEditing = !profileEditing; renderProfile(p); };
    banner.append(editBtn);
  }
  const bannerName = el('div', 'banner-name');
  bannerName.append(nameNode(p));
  bannerName.append(el('span', '', '@' + p.username));
  banner.append(bannerName);
  const avatarPos = el('div', 'avatar-pos');
  avatarPos.append(avatar(p, 'avatar'));
  banner.append(avatarPos);
  section.append(banner);

  const body = el('div', 'profile-body');
  const stats = el('div', 'stats');
  for (const [k, label] of [['solved', 'Решено'], ['applies', 'Отклики'], ['comments', 'Сообщения']]) {
    const s = el('div', 'stat');
    s.append(el('b', '', String(p.stats?.[k] ?? 0)));
    s.append(el('span', '', label));
    stats.append(s);
  }
  body.append(stats);
  if (p.bio) body.append(el('p', 'bio', p.bio));
  if (p.createdAt) {
    body.append(el('p', 'muted small', 'На сайте с ' + p.createdAt.slice(0, 10).split('-').reverse().join('.')));
  }
  section.append(body);
  host.append(section);

  if (own && profileEditing) host.append(renderEdit(p));

  const panel = el('section', 'panel');
  const years = [];
  for (let y = 2026; y <= Math.max(new Date().getUTCFullYear(), 2026); y++) years.push(y);
  if (!years.includes(profileYear)) profileYear = years[years.length - 1];
  const tabs = el('div', 'tabs');
  for (const y of years) {
    const b = el('button', y === profileYear ? 'active' : '', String(y));
    b.onclick = () => { profileYear = y; renderProfile(p); };
    tabs.append(b);
  }
  panel.append(tabs);
  const cells = calendarCells(p, profileYear);
  const total = cells.reduce((s, c) => s + (c?.n ?? 0), 0);
  panel.append(el('h2', 'thread-title', 'Активность за ' + profileYear + ' год: ' + total));
  const wrap = el('div', 'cal-wrap');
  const grid = el('div', 'cal');
  for (const c of cells) {
    const cell = el('div', c ? 'cell l' + c.lvl : 'cell empty-cell');
    if (c) cell.title = c.key + ': ' + c.n;
    grid.append(cell);
  }
  wrap.append(grid);
  panel.append(wrap);
  const legend = el('div', 'cal-legend muted small');
  legend.append(document.createTextNode('Меньше '));
  for (let i = 0; i <= 4; i++) legend.append(el('span', 'cell l' + i));
  legend.append(document.createTextNode(' Больше'));
  panel.append(legend);
  panel.append(el('p', 'muted small', 'В активность входят сообщения, отклики, ветки и ответы на форуме, решённые задачи и посты в SP.'));

  if (p.solved?.length) {
    const list = el('div', 'solved-list');
    for (const s of p.solved) {
      const row = el('div', 'solved-row');
      const a = el('a', '', s.title || s.taskId);
      a.href = TASKS + '/task/' + encodeURIComponent(s.taskId);
      row.append(a);
      row.append(el('span', 'muted small', s.date));
      list.append(row);
    }
    panel.append(list);
  } else {
    panel.append(el('p', 'muted', 'Пока нет засчитанных задач. Решённые задачи отмечает администратор.'));
  }
  host.append(panel);
}

function renderEdit(p) {
  const section = el('section', 'panel');
  section.append(el('h2', 'thread-title', 'Редактирование профиля'));
  const err = el('p', 'form-error', '');

  const nameField = el('label', 'field');
  nameField.append(el('span', '', 'Отображаемое имя'));
  const nameInput = el('input', '');
  nameInput.type = 'text';
  nameInput.maxLength = 40;
  nameInput.value = p.displayName || '';
  nameField.append(nameInput);
  section.append(nameField);

  const bioField = el('label', 'field');
  bioField.append(el('span', '', 'О себе'));
  const bioInput = el('textarea', '');
  bioInput.rows = 3;
  bioInput.maxLength = 200;
  bioInput.value = p.bio || '';
  bioField.append(bioInput);
  section.append(bioField);

  const save = el('button', 'btn-primary', 'Сохранить');
  save.onclick = async () => {
    err.textContent = '';
    try {
      const next = await api('/api/profile', { method: 'PUT', body: { displayName: nameInput.value, bio: bioInput.value } });
      if (isOwn(next)) me = next;
      profileCardCache.clear();
      toast('Сохранено.');
      renderProfile(next);
    } catch (e) { err.textContent = e.message; }
  };
  section.append(save);

  const row = el('div', 'img-row');
  for (const kind of ['avatar', 'banner']) {
    const box = el('div', '');
    const title = el('p', '');
    title.append(el('strong', '', kind === 'avatar' ? 'Аватарка' : 'Баннер'));
    box.append(title);
    const input = el('input', '');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      err.textContent = '';
      try {
        const data = await compressProfileImage(file, kind);
        const next = await api('/api/profile/image/' + kind, { method: 'PUT', body: { data } });
        if (isOwn(next)) me = next;
      profileCardCache.clear();
        renderProfile(next);
      } catch (e) { err.textContent = e.message || 'Не удалось прочитать картинку.'; }
    };
    box.append(input);
    if (kind === 'avatar' ? p.avatarUrl : p.bannerUrl) {
      const remove = el('button', '', 'Удалить');
      remove.onclick = async () => {
        err.textContent = '';
        try {
          const next = await api('/api/profile/image/' + kind, { method: 'DELETE', body: {} });
          if (isOwn(next)) me = next;
      profileCardCache.clear();
          renderProfile(next);
        } catch (e) { err.textContent = e.message; }
      };
      box.append(remove);
    }
    row.append(box);
  }
  section.append(row);
  section.append(el('p', 'muted small', 'Картинки автоматически уменьшаются. Новая загрузка заменяет старую.'));
  section.append(err);

  section.append(el('h2', 'thread-title', 'Удаление аккаунта'));
  const pwField = el('label', 'field');
  pwField.append(el('span', '', 'Пароль для подтверждения'));
  const pw = el('input', '');
  pw.type = 'password';
  pw.maxLength = 100;
  pw.autocomplete = 'current-password';
  pwField.append(pw);
  section.append(pwField);
  const del = el('button', '', 'Удалить аккаунт');
  del.onclick = async () => {
    if (!pw.value) { err.textContent = 'Введите пароль.'; return; }
    if (!confirm('Удалить аккаунт и все его картинки? Это необратимо.')) return;
    try {
      await api('/api/profile/delete', { method: 'POST', body: { password: pw.value } });
      token = '';
      me = null;
      localStorage.removeItem(KEY);
      renderUser();
      setTab('feed');
      toast('Аккаунт удалён.');
    } catch (e) { err.textContent = e.message; }
  };
  section.append(del);
  return section;
}

function compressProfileImage(file, kind) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = kind === 'avatar' ? 256 : 1200;
      const h = kind === 'avatar' ? 256 : 400;
      const limit = kind === 'avatar' ? 140 * 1024 : 380 * 1024;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no canvas')); return; }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const scale = Math.max(w / img.width, h / img.height);
      const sw = w / scale;
      const sh = h / scale;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
      let q = 0.85;
      let out = canvas.toDataURL('image/jpeg', q);
      while (out.length * 0.75 > limit && q > 0.4) {
        q -= 0.1;
        out = canvas.toDataURL('image/jpeg', q);
      }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать картинку.')); };
    img.src = url;
  });
}

async function loadProfile(username) {
  const host = $('#profile');
  host.replaceChildren(el('p', 'empty', 'Загрузка профиля…'));
  try {
    const p = username
      ? await api('/api/profile?username=' + encodeURIComponent(username))
      : (me ? me : (await api('/api/me')).profile);
    renderProfile(p);
  } catch (e) {
    host.replaceChildren(el('p', 'empty', e.message));
  }
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

function updateComposer() {
  const text = $('#postText').value;
  $('#counter').textContent = text.length + ' / 500';
  $('#postSubmit').disabled = !me || (!text.trim() && !pendingImage);
}

function clearImage() {
  pendingImage = '';
  $('#postImage').value = '';
  $('#imagePreview').src = '';
  $('#imagePreview').classList.add('hidden');
  $('#clearImage').classList.add('hidden');
  $('#fileLabel').textContent = 'Прикрепить картинку';
  updateComposer();
}

function routeFromLocation() {
  const m = location.pathname.match(/^\/u\/([^/]+)$/);
  if (m) return { tab: 'profile', username: decodeURIComponent(m[1]) };
  if (location.pathname === '/profile') return { tab: 'profile', username: '' };
  return { tab: 'feed', username: '' };
}

function wrapPostSelection(before, after, placeholder) {
  const ta = $('#postText');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.slice(start, end) || placeholder;
  ta.setRangeText(before + selected + after, start, end, 'select');
  ta.focus();
  updateComposer();
}

function prefixPostLines(prefix, placeholder) {
  const ta = $('#postText');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const block = ta.value.slice(start, end) || placeholder;
  const next = block.split('\n').map((line) => prefix + line).join('\n');
  ta.setRangeText(next, start, end, 'select');
  ta.focus();
  updateComposer();
}

function insertPostLink() {
  const ta = $('#postText');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const label = ta.value.slice(start, end) || 'текст';
  const url = 'https://';
  ta.setRangeText('[' + label + '](' + url + ')', start, end, 'end');
  const urlStart = start + label.length + 3;
  ta.setSelectionRange(urlStart, urlStart + url.length);
  ta.focus();
  updateComposer();
}

function initComposerToolbar() {
  document.querySelectorAll('.md-toolbar button[data-md]').forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.md;
      if (mode === 'bold') wrapPostSelection('**', '**', 'жирный');
      else if (mode === 'italic') wrapPostSelection('*', '*', 'курсив');
      else if (mode === 'link') insertPostLink();
      else if (mode === 'quote') prefixPostLines('> ', 'цитата');
      else if (mode === 'list') prefixPostLines('- ', 'пункт');
      else if (mode === 'code') {
        const ta = $('#postText');
        const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'код';
        if (selected.includes('\n')) wrapPostSelection('```\n', '\n```', selected);
        else wrapPostSelection('`', '`', 'код');
      }
    };
  });
}

async function init() {
  initTheme();
  await applyLook();
  initAppearance();
  initMarkdown();
  initComposerToolbar();

  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    try {
      const r = await api('/api/auth/exchange', { method: 'POST', body: { code } });
      token = r.token;
      localStorage.setItem(KEY, token);
      history.replaceState({}, '', location.pathname);
    } catch (e) {
      toast(e.message);
    }
  }

  if (token) {
    try {
      const r = await api('/api/me');
      me = r.profile;
    } catch (_) {
      token = '';
      me = null;
      localStorage.removeItem(KEY);
    }
  }

  $('#loginBox').classList.toggle('hidden', !!me);
  $('#layout').classList.toggle('hidden', !me);
  $('#loginLink').href = TASKS + '/sp-login.html?back=' + encodeURIComponent(location.origin + '/');
  renderUser();

  $('#brandLink').onclick = (e) => {
    e.preventDefault();
    profileEditing = false;
    setTab('feed', '');
  };
  document.querySelectorAll('nav a[data-tab]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      profileEditing = false;
      setTab(a.dataset.tab, '');
    };
  });
  window.addEventListener('popstate', () => {
    const r = routeFromLocation();
    setTab(r.tab, r.username);
  });

  $('#postText').addEventListener('input', updateComposer);
  $('#postImage').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const data = await compressImage(file);
      pendingImage = data;
      const preview = $('#imagePreview');
      preview.src = data;
      preview.classList.remove('hidden');
      $('#clearImage').classList.remove('hidden');
      $('#fileLabel').textContent = file.name + ' · ' + Math.round(data.length * 0.75 / 1024) + ' КБ';
      updateComposer();
    } catch (_) {
      toast('Не удалось прочитать картинку.');
    }
  });
  $('#clearImage').onclick = clearImage;

  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!me) return toast('Сначала войдите через Tasks.');
    const text = $('#postText').value.trim();
    if (!text && !pendingImage) return;
    try {
      await api('/api/posts', { method: 'POST', body: { text, image: pendingImage } });
      $('#postText').value = '';
      clearImage();
      loadPosts();
    } catch (err) {
      toast(err.message);
    }
  });

  const route = routeFromLocation();
  setTab(route.tab, route.username);
}

init();
