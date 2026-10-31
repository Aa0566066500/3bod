const $ = (id) => document.getElementById(id);

const state = {
  key: localStorage.getItem('lunex_access_key') || '',
  scripts: [],
  editingSlug: null
};

const welcome = $('welcome');
const workspace = $('workspace');
const editor = $('editor');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function showError(element, message) {
  element.textContent = message;
  element.classList.remove('hidden');
}

function hideError(element) {
  element.textContent = '';
  element.classList.add('hidden');
}

function notice(message) {
  $('notice').textContent = message;
  $('notice').classList.remove('hidden');

  setTimeout(() => $('notice').classList.add('hidden'), 4000);
}

function sourceUrl(slug) {
  return `${location.origin}/${encodeURIComponent(slug)}`;
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(state.key ? { 'x-lunex-key': state.key } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

function enterWorkspace() {
  welcome.classList.add('hidden');
  workspace.classList.remove('hidden');
  $('keyDisplay').textContent = state.key;
  loadScripts();
}

async function verifyAndEnter(key) {
  const result = await fetch('/api/verify-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key })
  });

  const data = await result.json();

  if (!result.ok || !data.valid) {
    throw new Error('المفتاح غير صحيح أو تم تعطيله.');
  }

  state.key = key;
  localStorage.setItem('lunex_access_key', key);
  enterWorkspace();
}

$('createKey').addEventListener('click', async () => {
  hideError($('welcomeError'));

  try {
    const data = await api('/api/owner-key', { method: 'POST' });

    state.key = data.key;
    localStorage.setItem('lunex_access_key', state.key);

    $('keyDisplay').textContent = state.key;
    enterWorkspace();

    alert(
      'تم إنشاء مفتاحك الخاص. انسخه واحفظه الآن؛ ' +
      'إذا فقدته فقد تفقد الوصول إلى سورساتك.'
    );
  } catch (error) {
    showError($('welcomeError'), error.message);
  }
});

$('enterKey').addEventListener('click', async () => {
  hideError($('welcomeError'));

  try {
    await verifyAndEnter($('existingKey').value.trim());
  } catch (error) {
    showError($('welcomeError'), error.message);
  }
});

$('logout').addEventListener('click', () => {
  state.key = '';
  state.scripts = [];
  localStorage.removeItem('lunex_access_key');
  workspace.classList.add('hidden');
  welcome.classList.remove('hidden');
  $('existingKey').value = '';
});

$('copyKey').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.key);
    notice('تم نسخ المفتاح.');
  } catch {
    notice('تعذر النسخ التلقائي. انسخ المفتاح يدويًا.');
  }
});

async function loadScripts() {
  $('scriptList').innerHTML = '';
  $('empty').classList.add('hidden');

  try {
    const data = await api('/api/scripts');
    state.scripts = data.scripts || [];
    renderScripts();
  } catch (error) {
    notice(error.message);
  }
}

function renderScripts() {
  const list = $('scriptList');
  list.innerHTML = '';

  if (!state.scripts.length) {
    $('empty').classList.remove('hidden');
    return;
  }

  $('empty').classList.add('hidden');

  for (const script of state.scripts) {
    const card = document.createElement('article');
    card.className = 'script-card';

    const status = script.enabled
      ? '<span class="badge enabled">● يعمل</span>'
      : '<span class="badge disabled">● معطّل</span>';

    card.innerHTML = `
      <div class="script-meta">
        ${status}
        <span>${escapeHtml(script.slug)}</span>
      </div>
      <h3>${escapeHtml(script.title)}</h3>
      <div class="script-url">${escapeHtml(sourceUrl(script.slug))}</div>
      <div class="script-actions">
        <button class="button secondary" data-action="copy">نسخ الرابط</button>
        <button class="button secondary" data-action="edit">تعديل</button>
        <button class="button secondary" data-action="toggle">
          ${script.enabled ? 'تعطيل' : 'تشغيل'}
        </button>
        <button class="button secondary" data-action="delete">حذف</button>
      </div>
    `;

    card.querySelectorAll('button').forEach(button => {
      button.addEventListener('click', () => {
        handleScriptAction(button.dataset.action, script);
      });
    });

    list.appendChild(card);
  }
}

