var siteAuth = Boolean(localStorage.getItem('lunex_site_key'));
var currentEditingName = null;
var currentLogsData = [];

function showToast(msg, type) {
  type = type || 'success';
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(function() { t.className = 'toast'; }, 3000);
}

function apiCall(path, data, method) {
  data = data || {};
  method = method || 'POST';
  var headers = { 'content-type': 'application/json' };
  var savedKey = localStorage.getItem('lunex_site_key');
  if (savedKey) headers['x-lunex-key'] = savedKey;
  var options = { method: method, headers: headers };
  if (method !== 'GET') {
    options.body = JSON.stringify(data);
  }
  return fetch(path, options).then(function(res) { return res.json(); });
}

// توليد مفتاح دخول جديد خاص بالمتصفح غير متكرر بالشكل المطلوبة ls-0173819180189191074
function generateNewSiteKey() {
  apiCall('/api/generate-site-key', {}).then(function(res) {
    if (res.success && res.key) {
      var inputEl = document.getElementById('siteKeyInput');
      if (inputEl) inputEl.value = res.key;
      showToast('تم إنشاء مفتاح جديد! انسخه واحتفظ به.');
    } else {
      showToast('فشل إنشاء المفتاح', 'error');
    }
  });
}

// زر توليد مفتاح السورس العشوائي داخل اللوحة
function generateRandomScriptKey() {
  var randomDigits = Math.floor(10000000000 + Math.random() * 90000000000);
  var generatedKey = 'ls-' + randomDigits;
  
  var inputEl = document.getElementById('scriptNameInput');
  if (inputEl) {
    inputEl.value = generatedKey;
    checkNameAvailability(generatedKey);
    showToast('تم توليد مفتاح السورس بنجاح!');
  }
}

function render() {
  var app = document.getElementById('app');
  if (!siteAuth) {
    app.innerHTML = renderSiteAuthHTML();
  } else {
    app.innerHTML = renderDashboardHTML();
    loadUserScripts();
  }
}

// واجهة تسجيل الدخول بالمفتاح الجديد
function renderSiteAuthHTML() {
  return '<header>' +
    '<h1 class="logo">Lunex<span>Script</span></h1>' +
    '<span style="color:var(--text-muted); font-size:13px;">نظام المفاتيح الآمن</span>' +
  '</header>' +
  '<div class="card" style="max-width: 420px; margin: 50px auto;">' +
    '<h2>تسجيل الدخول بالمفتاح</h2>' +
    '<p class="hint" style="margin-bottom:15px;">إذا لم يكن لديك مفتاح، انقر على زر الإنشاء أدناه للحصول على مفتاحك الفريد غير المتكرر.</p>' +
    '<form onsubmit="handleSiteAuth(event)">' +
      '<div style="display: flex; gap: 8px; margin-bottom: 12px;">' +
        '<input type="text" id="siteKeyInput" placeholder="ls-0173819180189191074" required autofocus style="margin-bottom:0; flex:1;" />' +
        '<button type="button" class="secondary" onclick="generateNewSiteKey()" style="white-space: nowrap;">🎲 إنشاء مفتاح</button>' +
      '</div>' +
      '<button type="submit" style="width:100%; margin-top:5px;">دخول لوحة التحكم</button>' +
    '</form>' +
  '</div>';
}

function handleSiteAuth(e) {
  e.preventDefault();
  var key = document.getElementById('siteKeyInput').value.trim();

  apiCall('/api/verify-site-key', { key: key }).then(function(res) {
    if (res.success) {
      siteAuth = true;
      localStorage.setItem('lunex_site_key', key);
      localStorage.removeItem('lunex_site_auth');
      showToast('أهلاً بك، تم تسجيل الدخول بنجاح!');
      render();
    } else {
      showToast('المفتاح غير صحيح أو غير مسجل بالنظام!', 'error');
    }
  });
}

function logoutSite() {
  localStorage.removeItem('lunex_site_key');
  localStorage.removeItem('lunex_site_auth');
  siteAuth = false;
  showToast('تم تسجيل الخروج من الموقع');
  render();
}

