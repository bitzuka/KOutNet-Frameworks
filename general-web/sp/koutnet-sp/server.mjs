#!/usr/bin/env node
// KoutNet SP API: posts live here. Profiles, comments and activity come from the Tasks API.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const PORT = 3101;
const DATA = process.env.KOUTNET_SP_DIR || '/var/lib/koutnet-sp';
const UPLOADS = join(DATA, 'uploads');
const POSTS = join(DATA, 'posts.json');
const SESSIONS = join(DATA, 'sessions.json');
const TASKS_API = 'http://127.0.0.1:3100';
const TASKS_WEB = 'https://tasks.koutnet.pw';
const BRIDGE_KEY_FILE = process.env.KOUTNET_SP_BRIDGE_KEY || '/var/lib/koutnet-tasks/sp-bridge.key';
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const MAX_POST = 500;
const MAX_IMAGE = 400 * 1024;
const BG_PROXY_MAX = 5 * 1024 * 1024;
const VIEW_TTL = 24 * 3600 * 1000;
const VIEW_LIMIT = 5000;
mkdirSync(UPLOADS, { recursive: true });

const hash = (s) => createHash('sha256').update(s).digest('hex');
const readJson = (file, fallback) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
};
const atomicWrite = (file, data) => {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
};
const clean = (s, max) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const readSessions = () => readJson(SESSIONS, { sessions: [] }).sessions ?? [];
const writeSessions = (s) => atomicWrite(SESSIONS, { sessions: s });
const readPosts = () => readJson(POSTS, []);
const writePosts = (p) => atomicWrite(POSTS, p);
const reactions = (post, userId) => {
  const likes = Array.isArray(post.likes) ? post.likes : [];
  const dislikes = Array.isArray(post.dislikes) ? post.dislikes : [];
  return {
    likeCount: likes.length,
    dislikeCount: dislikes.length,
    likedByMe: !!userId && likes.includes(userId),
    dislikedByMe: !!userId && dislikes.includes(userId)
  };
};
const viewerKey = (req, me) => {
  if (me) return 'u:' + me.userId;
  const h = String(req.headers['x-sp-viewer'] ?? '');
  if (/^[A-Za-z0-9_-]{16,80}$/.test(h)) return 'v:' + h;
  return 'ip:' + hash(String(req.socket.remoteAddress ?? '') + '|' + String(req.headers['user-agent'] ?? ''));
};
const send = (res, code, obj) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
};
const sendImage = (res, buf, ext) => {
  const types = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };
  res.writeHead(200, {
    'Content-Type': types[ext] ?? 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buf);
};
const readBody = (req, limit = 900000) => new Promise((resolve) => {
  let d = '';
  let over = false;
  req.on('data', (c) => {
    if (over) return;
    d += c;
    if (d.length > limit) { over = true; d = ''; }
  });
  req.on('end', () => {
    if (over) return resolve({ _over: true });
    try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); }
  });
});

const buckets = new Map();
const limited = (key, max, windowMs) => {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return true; }
  arr.push(now);
  buckets.set(key, arr);
  return false;
};
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const next = arr.filter((t) => now - t < 3600000);
    if (!next.length) buckets.delete(k); else buckets.set(k, next);
  }
}, 600000).unref();

// ---------- bridge to Tasks: the only source of profiles, comments and activity ----------
const bridgeKey = () => { try { return readFileSync(BRIDGE_KEY_FILE, 'utf8').trim(); } catch { return ''; } };
const bridgeHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: 'Bearer ' + bridgeKey()
});
const isBridge = (req) => {
  const addr = req.socket.remoteAddress;
  if (addr !== '127.0.0.1' && addr !== '::1') return false;
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  const key = bridgeKey();
  return !!m && !!key && m[1] === key;
};