async function handleScriptAction(action, script) {
  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(sourceUrl(script.slug));
      notice('تم نسخ رابط السورس.');
    } catch {
      notice(sourceUrl(script.slug));
    }
    return;
  }

  if (action === 'edit') {
    state.editingSlug = script.slug;
    $('editorTitle').textContent = 'تعديل السورس';
    $('scriptTitle').value = script.title;
    $('scriptSlug').value = script.slug;
    $('scriptSlug').disabled = true;
    $('sourceCode').value = script.content || '';
    updateCharCount();
    hideError($('editorError'));
    editor.showModal();
    return;
  }

  if (action === 'toggle') {
    const message = script.enabled
      ? 'هل تريد تعطيل هذا السورس؟'
      : 'هل تريد تشغيل هذا السورس؟';

    if (!confirm(message)) return;

    try {
      const result = await api(
        `/api/scripts/${encodeURIComponent(script.slug)}/toggle`,
        { method: 'POST' }
      );

      notice(result.enabled ? 'تم تشغيل السورس.' : 'تم تعطيل السورس.');
      await loadScripts();
    } catch (error) {
      notice(error.message);
    }
    return;
  }

  if (action === 'delete') {
    if (!confirm(`هل تريد حذف السورس ${script.title}؟`)) return;

    try {
      await api(`/api/scripts/${encodeURIComponent(script.slug)}`, {
        method: 'DELETE'
      });

      notice('تم حذف السورس.');
      await loadScripts();
    } catch (error) {
      notice(error.message);
    }
  }
}

function openNewEditor() {
  state.editingSlug = null;
  $('editorTitle').textContent = 'إنشاء سورس';
  $('scriptTitle').value = '';
  $('scriptSlug').value = '';
  $('scriptSlug').disabled = false;
  $('sourceCode').value = '';
  hideError($('editorError'));
  updateCharCount();
  editor.showModal();
}

$('newScript').addEventListener('click', openNewEditor);
$('emptyNew').addEventListener('click', openNewEditor);

function closeEditor() {
  editor.close();
}

$('closeEditor').addEventListener('click', closeEditor);
$('cancelEditor').addEventListener('click', closeEditor);

$('sourceCode').addEventListener('input', updateCharCount);

function updateCharCount() {
  $('charCount').textContent =
    `${$('sourceCode').value.length.toLocaleString('en-US')} حرف`;
}

$('scriptTitle').addEventListener('input', () => {
  if (state.editingSlug) return;

  $('scriptSlug').value = $('scriptTitle').value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
});

$('scriptForm').addEventListener('submit', async event => {
  event.preventDefault();
  hideError($('editorError'));

  const title = $('scriptTitle').value.trim();
  const slug = $('scriptSlug').value.trim().toLowerCase();
  const content = $('sourceCode').value;

  if (!/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/.test(slug)) {
    return showError(
      $('editorError'),
      'اسم الرابط يجب أن يكون من 3 إلى 64 حرفًا إنجليزيًا أو رقمًا.'
    );
  }

  try {
    if (state.editingSlug) {
      await api(`/api/scripts/${encodeURIComponent(state.editingSlug)}`, {
        method: 'PUT',
        body: JSON.stringify({ title, content })
      });

      notice('تم تحديث السورس.');
    } else {
      await api('/api/scripts', {
        method: 'POST',
        body: JSON.stringify({ title, slug, content })
      });

      notice('تم إنشاء السورس.');
    }

    closeEditor();
    await loadScripts();
  } catch (error) {
    showError($('editorError'), error.message);
  }
});

$('logsBtn').addEventListener('click', () => {
  $('logsPanel').classList.remove('hidden');
  loadLogs();
});

$('closeLogs').addEventListener('click', () => {
  $('logsPanel').classList.add('hidden');
});

$('refreshLogs').addEventListener('click', loadLogs);

async function loadLogs() {
  const list = $('logsList');
  list.innerHTML = '<p class="muted">جارٍ تحميل السجل...</p>';

  try {
    const data = await api('/api/logs');
    list.innerHTML = '';

    if (!data.logs?.length) {
      list.innerHTML = '<p class="muted">لا توجد أحداث مسجلة حتى الآن.</p>';
      return;
    }

    for (const log of data.logs) {
      const row = document.createElement('div');
      row.className = 'log-row';

      const time = new Date(log.created_at).toLocaleString('ar-SA');
      const details = JSON.stringify(log.details || {});

      row.innerHTML = `
        <strong>${escapeHtml(log.event_type)}</strong>
        <div>${escapeHtml(log.script_slug || 'غير معروف')}</div>
        <div class="muted small">${escapeHtml(time)}</div>
        <div class="muted small">${escapeHtml(details)}</div>
      `;

      list.appendChild(row);
    }
  } catch (error) {
    list.innerHTML = '';
    const message = document.createElement('p');
    message.className = 'error';
    message.textContent = error.message;
    list.appendChild(message);
  }
}

if (state.key) {
  verifyAndEnter(state.key).catch(() => {
    state.key = '';
    localStorage.removeItem('lunex_access_key');
    welcome.classList.remove('hidden');
    workspace.classList.add('hidden');
  });
}