// SPDX-FileCopyrightText: 2026 Matvey Shcherbinin <bitzuka.koutnet@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

(function () {
  'use strict';

  const form = document.getElementById('regForm');
  if (!form) return;

  const userField = document.getElementById('username');
  const passField = document.getElementById('password');
  const confField = document.getElementById('confirm');
  const terms = form.querySelector('input[type="checkbox"]');
  const submitBtn = document.getElementById('submitBtn') ||
                    form.querySelector('button[type="submit"]');
  const statusEl = form.querySelector('.status') || document.querySelector('.status');
  if (!userField || !passField || !confField || !submitBtn) return;

  const passLabel = document.querySelector('label[for="password"]');
  const isEn = () => !!passLabel && /password/i.test(passLabel.textContent);
  const t = (ru, en) => (isEn() ? en : ru);

  // short — текст в чипсе, full — подсказка при наведении
  const rules = [
    { ok: v => v.length >= 8,
      sru: '8+ символов', sen: '8+ chars',
      fru: 'Не менее 8 символов', fen: 'At least 8 characters' },
    { ok: v => /[a-z]/.test(v),
      sru: 'a–z', sen: 'a–z',
      fru: 'Строчная латинская буква', fen: 'A lowercase Latin letter' },
    { ok: v => /[A-Z]/.test(v),
      sru: 'A–Z', sen: 'A–Z',
      fru: 'Заглавная латинская буква', fen: 'An uppercase Latin letter' },
    { ok: v => /[0-9]/.test(v),
      sru: '0–9', sen: '0–9',
      fru: 'Хотя бы одна цифра', fen: 'At least one digit' },
    { ok: () => passField.value.length > 0 && confField.value === passField.value,
      sru: 'совпадают', sen: 'match',
      fru: 'Пароли совпадают', fen: 'Passwords match',
      useConfirm: true }
  ];

  // Компактный ряд чипсов
  const row = document.createElement('div');
  row.id = 'pwRules';
  row.style.cssText =
    'display:flex;flex-wrap:wrap;justify-content:center;gap:4px 5px;' +
    'margin:6px 0 2px;padding:0;font-size:11.5px;line-height:1.3;';
  const holder = passField.closest('.password-field') || passField;
  holder.insertAdjacentElement('afterend', row);

  const chips = rules.map(() => {
    const c = document.createElement('span');
    c.style.cssText =
      'padding:1px 8px;border-radius:999px;border:1px solid currentColor;' +
      'white-space:nowrap;transition:color .15s,opacity .15s;';
    row.appendChild(c);
    return c;
  });

  let touched = false;

  function usernameProblem() {
    const v = userField.value.trim();
    if (!v) return t('введите имя пользователя', 'enter a username');
    if (v.length < 2) return t('имя не короче 2 символов', 'username: at least 2 characters');
    if (/[A-Z]/.test(v)) return t('в имени нельзя заглавные буквы', 'username: no uppercase letters');
    if (/\s/.test(v)) return t('в имени нельзя пробелы', 'username: no spaces');
    if (!/^[a-z0-9._-]+$/.test(v)) {
      return t('имя: только a–z, 0–9, "-", "_", "."', 'username: only a–z, 0–9, "-", "_", "."');
    }
    return null;
  }

  function render() {
    const pv = passField.value;
    const results = rules.map(r => r.ok(pv));

    chips.forEach((c, i) => {
      const r = rules[i];
      const ok = results[i];
      const started = touched && (r.useConfirm ? confField.value.length > 0 : pv.length > 0);
      c.textContent = (ok ? '✓ ' : started ? '✗ ' : '') + t(r.sru, r.sen);
      c.title = t(r.fru, r.fen);
      c.style.color = ok ? '#27ae60' : started ? '#da4453' : 'inherit';
      c.style.opacity = ok || started ? '1' : '0.55';
    });

    const extra = [];
    const up = usernameProblem();
    if (up) extra.push(up);
    if (terms && !terms.checked) extra.push(t('нужно принять условия', 'accept the terms'));

    const allOk = results.every(Boolean) && extra.length === 0;
    submitBtn.disabled = !allOk;

    if (statusEl && touched) {
      if (extra.length) {
        statusEl.className = 'status blocked';
        statusEl.textContent = t('Не хватает: ', 'Missing: ') + extra.join('; ');
      } else {
        statusEl.className = 'status';
        statusEl.textContent = '';
      }
    }
  }

  function onChange() { touched = true; render(); }

  [userField, passField, confField].forEach(el => el.addEventListener('input', onChange));
  if (terms) terms.addEventListener('change', onChange);

  if (passLabel) {
    new MutationObserver(render).observe(passLabel, { childList: true, characterData: true, subtree: true });
  }

  render();
})();
