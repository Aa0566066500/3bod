var session = localStorage.getItem('lunex_session') || null;
var username = localStorage.getItem('lunex_user') || null;
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
  if (session) headers['authorization'] = 'Bearer ' + session;
  
  var options = { method: method, headers: headers };
  if (method !== 'GET') {
    options.body = JSON.stringify(data);
  }
  
  return fetch(path, options).then(function(res) {
    return res.json();
  });
}

function render() {
  var app = document.getElementById('app');
  if (!session) {
    app.innerHTML = renderLoginHTML();
  } else {
    app.innerHTML = renderDashboardHTML();
    loadUserScripts();
  }
}

var loginStep = 1;
var tempUsername = '';

function renderLoginHTML() {
  if (loginStep === 1) {
    return '<header>' +
      '<h1 class="logo">Lunex<span>Script</span></h1>' +
      '<span style="color:var(--text-muted); font-size:13px;">تسجيل الدخول الآمن</span>' +
    '</header>' +
    '<div class="card" style="max-width: 400px; margin: 40px auto;">' +
      '<h2>تسجيل الدخول (الخطوة 1/2)</h2>' +
      '<form onsubmit="handleLoginStep1(event)">' +
        '<input type="text" id="username" placeholder="اسم المستخدم" required autocomplete="username" />' +
        '<input type="password" id="password" placeholder="كلمة المرور" required autocomplete="current-password" />' +
        '<button type="submit" style="width:100%">التالي</button>' +
      '</form>' +
    '</div>';
  } else {
    return '<header>' +
      '<h1 class="logo">Lunex<span>Script</span></h1>' +
      '<span style="color:var(--text-muted); font-size:13px;">تأكيد الهوية</span>' +
    '</header>' +
    '<div class="card" style="max-width: 400px; margin: 40px auto;">' +
      '<h2>كلمة السر السرية (الخطوة 2/2)</h2>' +
      '<p class="hint" style="margin-bottom:15px;">أدخل كلمة السر السرية الخاصة بحسابك <span>' + tempUsername + '</span> للتأكيد.</p>' +
      '<form onsubmit="handleLoginStep2(event)">' +
        '<input type="password" id="secret" placeholder="كلمة السر السرية" required autofocus />' +
        '<div class="btn-group">' +
          '<button type="submit" style="flex:1">تأكيد ودخول</button>' +
          '<button type="button" class="secondary" onclick="loginStep=1; render();">رجوع</button>' +
        '</div>' +
      '</form>' +
    '</div>';
  }
}

function handleLoginStep1(e) {
  e.preventDefault();
  var u = document.getElementById('username').value.trim();
  var p = document.getElementById('password').value;
  
  apiCall('/api/login', { username: u, password: p }).then(function(res) {
    if (res.status === 'step2_required') {
      tempUsername = u;
      loginStep = 2;
      render();
    } else {
      showToast('بيانات الدخول غير صحيحة', 'error');
    }
  });
}

function handleLoginStep2(e) {
  e.preventDefault();
  var s = document.getElementById('secret').value;

  apiCall('/api/login2', { username: tempUsername, secret: s }).then(function(res) {
    if (res.session) {
      session = res.session;
      username = res.username;
      localStorage.setItem('lunex_session', session);
      localStorage.setItem('lunex_user', username);
      loginStep = 1;
      showToast('تم تسجيل الدخول بنجاح');
      render();
    } else {
      showToast('كلمة السر السرية غير صحيحة', 'error');
    }
  });
}

function logout() {
  localStorage.removeItem('lunex_session');
  localStorage.removeItem('lunex_user');
  session = null;
  username = null;
  showToast('تم تسجيل الخروج');
  render();
}

