"use strict";

/* =========================================
   LUNEX SCRIPTS — FRONTEND CONTROLLER
========================================= */

const $ = (id) => document.getElementById(id);

const state = {
  key: sessionStorage.getItem("lunex_key") || "",
  scripts: [],
  editingSlug: null,
  busy: false
};

const els = {
  welcome: $("welcome"),
  workspace: $("workspace"),
  existingKey: $("existingKey"),
  createKey: $("createKey"),
  copyKey: $("copyKey"),
  enterKey: $("enterKey"),
  welcomeError: $("welcomeError"),
  logout: $("logout"),
  keyDisplay: $("keyDisplay"),
  notice: $("notice"),
  scriptList: $("scriptList"),
  empty: $("empty"),
  newScript: $("newScript"),
  emptyNew: $("emptyNew"),
  logsBtn: $("logsBtn"),
  logsPanel: $("logsPanel"),
  closeLogs: $("closeLogs"),
  refreshLogs: $("refreshLogs"),
  logsList: $("logsList"),
  editor: $("editor"),
  scriptForm: $("scriptForm"),
  editorTitle: $("editorTitle"),
  closeEditor: $("closeEditor"),
  cancelEditor: $("cancelEditor"),
  scriptTitle: $("scriptTitle"),
  scriptSlug: $("scriptSlug"),
  sourceCode: $("sourceCode"),
  charCount: $("charCount"),
  editorError: $("editorError")
};

let noticeTimer = null;

/* =========================================
   API HELPERS
========================================= */

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (options.body && typeof options.body !== "string") {
    options.body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }

  if (state.key) {
    headers["x-lunex-key"] = state.key;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `حدث خطأ في الطلب (${response.status})`
    );
  }

  return data;
}

/* =========================================
   MESSAGES
========================================= */

function showNotice(message) {
  if (!els.notice) return;

  els.notice.textContent = message;
  els.notice.classList.remove("hidden");

  clearTimeout(noticeTimer);

  noticeTimer = setTimeout(() => {
    els.notice.classList.add("hidden");
  }, 3000);
}

function showError(element, message) {
  if (!element) return;

  element.textContent = message;
  element.classList.remove("hidden");
}

function clearError(element) {
  if (!element) return;

  element.textContent = "";
  element.classList.add("hidden");
}

function setBusy(button, busy, label) {
  if (!button) return;

  button.disabled = busy;

  if (busy) {
    button.dataset.oldText = button.textContent;
    button.textContent = label || "انتظر...";
  } else if (button.dataset.oldText) {
    button.textContent = button.dataset.oldText;
    delete button.dataset.oldText;
  }
}

/* =========================================
   AUTHENTICATION
========================================= */

function saveKey(key) {
  state.key = key;

  if (key) {
    sessionStorage.setItem("lunex_key", key);
  } else {
    sessionStorage.removeItem("lunex_key");
  }
}

function showWelcome() {
  els.welcome?.classList.remove("hidden");
  els.workspace?.classList.add("hidden");
}

function showWorkspace() {
  els.welcome?.classList.add("hidden");
  els.workspace?.classList.remove("hidden");

  if (els.keyDisplay) {
    els.keyDisplay.textContent = state.key;
  }
}

async function createKey() {
  clearError(els.welcomeError);

  setBusy(els.createKey, true, "جارٍ الإنشاء...");

  try {
    const result = await api("/api/owner-key", {
      method: "POST",
      body: {}
    });

    const key = result.key || result.ownerKey;

    if (!key) {
      throw new Error("الخادم لم يُرجع المفتاح.");
    }

    els.existingKey.value = key;

    showNotice("تم إنشاء المفتاح. احتفظ به في مكان آمن.");

  } catch (error) {
    showError(els.welcomeError, error.message);
  } finally {
    setBusy(els.createKey, false);
  }
}

async function verifyAndEnter(key) {
  clearError(els.welcomeError);

  if (!key) {
    showError(els.welcomeError, "أدخل مفتاحك الخاص أولًا.");
    return false;
  }

  setBusy(els.enterKey, true, "جارٍ التحقق...");

  try {
    const result = await api("/api/verify-key", {
      method: "POST",
      body: { key }
    });

    if (result.valid === false || result.success === false) {
      throw new Error("المفتاح غير صحيح أو غير مفعّل.");
    }

    saveKey(key);
    showWorkspace();

    await loadScripts();

    return true;

  } catch (error) {
    saveKey("");
    showWelcome();
    showError(els.welcomeError, error.message);
    return false;

  } finally {
    setBusy(els.enterKey, false);
  }
}