const profileCache = new Map();
async function tasksProfile(query) {
  // Profiles include live activity. Do not cache here: Tasks is local and the
  // numbers must update immediately after comments and SP posts.
  try {
    const q = query.userId
      ? 'userId=' + encodeURIComponent(query.userId)
      : 'username=' + encodeURIComponent(query.username ?? '');
    const r = await fetch(TASKS_API + '/api/sp/profile?' + q, { headers: bridgeHeaders() });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
const abs = (u) => u ? (u.startsWith('http') ? u : TASKS_WEB + '/' + String(u).replace(/^\//, '')) : '';
// Tasks profile view, only URLs made absolute and id kept for SP's own data
const spProfileView = (p) => p ? {
  id: p.id,
  username: p.username,
  displayName: p.displayName || p.username,
  verified: !!p.verified,
  adm: !!p.adm,
  bio: p.bio || '',
  avatarUrl: abs(p.avatarUrl),
  bannerUrl: abs(p.bannerUrl),
  createdAt: p.createdAt || '',
  stats: p.stats || { solved: 0, applies: 0, comments: 0 },
  calendar: p.calendar || {},
  solved: p.solved || []
} : null;
const authorOf = async (userId) => spProfileView(await tasksProfile({ userId }));
// a highlighted comment is rendered like a normal post author: avatar, nick, flags
async function enrichHighlight(h, cache = null) {
  if (!h) return null;
  if (!h.userId) return h;
  let a;
  if (cache && cache.has(h.userId)) a = cache.get(h.userId);
  else {
    a = await authorOf(h.userId);
    if (cache) cache.set(h.userId, a);
  }
  return {
    ...h,
    username: a?.username || h.username || '',
    author: a?.displayName || h.author || '',
    verified: a ? a.verified : !!h.verified,
    adm: a ? a.adm : !!h.adm,
    avatarUrl: a?.avatarUrl || ''
  };
}
async function bridgeRequest(path, method, body) {
  try {
    const options = { method, headers: bridgeHeaders() };
    if (method !== 'GET') options.body = JSON.stringify(body ?? {});
    const r = await fetch(TASKS_API + path, options);
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, data };
  } catch { return { ok: false, data: { error: 'Tasks API недоступен.' } }; }
}
async function spCommentCounts() {
  const r = await bridgeRequest('/api/sp/comment-counts', 'GET');
  return r.ok && r.data && typeof r.data === 'object' ? r.data : {};
}
async function spCommentDigest(viewerId) {
  const q = '/api/sp/comment-digest' + (viewerId ? '?viewerId=' + encodeURIComponent(viewerId) : '');
  const r = await bridgeRequest(q, 'GET');
  return r.ok && r.data && typeof r.data === 'object' ? r.data : {};
}

async function notifyActivity(userId, at) {
  try {
    await fetch(TASKS_API + '/api/sp/activity', {
      method: 'POST',
      headers: bridgeHeaders(),
      body: JSON.stringify({ userId, at })
    });
  } catch (e) { console.error('Tasks activity sync failed:', e.message); }
}

const isPrivateIp = (value) => {
  const ip = String(value).toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
  if (ip === '::1' || ip === '::' || ip === '0.0.0.0') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
};
const validateProxyUrl = async (raw) => {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try { addresses = await lookup(host, { all: true }); } catch { return null; }
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) return null;
  return u;
};

const sessionUser = (req) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const th = hash(m[1]);
  const s = readSessions().find((x) => x.tokenHash === th && x.expires > Date.now());
  return s ? { userId: s.userId } : null;
};

function parseImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) return { error: 'Нужна картинка JPEG, PNG или WebP.' };
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return { error: 'Битая картинка.' }; }
  if (!buf.length || buf.length > MAX_IMAGE) {
    return { error: 'Картинка слишком большая, максимум 400 КБ после сжатия.' };
  }
  let ext = '';
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
  else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
  else if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') ext = 'webp';
  if (!ext) return { error: 'Файл не похож на картинку.' };
  return { buf, ext };
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true });

    // Same-origin proxy for user wallpapers: the browser can sample colors
    // without CORS, while private addresses and non-images are refused.
    if (p === '/api/bg-proxy' && req.method === 'GET') {
      if (limited('bg:' + (req.socket.remoteAddress || ''), 30, 60000)) {
        return send(res, 429, { error: 'Слишком много запросов к фонам.' });
      }
      let current = await validateProxyUrl(url.searchParams.get('url') || '');
      if (!current) return send(res, 400, { error: 'Некорректная ссылка на фон.' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        for (let hops = 0; hops < 4; hops++) {
          const r = await fetch(current, {
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
              'User-Agent': 'KoutNet-SP/1.0'
            }
          });
          if (r.status >= 300 && r.status < 400) {
            const loc = r.headers.get('location');
            if (!loc) break;
            const next = await validateProxyUrl(new URL(loc, current).toString());
            if (!next) return send(res, 403, { error: 'Фон ведёт на недоступный адрес.' });
            current = next;
            continue;
          }
          const type = (r.headers.get('content-type') || '').split(';')[0].toLowerCase();
          if (!r.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type)) {
            return send(res, 415, { error: 'По ссылке должна быть картинка.' });
          }
          if (Number(r.headers.get('content-length') || 0) > BG_PROXY_MAX) {
            return send(res, 413, { error: 'Картинка слишком большая.' });
          }
          const chunks = [];
          let size = 0;
          for await (const chunk of r.body) {
            size += chunk.length;
            if (size > BG_PROXY_MAX) {
              controller.abort();
              return send(res, 413, { error: 'Картинка слишком большая.' });
            }
            chunks.push(chunk);
          }
          res.writeHead(200, {
            'Content-Type': type,
            'Cache-Control': 'public, max-age=3600',
            'X-Content-Type-Options': 'nosniff'
          });
          return res.end(Buffer.concat(chunks));
        }
        return send(res, 502, { error: 'Слишком много перенаправлений.' });
      } catch (e) {
        return send(res, 502, {
          error: 'Не удалось загрузить фон: ' + (e.name === 'AbortError' ? 'таймаут' : 'ошибка сети')
        });
      } finally {
        clearTimeout(timeout);
      }
    }


    // Tasks asks SP to clean up its own data when an account is deleted
    if (p === '/api/internal/forget' && req.method === 'POST') {
      if (!isBridge(req)) return send(res, 401, { error: 'Нет доступа' });
      const b = await readBody(req);
      const userId = String(b.userId ?? '');
      if (!userId) return send(res, 400, { error: 'Нет userId' });
      const posts = readPosts();
      const images = posts.filter((x) => x.userId === userId && x.image).map((x) => x.image);
      const keptPosts = posts.filter((x) => x.userId !== userId);
      if (keptPosts.length !== posts.length) writePosts(keptPosts);
      for (const img of images) { try { unlinkSync(join(UPLOADS, img)); } catch { /* gone */ } }
      const sessions = readSessions();
      const keptSessions = sessions.filter((x) => x.userId !== userId);
      if (keptSessions.length !== sessions.length) writeSessions(keptSessions);
      profileCache.delete('id:' + userId);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/auth/exchange' && req.method === 'POST') {
      const b = await readBody(req);
      const code = String(b.code ?? '');
      if (!/^[a-f0-9]{48}$/.test(code)) return send(res, 400, { error: 'Некорректный код.' });
      let r;
      let data = {};
      try {
        r = await fetch(TASKS_API + '/api/auth/sp-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        data = await r.json();
      } catch { return send(res, 503, { error: 'Tasks API недоступен.' }); }
      if (!r.ok || !data.id) return send(res, 401, { error: data.error || 'Код не подошёл.' });
      const token = randomBytes(32).toString('hex');
      const sessions = readSessions().filter((s) => s.expires > Date.now() && s.userId !== data.id);
      sessions.push({ tokenHash: hash(token), userId: data.id, expires: Date.now() + SESSION_TTL });
      writeSessions(sessions);
      profileCache.set('id:' + data.id, { value: data, expires: Date.now() + 30000 });
      return send(res, 200, { token, profile: spProfileView(data) });
    }

    const me = sessionUser(req);

    if (p === '/api/auth/logout' && req.method === 'POST') {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
      if (m) writeSessions(readSessions().filter((s) => s.tokenHash !== hash(m[1])));
      return send(res, 200, { ok: true });
    }

    if (p === '/api/me' && req.method === 'GET') {
      if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
      const profile = await authorOf(me.userId);
      if (!profile) return send(res, 401, { error: 'Аккаунт Tasks не найден.' });
      return send(res, 200, {
        profile,
        posts: readPosts().filter((x) => x.userId === me.userId).length
      });
    }

    // public profile from Tasks (same data the Tasks profile page uses)
    if (p === '/api/profile' && req.method === 'GET') {
      const name = clean(url.searchParams.get('username'), 40);
      if (!name) return send(res, 400, { error: 'Укажите ник.' });
      const profile = spProfileView(await tasksProfile({ username: name }));
      if (!profile) return send(res, 404, { error: 'Нет такого пользователя.' });
      return send(res, 200, profile);
    }

    // edit profile and images: SP only forwards to Tasks, which owns the data
    if (p === '/api/profile' && req.method === 'PUT') {
      if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
      const b = await readBody(req);
      const r = await bridgeRequest('/api/sp/profile', 'POST', {
        userId: me.userId, displayName: b.displayName, bio: b.bio
      });
      if (!r.ok) return send(res, 400, { error: r.data.error || 'Не удалось сохранить.' });
      profileCache.clear();
      return send(res, 200, spProfileView(r.data));
    }

    const pim = p.match(/^\/api\/profile\/image\/(avatar|banner)$/);
    if (pim && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
      const b = await readBody(req);
      if (b._over) return send(res, 413, { error: 'Файл слишком большой.' });
      const r = await bridgeRequest('/api/sp/image/' + pim[1], req.method, {
        userId: me.userId, data: b.data
      });
      if (!r.ok) return send(res, 400, { error: r.data.error || 'Не удалось сохранить картинку.' });
      profileCache.clear();
      return send(res, 200, spProfileView(r.data));
    }

    if (p === '/api/profile/delete' && req.method === 'POST') {
      if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
      const b = await readBody(req);
      const r = await bridgeRequest('/api/sp/delete', 'POST', {
        userId: me.userId, password: String(b.password ?? '')
      });
      if (!r.ok) return send(res, 401, { error: r.data.error || 'Не удалось удалить аккаунт.' });
      writeSessions(readSessions().filter((x) => x.userId !== me.userId));
      profileCache.clear();
      return send(res, 200, { ok: true });
    }

    const postView = async (x, commentCount = 0, author = null, commentHighlight = null) => ({
      id: x.id, text: x.text, image: x.image ? '/api/images/' + x.image : '',
      createdAt: x.createdAt, author: author ?? await authorOf(x.userId),
      commentCount, commentHighlight,
      views: Number(x.views) || 0,
      ...reactions(x, me?.userId),
      ownedByMe: !!me && x.userId === me.userId
    });

    if (p === '/api/posts' && req.method === 'GET') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const before = url.searchParams.get('before') ?? '';
      const username = (url.searchParams.get('username') ?? '').trim().toLowerCase();
      let list = readPosts().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (before) list = list.filter((x) => x.createdAt < before);
      const authors = new Map();
      if (username) {
        const pairs = await Promise.all(list.map(async (x) => [x, await authorOf(x.userId)]));
        list = pairs.filter(([, a]) => a?.username?.toLowerCase() === username).map(([x, a]) => {
          authors.set(x.id, a);
          return x;
        });
      }
      const digest = await spCommentDigest(me?.userId);
      const highlightAuthors = new Map();
      return send(res, 200, await Promise.all(
        list.slice(0, limit).map(async (x) => postView(
          x, digest[x.id]?.count ?? 0, authors.get(x.id),
          await enrichHighlight(digest[x.id]?.highlight, highlightAuthors)
        ))
      ));
    }

    if (p === '/api/posts' && req.method === 'POST') {
      if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
      if (limited('post:' + me.userId, 1, 4000)) {
        return send(res, 429, { error: 'Не так быстро, подождите пару секунд.' });
      }
      const b = await readBody(req);
      if (b._over) return send(res, 413, { error: 'Слишком большой запрос.' });
      const text = clean(b.text, MAX_POST);
      if (!text) return send(res, 400, { error: 'Напишите что-нибудь, до 500 символов.' });
      const id = randomUUID();
      let image = '';
      if (b.image) {
        const img = parseImage(b.image);
        if (img.error) return send(res, 400, { error: img.error });
        const name = id + '.' + img.ext;
        writeFileSync(join(UPLOADS, name), img.buf);
        image = name;
      }
      const post = { id, userId: me.userId, text, image, createdAt: new Date().toISOString() };
      const list = readPosts();
      list.push(post);
      writePosts(list);
      await notifyActivity(me.userId, post.createdAt);
      return send(res, 200, await postView(post));
    }

    // reactions on posts: likes and dislikes are mutually exclusive, stored with the post
    const rr = p.match(/^\/api\/posts\/([^/]+)\/(like|dislike)$/);
    if (rr && req.method === 'POST') {
      if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
      if (limited('react:' + me.userId, 30, 60000)) {
        return send(res, 429, { error: 'Не так быстро, подождите минуту.' });
      }
      const postId = decodeURIComponent(rr[1]);
      const kind = rr[2];
      const list = readPosts();
      const post = list.find((x) => x.id === postId);
      if (!post) return send(res, 404, { error: 'Пост не найден.' });
      const likes = Array.isArray(post.likes) ? post.likes.slice() : [];
      const dislikes = Array.isArray(post.dislikes) ? post.dislikes.slice() : [];
      const li = likes.indexOf(me.userId);
      const di = dislikes.indexOf(me.userId);
      if (kind === 'like') {
        if (li >= 0) likes.splice(li, 1);
        else {
          likes.push(me.userId);
          if (di >= 0) dislikes.splice(di, 1);
        }
      } else {
        if (di >= 0) dislikes.splice(di, 1);
        else {
          dislikes.push(me.userId);
          if (li >= 0) likes.splice(li, 1);
        }
      }
      post.likes = likes;
      post.dislikes = dislikes;
      writePosts(list);
      return send(res, 200, { id: postId, ...reactions(post, me.userId) });
    }

    // views are counted once per viewer per day, and only when the client actually sees the post
    const vr = p.match(/^\/api\/posts\/([^/]+)\/view$/);
    if (vr && req.method === 'POST') {
      const postId = decodeURIComponent(vr[1]);
      const list = readPosts();
      const post = list.find((x) => x.id === postId);
      if (!post) return send(res, 404, { error: 'Пост не найден.' });
      const key = viewerKey(req, me);
      const viewers = post.viewers && typeof post.viewers === 'object' && !Array.isArray(post.viewers)
        ? { ...post.viewers } : {};
      const now = Date.now();
      for (const [k, t] of Object.entries(viewers)) {
        if (!Number.isFinite(Number(t)) || now - Number(t) > VIEW_TTL) delete viewers[k];
      }
      const counted = !Object.prototype.hasOwnProperty.call(viewers, key);
      if (counted) {
        viewers[key] = now;
        const keys = Object.keys(viewers);
        if (keys.length > VIEW_LIMIT) {
          keys.sort((a, b) => Number(viewers[a]) - Number(viewers[b]))
            .slice(0, keys.length - VIEW_LIMIT).forEach((k) => { delete viewers[k]; });
        }
        post.views = (Number(post.views) || 0) + 1;
      }
      post.viewers = viewers;
      writePosts(list);
      return send(res, 200, { id: postId, views: Number(post.views) || 0, counted });
    }

    // own posts can be removed from the profile; comments on them go away with the post
    const dr = p.match(/^\/api\/posts\/([^/]+)$/);
    if (dr && req.method === 'DELETE') {
      if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
      const postId = decodeURIComponent(dr[1]);
      const list = readPosts();
      const post = list.find((x) => x.id === postId);
      if (!post) return send(res, 404, { error: 'Пост не найден.' });
      if (post.userId !== me.userId) return send(res, 403, { error: 'Можно удалить только свой пост.' });
      writePosts(list.filter((x) => x.id !== postId));
      if (post.image) {
        try { unlinkSync(join(UPLOADS, post.image)); } catch (_) { /* already gone */ }
      }
      await bridgeRequest('/api/sp/comments/by-post/' + encodeURIComponent(postId), 'DELETE', {
        userId: me.userId
      });
      return send(res, 200, { ok: true });
    }

    // likes on SP comments: Tasks owns the votes, SP only forwards the session user
    const lm = p.match(/^\/api\/posts\/([^/]+)\/comments\/([^/]+)\/like$/);
    if (lm && req.method === 'POST') {
      if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
      const postId = decodeURIComponent(lm[1]);
      if (!readPosts().some((x) => x.id === postId)) return send(res, 404, { error: 'Пост не найден.' });
      const r = await bridgeRequest(
        '/api/sp/comments/' + encodeURIComponent(lm[2]) + '/like', 'POST', { userId: me.userId }
      );
      if (!r.ok) return send(res, 400, { error: r.data.error || 'Не удалось поставить лайк.' });
      return send(res, 200, { ...r.data, highlight: await enrichHighlight(r.data.highlight) });
    }

    // own comments on posts: Tasks owns storage and checks authorship
    const cdm = p.match(/^\/api\/posts\/([^/]+)\/comments\/([^/]+)$/);
    if (cdm && req.method === 'DELETE') {
      if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
      const postId = decodeURIComponent(cdm[1]);
      if (!readPosts().some((x) => x.id === postId)) return send(res, 404, { error: 'Пост не найден.' });
      const r = await bridgeRequest(
        '/api/sp/comments/' + encodeURIComponent(cdm[2]), 'DELETE', { userId: me.userId }
      );
      if (!r.ok) return send(res, 400, { error: r.data.error || 'Не удалось удалить комментарий.' });
      const digest = await spCommentDigest(me.userId);
      return send(res, 200, {
        ...r.data,
        highlight: await enrichHighlight(digest[postId]?.highlight),
        count: digest[postId]?.count ?? 0
      });
    }

    // comments on posts: stored and rendered by Tasks, SP is just a client
    const cm = p.match(/^\/api\/posts\/([^/]+)\/comments$/);
    if (cm) {
      const postId = decodeURIComponent(cm[1]);
      if (!readPosts().some((x) => x.id === postId)) return send(res, 404, { error: 'Пост не найден.' });
      if (req.method === 'GET') {
        const q = '/api/sp/comments?postId=' + encodeURIComponent(postId) +
          (me ? '&viewerId=' + encodeURIComponent(me.userId) : '');
        const r = await bridgeRequest(q, 'GET');
        if (!r.ok) return send(res, 502, { error: r.data.error || 'Не удалось загрузить комментарии.' });
        return send(res, 200, r.data);
      }
      if (req.method === 'POST') {
        if (!me) return send(res, 401, { error: 'Нужно войти через Tasks.' });
        const b = await readBody(req);
        if (String(b.text ?? '').trim().length > 250) {
          return send(res, 400, { error: 'Комментарий не длиннее 250 символов.' });
        }
        const r = await bridgeRequest('/api/sp/comments', 'POST', {
          userId: me.userId,
          postId,
          text: b.text,
          parentId: b.parentId ?? ''
        });
        if (!r.ok) return send(res, 400, { error: r.data.error || 'Не удалось отправить комментарий.' });
        return send(res, 200, r.data);
      }
    }

    const im = p.match(/^\/api\/images\/([A-Za-z0-9_-]+\.(?:webp|jpg|png))$/);
    if (im && req.method === 'GET') {
      try {
        return sendImage(res, readFileSync(join(UPLOADS, im[1])), im[1].split('.').pop());
      } catch { return send(res, 404, { error: 'Картинка не найдена.' }); }
    }

    return send(res, 404, { error: 'Не найдено.' });
  } catch {
    return send(res, 500, { error: 'Ошибка сервера.' });
  }
}).listen(PORT, '127.0.0.1', () => console.log('KoutNet SP API on 127.0.0.1:' + PORT));