function renderDashboardHTML() {
  var domain = window.location.host;
  return '<header>' +
    '<h1 class="logo">Lunex<span>Script</span> <span style="font-size:14px; color:var(--text-muted); font-weight:normal;">| لوحة الإدارة الآمنة</span></h1>' +
    '<button class="secondary" onclick="logoutSite()">تسجيل خروج</button>' +
  '</header>' +

  '<div class="card">' +
    '<h2 id="formTitle">نشر سورس أو مفتاح جديد</h2>' +
    '<form onsubmit="handleSaveScript(event)">' +
      '<label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">اسم المفتاح (8 أحرف ورقم واحد على الأقل):</label>' +
      
      '<div style="display: flex; gap: 8px; margin-bottom: 12px;">' +
        '<input type="text" id="scriptNameInput" placeholder="ls-28710461083" oninput="checkNameAvailability(this.value)" required style="margin-bottom:0; flex:1;" />' +
        '<button type="button" class="secondary" onclick="generateRandomScriptKey()" style="white-space: nowrap;">🎲 إنشاء مفتاح</button>' +
      '</div>' +

      '<div id="nameHint" class="hint">الرابط النهائي: <span>https://' + domain + '/<span id="previewName">...</span>/Raw</span></div>' +
      '<div id="suggestionsContainer" class="suggestions" style="display:none;"></div>' +

      '<label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">محتوى سورس الـ Lua:</label>' +
      '<textarea id="scriptContentInput" placeholder="print(\'Hello Roblox!\')" required></textarea>' +
      
      '<div class="btn-group">' +
        '<button type="submit" id="saveBtn">حفظ النشر</button>' +
        '<button type="button" class="secondary" id="cancelEditBtn" style="display:none;" onclick="resetForm()">إلغاء التعديل</button>' +
      '</div>' +
    '</form>' +
  '</div>' +

  '<div class="card">' +
    '<h2>السورسات المستضافة</h2>' +
    '<div id="scriptsList">جاري التحميل...</div>' +
  '</div>';
}

var debounceTimer = null;
function checkNameAvailability(val) {
  var preview = document.getElementById('previewName');
  var clean = val.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  if (preview) preview.textContent = clean || '...';

  if (currentEditingName) return;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function() {
    if (clean.length < 8 || !/\d/.test(clean)) {
      document.getElementById('nameHint').innerHTML = '<span style="color:var(--danger)">يجب أن يكون المفتاح 8 أحرف على الأقل ويحتوي رقمًا واحدًا.</span>';
      document.getElementById('suggestionsContainer').style.display = 'none';
      return;
    }

    apiCall('/api/check', { name: clean }).then(function(res) {
      var suggBox = document.getElementById('suggestionsContainer');
      if (!res.valid) {
        if (res.taken) {
          document.getElementById('nameHint').innerHTML = '<span style="color:var(--danger)">المفتاح مستخدم مسبقاً. اختر أحد المقترحات أدناه:</span>';
          suggBox.innerHTML = res.suggestions.map(function(s) {
            return '<div class="suggestion-chip" onclick="selectSuggestion(\'' + s + '\')">' + s + '</div>';
          }).join('');
          suggBox.style.display = 'flex';
        } else {
          document.getElementById('nameHint').innerHTML = '<span style="color:var(--danger)">' + res.message + '</span>';
          suggBox.style.display = 'none';
        }
      } else {
        document.getElementById('nameHint').innerHTML = 'الرابط النهائي: <span style="color:var(--success)">https://' + window.location.host + '/' + res.formatted + '/Raw' + '</span> (متاح ✓)';
        suggBox.style.display = 'none';
      }
    });
  }, 400);
}

function selectSuggestion(name) {
  var inputEl = document.getElementById('scriptNameInput');
  if (inputEl) {
    inputEl.value = name;
    checkNameAvailability(name);
  }
}

function handleSaveScript(e) {
  e.preventDefault();
  var name = document.getElementById('scriptNameInput').value;
  var content = document.getElementById('scriptContentInput').value;

  apiCall('/api/save', { name: name, content: content }).then(function(res) {
    if (res.success) {
      showToast('تم حفظ المفتاح والسورس بنجاح!');
      resetForm();
      loadUserScripts();
    } else {
      showToast(res.error || 'حدث خطأ أثناء الحفظ', 'error');
    }
  });
}

function resetForm() {
  currentEditingName = null;
  var nameInput = document.getElementById('scriptNameInput');
  if (nameInput) {
    nameInput.value = '';
    nameInput.disabled = false;
  }
  var contentInput = document.getElementById('scriptContentInput');
  if (contentInput) contentInput.value = '';
  
  var formTitle = document.getElementById('formTitle');
  if (formTitle) formTitle.textContent = 'نشر سورس أو مفتاح جديد';
  
  var saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.textContent = 'حفظ النشر';
  
  var cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  
  var suggBox = document.getElementById('suggestionsContainer');
  if (suggBox) suggBox.style.display = 'none';
  
  var nameHint = document.getElementById('nameHint');
  if (nameHint) nameHint.innerHTML = 'الرابط النهائي: <span>https://' + window.location.host + '/3bod-Lunex-Script/<span id="previewName">...</span></span>';
}