async function copyText(text) {
  if (!text) {
    showError(els.welcomeError, "أنشئ مفتاحًا أولًا.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showNotice("تم النسخ بنجاح.");
  } catch {
    const input = els.existingKey;

    if (input) {
      input.value = text;
      input.focus();
      input.select();

      showNotice("حدد المفتاح ثم اختر نسخ.");
    }
  }
}

function logout() {
  saveKey("");
  state.scripts = [];

  if (els.existingKey) {
    els.existingKey.value = "";
  }

  showWelcome();
  showNotice("تم تسجيل الخروج.");
}

/* =========================================
   SCRIPTS
========================================= */

async function loadScripts() {
  try {
    const result = await api("/api/scripts");

    state.scripts = Array.isArray(result)
      ? result
      : result.scripts || [];

    renderScripts();

  } catch (error) {
    showNotice(error.message);
  }
}

function createActionButton(label, action, slug, style = "dark-button") {
  const button = document.createElement("button");

  button.type = "button";
  button.className = `button ${style}`;
  button.textContent = label;

  button.addEventListener("click", () => {
    action(slug);
  });

  return button;
}

function renderScripts() {
  const container = els.scriptList;

  if (!container) return;

  container.replaceChildren();

  if (els.empty) {
    els.empty.classList.toggle(
      "hidden",
      state.scripts.length !== 0
    );
  }

  for (const script of state.scripts) {
    const card = document.createElement("article");
    card.className = "script-card";

    const title = document.createElement("h3");
    title.textContent = script.title || script.slug;

    const meta = document.createElement("div");
    meta.className = "script-meta";

    const slug = document.createElement("span");
    slug.textContent = `/${script.slug}`;

    const badge = document.createElement("span");
    const enabled = script.enabled !== false;

    badge.className = `badge ${enabled ? "enabled" : "disabled"}`;
    badge.textContent = enabled ? "مفعّل" : "معطّل";

    meta.append(slug, badge);

    const url = document.createElement("div");
    url.className = "script-url";
    url.textContent = `${location.origin}/${script.slug}`;

    const actions = document.createElement("div");
    actions.className = "script-actions";

    actions.append(
      createActionButton(
        "تعديل",
        openEditor,
        script.slug,
        "white-button"
      ),

      createActionButton(
        "نسخ الرابط",
        copyScriptUrl,
        script.slug
      ),

      createActionButton(
        enabled ? "تعطيل" : "تفعيل",
        toggleScript,
        script.slug
      ),

      createActionButton(
        "حذف",
        deleteScript,
        script.slug
      )
    );

    card.append(title, meta, url, actions);
    container.append(card);
  }
}

async function copyScriptUrl(slug) {
  await copyText(`${location.origin}/${slug}`);
}

function openEditor(slug = null) {
  state.editingSlug = slug;

  clearError(els.editorError);
  els.scriptForm?.reset();

  const script = state.scripts.find(
    item => item.slug === slug
  );

  if (script) {
    els.editorTitle.textContent = "تعديل السكربت";
    els.scriptTitle.value = script.title || "";
    els.scriptSlug.value = script.slug || "";

    /*
      يجب أن يرجع API الكود الأصلي للمحرر.
      إذا كانت قاعدة البيانات تحفظ content كأصل،
      فيجب أن يكون content هو النسخة الأصلية.
    */

    els.sourceCode.value = script.content || "";

  } else {
    els.editorTitle.textContent = "إنشاء سكربت";
    els.scriptTitle.value = "";
    els.scriptSlug.value = "";
    els.sourceCode.value = "";
  }

  updateCharCount();
  els.editor?.classList.remove("hidden");
  els.scriptTitle?.focus();
}

function closeEditor() {
  els.editor?.classList.add("hidden");
  state.editingSlug = null;
}

function updateCharCount() {
  if (!els.charCount || !els.sourceCode) return;

  els.charCount.textContent =
    `${els.sourceCode.value.length.toLocaleString("ar")} حرف`;
}

async function saveScript(event) {
  event.preventDefault();

  clearError(els.editorError);

  const title = els.scriptTitle.value.trim();
  const slug = els.scriptSlug.value.trim();
  const content = els.sourceCode.value;

  if (!title || !slug || !content.trim()) {
    showError(els.editorError, "أكمل جميع الحقول.");
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    showError(
      els.editorError,
      "الرابط يجب أن يحتوي على أحرف إنجليزية وأرقام وشرطة فقط."
    );
    return;
  }

  const button = els.scriptForm.querySelector(
    'button[type="submit"]'
  );

  setBusy(button, true, "جارٍ الحفظ...");

  try {
    const body = { title, slug, content };

    if (state.editingSlug) {
      await api(
        `/api/scripts/${encodeURIComponent(state.editingSlug)}`,
        {
          method: "PUT",
          body
        }
      );
    } else {
      await api("/api/scripts", {
        method: "POST",
        body
      });
    }

    closeEditor();

    await loadScripts();

    showNotice("تم حفظ السكربت.");

  } catch (error) {
    showError(els.editorError, error.message);
  } finally {
    setBusy(button, false);
  }
}

async function toggleScript(slug) {
  try {
    await api(
      `/api/scripts/${encodeURIComponent(slug)}/toggle`,
      {
        method: "POST",
        body: {}
      }
    );

    await loadScripts();

    showNotice("تم تحديث حالة السكربت.");

  } catch (error) {
    showNotice(error.message);
  }
}

async function deleteScript(slug) {
  const confirmed = confirm(
    `هل أنت متأكد من حذف السكربت "${slug}"؟`
  );

  if (!confirmed) return;

  try {
    await api(
      `/api/scripts/${encodeURIComponent(slug)}`,
      { method: "DELETE" }
    );

    await loadScripts();

    showNotice("تم حذف السكربت.");

  } catch (error) {
    showNotice(error.message);
  }
}

/* =========================================
   ACTIVITY LOGS
========================================= */

async function loadLogs() {
  if (!els.logsList) return;

  els.logsList.replaceChildren();

  const loading = document.createElement("div");
  loading.className = "log-row";
  loading.textContent = "جارٍ تحميل السجلات...";
  els.logsList.append(loading);

  try {
    const result = await api("/api/logs");

    const logs = Array.isArray(result)
      ? result
      : result.logs || [];

    els.logsList.replaceChildren();

    if (!logs.length) {
      const empty = document.createElement("div");
      empty.className = "log-row muted";
      empty.textContent = "لا توجد أحداث مسجلة.";
      els.logsList.append(empty);
      return;
    }

    for (const log of logs) {
      const row = document.createElement("div");
      row.className = "log-row";

      const event = document.createElement("strong");
      event.textContent = log.event_type || log.event || "حدث";

      const details = document.createElement("div");
      details.className = "muted";
      details.textContent =
        log.script_slug ||
        log.details ||
        log.message ||
        "";

      const date = document.createElement("div");
      date.className = "muted small";

      date.textContent = log.created_at
        ? new Date(log.created_at).toLocaleString("ar")
        : "";

      row.append(event, details, date);
      els.logsList.append(row);
    }

  } catch (error) {
    els.logsList.replaceChildren();

    const row = document.createElement("div");
    row.className = "log-row";
    row.textContent = error.message;

    els.logsList.append(row);
  }
}

/* =========================================
   EVENT LISTENERS
========================================= */

els.createKey?.addEventListener("click", createKey);

els.copyKey?.addEventListener("click", () => {
  copyText(els.existingKey?.value.trim());
});

els.enterKey?.addEventListener("click", () => {
  verifyAndEnter(els.existingKey?.value.trim());
});

els.existingKey?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    verifyAndEnter(els.existingKey.value.trim());
  }
});

