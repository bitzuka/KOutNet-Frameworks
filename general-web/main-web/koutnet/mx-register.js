// SPDX-FileCopyrightText: 2026 Matvey Shcherbinin <bitzuka.koutnet@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

(function () {
  'use strict';

  const HS = 'koutnet.pw';
  const BASE = 'https://' + HS;

  // Токен регистрации: либо из ссылки (?token=...), либо зашитый ниже.
  // Всё, что лежит в публичном JS, видно любому посетителю.
  const REG_TOKEN = '';
  const token = new URLSearchParams(location.search).get('token') || REG_TOKEN;

  const lang = (document.documentElement.lang || navigator.language || 'ru').toLowerCase();
  const t = (ru, en) => (lang.startsWith('ru') ? ru : en);

  async function post(body) {
    const r = await fetch(BASE + '/_matrix/client/v3/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await r.json(); } catch (_) {}
    return { status: r.status, data };
  }

  async function register(username, password) {
    const base = {
      username: username,
      password: password,
      inhibit_login: true,
      initial_device_display_name: 'KOutNet web registration'
    };
    const supported = ['m.login.registration_token', 'm.login.dummy'];

    let res = await post(base);
    let guard = 0;
    while (res.status === 401 && res.data.session && guard++ < 6) {
      const flows = res.data.flows || [];
      const completed = res.data.completed || [];
      const flow = flows.find(f => (f.stages || []).every(s => supported.includes(s)));
      if (!flow) throw { errcode: 'X_UNSUPPORTED_FLOW' };
      const stage = flow.stages.find(s => !completed.includes(s));
      if (!stage) break;

      const auth = { type: stage, session: res.data.session };
      if (stage === 'm.login.registration_token') {
        if (!token) throw { errcode: 'X_TOKEN_REQUIRED' };
        auth.token = token;
      }
      res = await post(Object.assign({}, base, { auth: auth }));
    }
    if (res.status !== 200) {
      throw res.data && res.data.errcode ? res.data : { errcode: 'X_HTTP_' + res.status };
    }
    return res.data;
  }

  function errorText(err) {
    switch (err && err.errcode) {
      case 'M_USER_IN_USE':
        return t('Это имя уже занято', 'This username is already taken');
      case 'M_INVALID_USERNAME':
        return t('Недопустимое имя пользователя', 'Invalid username');
      case 'M_WEAK_PASSWORD':
        return t('Пароль слишком слабый', 'Password is too weak');
      case 'M_FORBIDDEN':
      case 'X_TOKEN_REQUIRED':
        return t('Регистрация закрыта или нужен токен приглашения',
                 'Registration is closed or an invite token is required');
      case 'M_LIMIT_EXCEEDED':
        return t('Слишком много попыток, попробуйте позже', 'Too many attempts, try again later');
      case 'X_UNSUPPORTED_FLOW':
        return t('Сервер требует шаг регистрации, который эта страница не поддерживает',
                 'The server requires a registration step this page does not support');
      default:
        return t('Не удалось связаться с сервером', 'Could not reach the server');
    }
  }

  document.addEventListener('submit', async function (e) {
    const form = e.target;
    if (!form || form.id !== 'regForm') return;
    e.preventDefault();
    e.stopImmediatePropagation();

    const userField = document.getElementById('username');
    const passField = document.getElementById('password');
    const confField = document.getElementById('confirm');
    const terms = form.querySelector('input[type="checkbox"]');
    const statusEl = form.querySelector('.status') || document.querySelector('.status');
    const btn = form.querySelector('button[type="submit"]') || form.querySelector('button');

    const setInvalid = (id, bad) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('invalid', bad);
    };
    const setStatus = (cls, text) => {
      if (!statusEl) return;
      statusEl.className = 'status ' + cls;
      statusEl.textContent = text;
    };

    const username = userField.value.trim();
    const password = passField.value;

    const userOk = /^[a-z0-9._-]{2,}$/.test(username);
    const passOk = password.length >= 8;
    const confOk = confField.value === password && password.length > 0;
    setInvalid('f-username', !userOk);
    setInvalid('f-password', !passOk);
    setInvalid('f-confirm', !confOk);
    if (!userOk || !passOk || !confOk) return;
    if (terms && !terms.checked) {
      setStatus('blocked', t('Нужно принять условия', 'You must accept the terms'));
      return;
    }

    if (btn) btn.disabled = true;
    setStatus('loading', t('Создаём аккаунт…', 'Creating account…'));

    try {
      const data = await register(username, password);
      const mxid = data.user_id || ('@' + username + ':' + HS);
      document.getElementById('formView').style.display = 'none';
      document.getElementById('successView').style.display = 'block';
      document.getElementById('mxidOut').textContent = mxid;
    } catch (err) {
      setStatus('blocked', errorText(err));
      if (btn) btn.disabled = false;
    }
  }, true);
})();
