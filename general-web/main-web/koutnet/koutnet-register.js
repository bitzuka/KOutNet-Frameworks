(function () {
  'use strict';

  const lang = (document.documentElement.lang || navigator.language || 'ru').toLowerCase();
  const t = (ru, en) => (lang.startsWith('ru') ? ru : en);

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

    const userOk = /^[A-Za-z0-9_]{3,20}$/.test(username);
    const passOk = password.length >= 8 && password.length <= 100;
    const confOk = confField.value === password && password.length > 0;
    setInvalid('f-username', !userOk);
    setInvalid('f-password', !passOk);
    setInvalid('f-confirm', !confOk);
    if (!userOk || !passOk || !confOk) {
      if (!userOk) setStatus('blocked', t('Ник: 3-20 символов, латиница, цифры и _.', 'Nick: 3-20 characters, Latin letters, digits and _.'));
      else if (!passOk) setStatus('blocked', t('Пароль: от 8 до 100 символов.', 'Password: 8 to 100 characters.'));
      else setStatus('blocked', t('Пароли не совпадают.', 'Passwords do not match.'));
      return;
    }
    if (terms && !terms.checked) {
      setStatus('blocked', t('Нужно принять условия', 'You must accept the terms'));
      return;
    }

    if (btn) btn.disabled = true;
    setStatus('loading', t('Создаём аккаунт…', 'Creating account…'));

    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
      let data = {};
      try { data = await r.json(); } catch (_) {}
      if (!r.ok) throw { error: data.error || 'X_HTTP_' + r.status };

      document.getElementById('formView').style.display = 'none';
      document.getElementById('successView').style.display = 'block';
      document.getElementById('mxidOut').textContent = username;
    } catch (err) {
      setStatus('blocked', errorText(err));
      if (btn) btn.disabled = false;
    }
  }, true);

  function errorText(err) {
    switch (err && err.error) {
      case 'Этот ник занят.': return err.error;
      case 'Ник: 3-20 символов, латинские буквы, цифры и _.': return err.error;
      case 'Пароль: от 8 до 100 символов.': return err.error;
      case 'Регистрация временно закрыта.': return err.error;
      case 'Слишком много попыток, попробуйте позже.': return err.error;
      case 'Не удалось прочитать запрос.': return err.error;
      default: return t('Не удалось связаться с сервером', 'Could not reach the server');
    }
  }
})();