els.logout?.addEventListener("click", logout);

els.newScript?.addEventListener("click", () => {
  openEditor();
});

els.emptyNew?.addEventListener("click", () => {
  openEditor();
});

els.closeEditor?.addEventListener("click", closeEditor);
els.cancelEditor?.addEventListener("click", closeEditor);

els.editor?.addEventListener("click", event => {
  if (event.target === els.editor) {
    closeEditor();
  }
});

els.scriptForm?.addEventListener("submit", saveScript);
els.sourceCode?.addEventListener("input", updateCharCount);

els.scriptSlug?.addEventListener("input", () => {
  els.scriptSlug.value = els.scriptSlug.value
    .replace(/[^a-zA-Z0-9_-]/g, "");
});

els.logsBtn?.addEventListener("click", async () => {
  els.logsPanel?.classList.remove("hidden");
  await loadLogs();
});

els.closeLogs?.addEventListener("click", () => {
  els.logsPanel?.classList.add("hidden");
});

els.refreshLogs?.addEventListener("click", loadLogs);

els.logsPanel?.addEventListener("click", event => {
  if (event.target === els.logsPanel) {
    els.logsPanel.classList.add("hidden");
  }
});

/* =========================================
   SESSION RESTORE
========================================= */

async function init() {
  if (!state.key) {
    showWelcome();
    return;
  }

  const success = await verifyAndEnter(state.key);

  if (!success) {
    saveKey("");
    showWelcome();
  }
}

init();