function loadUserScripts() {
  apiCall('/api/scripts', {}, 'GET').then(function(res) {
    var listEl = document.getElementById('scriptsList');
    if (!listEl) return;
    
    if (!res.scripts || res.scripts.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-muted)">لا توجد سورسات مستضافة حتى الآن.</p>';
      return;
    }

    var domain = window.location.host;
    listEl.innerHTML = res.scripts.map(function(s) {
      var loadstringCode = 'loadstring(game:HttpGet("https://' + domain + '/' + s.name + '/Raw"))()';
      var isRevoked = s.revoked === 1;
      var dateStr = new Date(s.updated_at).toLocaleString('ar-SA');

      return '<div class="script-item">' +
        '<div class="script-header">' +
          '<div>' +
            '<span class="script-name">' + s.name + '</span>' +
            (isRevoked ? '<span class="status-badge status-revoked" style="margin-right:8px;">🔴 موقوف</span>' : '<span class="status-badge status-active" style="margin-right:8px;">🟢 مفعّل</span>') +
          '</div>' +
          '<span class="script-meta">آخر تحديث: ' + dateStr + '</span>' +
        '</div>' +
        '<input type="text" class="code-font" readonly value="' + loadstringCode.replace(/"/g, '&quot;') + '" style="margin-bottom:8px; font-size:12px; background:#000;" />' +
        '<div class="btn-group">' +
          '<button onclick="copyText(\'' + loadstringCode.replace(/'/g, "\\\\'") + '\')">نسخ وتشغيل</button>' +
          '<button class="secondary" onclick="toggleRevoke(\'' + s.name + '\')">' + (isRevoked ? 'تفعيل' : 'إيقاف') + '</button>' +
          '<button class="secondary" onclick="editScript(\'' + s.name + '\', \'' + encodeURIComponent(s.content || '') + '\')">تعديل</button>' +
          '<button class="secondary" onclick="openLogs(\'' + s.name + '\')">📋 سجل السحب</button>' +
          '<button class="danger" onclick="deleteScript(\'' + s.name + '\')">حذف</button>' +
        '</div>' +
      '</div>';
    }).join('');
  });
}

function copyText(txt) {
  navigator.clipboard.writeText(txt);
  showToast('تم النسخ إلى الحافظة!');
}

function toggleRevoke(name) {
  apiCall('/api/revoke', { name: name }).then(function(res) {
    if (res.success) {
      showToast(res.revoked === 1 ? 'تم إيقاف المفتاح' : 'تم تفعيل المفتاح');
      loadUserScripts();
    }
  });
}

function editScript(name, encodedContent) {
  currentEditingName = name;
  var nameInput = document.getElementById('scriptNameInput');
  if (nameInput) {
    nameInput.value = name;
    nameInput.disabled = true;
  }
  var contentInput = document.getElementById('scriptContentInput');
  if (contentInput) contentInput.value = decodeURIComponent(encodedContent);
  
  var formTitle = document.getElementById('formTitle');
  if (formTitle) formTitle.textContent = 'تعديل السورس للمفتاح: ' + name;
  
  var saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.textContent = 'تحديث';
  
  var cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  
  var nameHint = document.getElementById('nameHint');
  if (nameHint) nameHint.innerHTML = '<span style="color:var(--text-muted)">المفتاح مقفل ولا يمكن تغييره عند التعديل.</span>';
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteScript(name) {
  if (!confirm('هل أنت متأكد من حذف هذا المفتاح نهائياً؟')) return;
  apiCall('/api/delete', { name: name }).then(function(res) {
    if (res.success) {
      showToast('تم حذف المفتاح بنجاح');
      loadUserScripts();
    }
  });
}

function openLogs(name) {
  var modal = document.getElementById('logsModal');
  if (modal) modal.style.display = 'flex';
  
  var logsContent = document.getElementById('logsContent');
  if (logsContent) logsContent.textContent = 'جاري جلب السجل...';
  
  apiCall('/api/logs?name=' + name, {}, 'GET').then(function(res) {
    if (res.logs && logsContent) {
      currentLogsData = res.logs;
      if (res.logs.length === 0) {
        logsContent.textContent = 'لا توجد محاولات سحب مسجلة حتى الآن.';
        return;
      }
      logsContent.innerHTML = res.logs.map(function(l) {
        var d = new Date(l.timestamp).toLocaleString('ar-SA');
        var statusIcon = l.allowed === 1 ? '✅ [مسموح]' : '❌ [مرفوض]';
        return '[' + d + '] IP: ' + l.ip + ' | ' + statusIcon + ' | السبب: ' + l.reason + '\nUA: ' + l.user_agent + '\n--------------------------------------------------';
      }).join('\n');
    }
  });
}

function closeLogsModal() {
  var modal = document.getElementById('logsModal');
  if (modal) modal.style.display = 'none';
}

function copyAllLogs() {
  if (!currentLogsData || currentLogsData.length === 0) return;
  var txt = currentLogsData.map(function(l) {
    var d = new Date(l.timestamp).toISOString();
    return '[' + d + '] IP: ' + l.ip + ' | Allowed: ' + l.allowed + ' | Reason: ' + l.reason + ' | UA: ' + l.user_agent;
  }).join('\n');
  copyText(txt);
}

render();
