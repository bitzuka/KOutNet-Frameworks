// Рендер SP-постов на Tasks: тот же markdown, фильтры и иконки, что и в SP.
(function () {
  const LIKE = '/like.png?v=likes1';
  const DISLIKE = '/dislike.png?v=reactions1';
  const TRASH = '/trash.png?v=reactions1';
  let md = null;

  const CSS = `
.sp-post-text { white-space: normal !important; }
.sp-reactions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-left: auto; }
.sp-reaction-btn { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
.sp-reaction-btn:hover { color: var(--accent); }
.sp-reaction-btn.liked { color: var(--ok); font-weight: 600; }
.sp-reaction-btn.disliked { color: var(--bad); font-weight: 600; }
.sp-like-icon { width: 16px; height: 16px; object-fit: contain; flex: none; }
.sp-views { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 13px; }
.sp-eye { display: inline-flex; align-items: center; }
.sp-eye svg { display: block; width: 17px; height: 14px; }
.sp-eye svg path[fill="#fff"] { fill: var(--fg); }
.sp-eye svg path[fill="#000"] { fill: var(--muted); }
.sp-eye svg path[stroke="#000"] { stroke: var(--fg); }
.sp-delete-icon { width: 15px; height: 15px; object-fit: contain; }
.sp-quote {
  position: relative; margin: 8px 12px 0; padding: 8px 10px 8px 18px;
  border-left: 2px solid var(--border); border-radius: 0 6px 6px 0;
  background: var(--card); color: var(--muted); font-size: 13px; overflow-wrap: anywhere;
}
.markdown-body > :first-child { margin-top: 0; }
.markdown-body > :last-child { margin-bottom: 0; }
.markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote,
.markdown-body pre, .markdown-body table, .markdown-body .markdown-alert { margin: 0 0 10px; }
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 { margin: 16px 0 8px; line-height: 1.25; }
.markdown-body h1 { font-size: 1.55em; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.markdown-body h2 { font-size: 1.35em; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.markdown-body h3 { font-size: 1.18em; }
.markdown-body h4 { font-size: 1.05em; }
.markdown-body h5, .markdown-body h6 { font-size: 1em; color: var(--muted); }
.markdown-body ul, .markdown-body ol { padding-left: 24px; }
.markdown-body li > p { margin: 0 0 4px; }
.markdown-body blockquote { padding: 0 12px; border-left: 4px solid var(--border); color: var(--muted); }
.markdown-body blockquote > :last-child { margin-bottom: 0; }
.markdown-body a { text-decoration: underline; }
.markdown-body hr { border: 0; border-top: 1px solid var(--border); margin: 16px 0; }
.markdown-body img { max-width: 100%; height: auto; border-radius: 6px; }
.markdown-body code {
  padding: .2em .4em; border-radius: 6px; background: var(--card);
  border: 1px solid var(--border); font-size: 85%;
}
.markdown-body pre { position: relative; padding: 12px; border-radius: 6px; background: var(--card);
  border: 1px solid var(--border); overflow-x: auto; }
.markdown-body pre code { padding: 0; border: 0; background: none; }
.markdown-body table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; }
.markdown-body th, .markdown-body td { padding: 5px 10px; border: 1px solid var(--border); }
.markdown-body .hljs-comment, .markdown-body .hljs-quote { color: var(--muted); }
.markdown-alert { padding: 10px 12px; border-left: 4px solid var(--accent); border-radius: 6px; background: var(--card); }
.markdown-alert-title { font-weight: 600; margin-bottom: 4px; }
.markdown-alert-caution { border-left-color: var(--bad); }
.markdown-alert-warning { border-left-color: var(--warn, #9a6700); }
.copy-code { position: absolute; top: 6px; right: 6px; font-size: 12px; padding: 3px 8px; }
.image-wrap { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
.image-download {
  position: absolute; top: 8px; right: 8px; z-index: 2;
  padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,.35);
  background: rgba(0,0,0,.65); color: #fff; font-size: 12px; line-height: 1.3;
  text-decoration: none; opacity: 0; pointer-events: none;
}
.image-wrap:hover .image-download, .image-wrap:focus-within .image-download { opacity: 1; pointer-events: auto; }
@media (hover: none) { .image-download { opacity: 1; pointer-events: auto; } }
`;

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
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function highlight(code, lang) {
    const hljs = window.hljs;
    if (!hljs) return escapeHtml(code);
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch (_) {}
    }
    try { return hljs.highlightAuto(code).value; } catch (_) { return escapeHtml(code); }
  }

  function init() {
    const MarkdownIt = window.markdownit;
    if (!MarkdownIt || !window.DOMPurify) return;
    const engine = new MarkdownIt({
      html: true, linkify: true, breaks: true, typographer: false, highlight
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
      } catch (_) {}
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
    } catch (_) { return 'изображение'; }
  }
  function wrapImage(img) {
    if (!img || img.closest('a') || img.parentElement?.classList.contains('image-downloaded')) return;
    const wrap = document.createElement('span');
    wrap.className = 'image-wrap image-downloaded';
    if (img.parentNode) {
      img.parentNode.insertBefore(wrap, img);
      wrap.append(img);
    } else {
      wrap.append(img);
    }
    const src = img.getAttribute('src') || img.src;
    const btn = document.createElement('a');
    btn.className = 'image-download';
    btn.href = src;
    btn.download = imageFileName(src);
    btn.textContent = 'скачать';
    btn.title = 'Скачать изображение';
    wrap.append(btn);
  }

  function render(text) {
    const plain = '<div class="sp-post-text post-text">' + escapeHtml(text).replace(/\n/g, '<br>') + '</div>';
    if (!md || !window.DOMPurify) return plain;
    let safe;
    try {
      safe = window.DOMPurify.sanitize(md.render(preprocessAlerts(text)), {
        USE_PROFILES: { html: true },
        ADD_TAGS: ['input'],
        ADD_ATTR: ['target', 'rel', 'id', 'class', 'type', 'checked', 'disabled', 'start', 'aria-label', 'aria-hidden'],
        FORBID_ATTR: ['style'],
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form']
      });
    } catch (_) { return plain; }
    const tpl = document.createElement('template');
    tpl.innerHTML = safe;
    tpl.content.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    });
    tpl.content.querySelectorAll('img').forEach(wrapImage);
    tpl.content.querySelectorAll('pre').forEach((pre) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-code';
      btn.dataset.copyCode = '1';
      btn.textContent = 'Копировать';
      pre.append(btn);
    });
    return '<div class="sp-post-text post-text markdown-body">' + tpl.innerHTML + '</div>';
  }

  document.addEventListener('click', (e) => {
    const copy = e.target.closest && e.target.closest('[data-copy-code]');
    if (copy) {
      const code = copy.parentElement.querySelector('code')?.textContent ?? '';
      navigator.clipboard.writeText(code).then(() => {
        copy.textContent = 'Скопировано';
        setTimeout(() => { copy.textContent = 'Копировать'; }, 1500);
      }).catch(() => { copy.textContent = 'Не вышло'; });
      return;
    }
    const link = e.target.closest && e.target.closest('a.image-download');
    if (link) {
      try {
        if (new URL(link.href, location.origin).origin !== location.origin) {
          e.preventDefault();
          fetch(link.href).then((r) => r.blob()).then((b) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = link.download;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          });
        }
      } catch (_) {}
    }
  });

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  init();
  window.KonPost = {
    render,
    like: LIKE,
    dislike: DISLIKE,
    trash: TRASH,
    eye: () => (typeof EYE_SVG === 'string' ? EYE_SVG : '')
  };
})();