function renderDashboardHTML() {
  var domain = window.location.host;
  return '<header>' +
    '<h1 class="logo">Lunex<span>Script</span> <span style="font-size:14px; color:var(--text-muted); font-weight:normal;">| مرحباً، ' + username + '</span></h1>' +
    '<button class="secondary" onclick="logout()">تسجيل خروج</button>' +
  '</header>' +

  '<div class="card">' +
    '<h2 id="formTitle">نشر سورس جديد</h2>' +
    '<form onsubmit="handleSaveScript(event)">' +
      '<label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">اسم السورس (8 أحرف على الأقل ورقم واحد، بدون مسافات):</label>' +
      '<input type="text" id="scriptNameInput" placeholder="مثال: mygame123script" oninput="checkNameAvailability(this.value)" required />' +
      '<div id="nameHint" class="hint">الرابط النهائي: <span>https://' + domain + '/<span id="previewName">...</span></span></div>' +
      '<div id="suggestionsContainer" class="suggestions" style="display:none;"></div>' +

      '<label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">محتوى سورس الـ Lua:</label>' +
      '<textarea id="scriptContentInput" placeholder="print(\'Hello Roblox!\')" required></textarea>' +
      
      '<div class="btn-group">' +
        '<button type="submit" id="saveBtn">نشر السورس</button>' +
        '<button type="button" class="secondary" id="cancelEditBtn" style="display:none;" onclick="resetForm()">إلغاء التعديل</button>' +
      '</div>' +
    '</form>' +
  '</div>' +

  '<div class="card">' +
    '<h2>سورساتك المستضافة</h2>' +
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
      document.getElementById('nameHint').innerHTML = '<span style="color:var(--danger)">يجب أن يكون الاسم 8 أحرف على الأقل ويحتوي رقمًا واحدًا.</span>';
      document.getElementById('suggestionsContainer').style.display = 'none';
      return;
    }

    apiCall('/api/check', { name: clean }).then(function(res) {
      var suggBox = document.getElementById('suggestionsContainer');
      if (!res.valid) {
        if (res.taken) {
          document.getElementById('nameHint').innerHTML = '<span style="color:var(--danger)">الاسم مستخدم مسبقاً. اختر أحد المقترحات أدناه:</span>';
          suggBox.innerHTML = res.suggestions.map(function(s) {
            return '<div class="suggestion-chip" onclick="selectSuggestion(\'' + s + '\')">' + s + '</div>';
          }).join('');
          suggBox.style.display = 'flex';
        } else {
          document.getElementById('nameHint').innerHTML = '<span style="color:var(--danger)">' + res.message + '</span>';
          suggBox.style.display = 'none';
        }
      } else {
        document.getElementById('nameHint').innerHTML = 'الرابط النهائي: <span style="color:var(--success)">https://' + window.location.host + '/' + res.formatted + '</span> (متاح ✓)';
        suggBox.style.display = 'none';
      }
    });
  }, 400);
}

function selectSuggestion(name) {
  document.getElementById('scriptNameInput').value = name;
  checkNameAvailability(name);
}

function handleSaveScript(e) {
  e.preventDefault();
  var name = document.getElementById('scriptNameInput').value;
  var content = document.getElementById('scriptContentInput').value;

  apiCall('/api/save', { name: name, content: content }).then(function(res) {
    if (res.success) {
      showToast('تم حفظ ونشر السورس بنجاح!');
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
  nameInput.value = '';
  nameInput.disabled = false;
  document.getElementById('scriptContentInput').value = '';
  document.getElementById('formTitle').textContent = 'نشر سورس جديد';
  document.getElementById('saveBtn').textContent = 'نشر السورس';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('suggestionsContainer').style.display = 'none';
  document.getElementById('nameHint').innerHTML = 'الرابط النهائي: <span>https://' + window.location.host + '/<span id="previewName">...</span></span>';
}

function loadUserScripts() {
  apiCall('/api/scripts', {}, 'GET').then(function(res) {
    var listEl = document.getElementById('scriptsList');
    if (!res.scripts || res.scripts.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-muted)">لا توجد سورسات مستضافة حتى الآن.</p>';
      return;
    }

    var domain = window.location.host;
    listEl.innerHTML = res.scripts.map(function(s) {
      var loadstringCode = 'loadstring(game:HttpGet("https://' + domain + '/' + s.name + '"))()';
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
      showToast(res.revoked === 1 ? 'تم إيقاف السورس (Kill Switch)' : 'تم تفعيل السورس');
      loadUserScripts();
    }
  });
}

function editScript(name, encodedContent) {
  currentEditingName = name;
  var nameInput = document.getElementById('scriptNameInput');
  nameInput.value = name;
  nameInput.disabled = true;
  document.getElementById('scriptContentInput').value = decodeURIComponent(encodedContent);
  document.getElementById('formTitle').textContent = 'تعديل السورس: ' + name;
  document.getElementById('saveBtn').textContent = 'تحديث السورس';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  document.getElementById('nameHint').innerHTML = '<span style="color:var(--text-muted)">الاسم مقفل ولا يمكن تغييره عند التعديل.</span>';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteScript(name) {
  if (!confirm('هل أنت متأكد من حذف هذا السورس نهائياً؟')) return;
  apiCall('/api/delete', { name: name }).then(function(res) {
    if (res.success) {
      showToast('تم حذف السورس بنجاح');
      loadUserScripts();
    }
  });
}

function openLogs(name) {
  document.getElementById('logsModal').style.display = 'flex';
  document.getElementById('logsContent').textContent = 'جاري جلب السجل...';
  
  apiCall('/api/logs?name=' + name, {}, 'GET').then(function(res) {
    if (res.logs) {
      currentLogsData = res.logs;
      if (res.logs.length === 0) {
        document.getElementById('logsContent').textContent = 'لا توجد محاولات سحب مسجلة حتى الآن.';
        return;
      }
      document.getElementById('logsContent').innerHTML = res.logs.map(function(l) {
        var d = new Date(l.timestamp).toLocaleString('ar-SA');
        var statusIcon = l.allowed === 1 ? '✅ [مسموح]' : '❌ [مرفوض]';
        return '[' + d + '] IP: ' + l.ip + ' | ' + statusIcon + ' | السبب: ' + l.reason + '\nUA: ' + l.user_agent + '\n--------------------------------------------------';
      }).join('\n');
    } else {
      document.getElementById('logsContent').textContent = 'فشل في جلب السجل.';
    }
  });
}

function closeLogsModal() {
  document.getElementById('logsModal').style.display = 'none';
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
