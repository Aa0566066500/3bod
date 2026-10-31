
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const dbFile = path.join(__dirname, 'lunex.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) console.error('خطأ في اتصال قاعدة البيانات:', err.message);
  else console.log('تم الاتصال بقاعدة بيانات SQLite بنجاح.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS site_keys (
    key TEXT PRIMARY KEY,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE,
    content TEXT,
    revoked INTEGER DEFAULT 0,
    updated_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    script_name TEXT,
    timestamp INTEGER,
    ip TEXT,
    user_agent TEXT,
    allowed INTEGER,
    reason TEXT
  )`);
});

function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

function formatScriptName(str) {
  return (str || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
}

// API: التحقق من مفتاح دخول الموقع
app.post('/api/verify-site-key', (req, res) => {
  var key = (req.body.key || '').trim();
  if (!key) return res.status(401).json({ success: false, error: 'مفتاح فارغ' });

  db.get("SELECT key FROM site_keys WHERE key = ?", [key], function(err, row) {
    if (row) {
      return res.json({ success: true });
    }
    res.status(401).json({ success: false, error: 'مفتاح دخول غير مسجل' });
  });
});

// API: إنشاء مفتاح جديد عشوائي للموقع غير متكرر
app.post('/api/generate-site-key', (req, res) => {
  var randomNum = Math.floor(10000000000000000 + Math.random() * 90000000000000000);
  var newKey = 'ls-' + randomNum;
  var now = Date.now();

  db.run("INSERT INTO site_keys (key, created_at) VALUES (?, ?)", [newKey, now], function(err) {
    if (err) {
      // محاولة أخرى في حال التداخل النادر جداً
      return res.status(500).json({ error: 'حدث خطأ، حاول مجدداً' });
    }
    res.json({ success: true, key: newKey });
  });
});

// API: فحص توفر اسم السورس
app.post('/api/check', (req, res) => {
  var name = req.body.name;
  var cleanName = formatScriptName(name);

  if (cleanName.length < 8 || !/\d/.test(cleanName)) {
    return res.json({ valid: false, message: "يجب أن يكون الاسم 8 أحرف على الأقل ويحتوي رقمًا واحدًا." });
  }

  db.get("SELECT name FROM scripts WHERE name = ?", [cleanName], function(err, row) {
    if (row) {
      var suggestions = [];
      var rndChars = "abcdefghijklmnopqrstuvwxyz0123456789";
      for (var i = 0; i < 3; i++) {
        var suffix = '';
        for (var j = 0; j < 3; j++) suffix += rndChars[Math.floor(Math.random() * rndChars.length)];
        suggestions.push(cleanName + '-' + suffix + '1');
      }
      return res.json({ valid: false, taken: true, suggestions: suggestions });
    }
    res.json({ valid: true, formatted: cleanName });
  });
});

// API: جلب السورسات
app.get('/api/scripts', (req, res) => {
  db.all("SELECT id, name, content, revoked, updated_at FROM scripts ORDER BY updated_at DESC", [], function(err, rows) {
    res.json({ scripts: rows || [] });
  });
});

// API: حفظ أو تحديث السورس
app.post('/api/save', (req, res) => {
  var name = req.body.name;
  var content = req.body.content;
  var cleanName = formatScriptName(name);

  if (cleanName.length < 8 || !/\d/.test(cleanName)) {
    return res.status(400).json({ error: 'الاسم غير مطابق للشروط (8 أحرف ورقم على الأقل).' });
  }

  db.get("SELECT COUNT(*) as cnt FROM scripts", [], function(err, countRow) {
    if (countRow && countRow.cnt >= 200) {
      return res.status(400).json({ error: 'لقد وصلت للحد الأقصى (200 سورس).' });
    }

    var now = Date.now();
    db.get("SELECT name FROM scripts WHERE name = ?", [cleanName], function(err, existing) {
      if (existing) {
        db.run("UPDATE scripts SET content = ?, updated_at = ? WHERE name = ?", [content || '', now, cleanName], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, name: cleanName });
        });
      } else {
        var id = generateUUID();
        db.run("INSERT INTO scripts (id, name, content, revoked, updated_at) VALUES (?, ?, ?, 0, ?)", [id, cleanName, content || '', now], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, name: cleanName });
        });
      }
    });
  });
});

// API: حذف سورس
app.post('/api/delete', (req, res) => {
  var name = req.body.name;
  db.run("DELETE FROM scripts WHERE name = ?", [name], function() {
    db.run("DELETE FROM logs WHERE script_name = ?", [name], function() {
      res.json({ success: true });
    });
  });
});

// API: إيقاف أو تفعيل (Kill Switch)
app.post('/api/revoke', (req, res) => {
  var name = req.body.name;
  db.get("SELECT revoked FROM scripts WHERE name = ?", [name], function(err, script) {
    if (!script) return res.status(404).json({ error: 'not_found' });
    var newRevoked = script.revoked === 1 ? 0 : 1;
    db.run("UPDATE scripts SET revoked = ? WHERE name = ?", [newRevoked, name], function() {
      res.json({ success: true, revoked: newRevoked });
    });
  });
});

// API: جلب السجلات
app.get('/api/logs', (req, res) => {
  var name = req.query.name;
  if (!name) return res.status(400).json({ error: 'missing_name' });

  db.all("SELECT timestamp, ip, user_agent, allowed, reason FROM logs WHERE script_name = ? ORDER BY id DESC LIMIT 100", [name], function(err, rows) {
    res.json({ logs: rows || [] });
  });
});

// مسار الـ Kill Switch العام
app.get('/3bod-Lunex-Script/v/:name', (req, res) => {
  var scriptName = req.params.name.toLowerCase();
  db.get("SELECT revoked FROM scripts WHERE name = ?", [scriptName], function(err, script) {
    if (!script) return res.status(404).send("0");
    res.setHeader('Cache-Control', 'no-store');
    res.send(script.revoked === 1 ? "0" : "1");
  });
});

// مسار تسليم السكربت المحمي
app.get('/3bod-Lunex-Script/:name', (req, res) => {
  var scriptName = req.params.name.toLowerCase();
  var ua = req.headers['user-agent'] || '';
  var accept = req.headers['accept'] || '';
  var referer = req.headers['referer'] || '';
  var cookie = req.headers['cookie'] || '';
  var secFetch = req.headers['sec-fetch-mode'] || '';
  var ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '127.0.0.1';

  var allowed = 1;
  var reason = "Roblox user-agent";
  var uaLower = ua.toLowerCase();

  if (!ua || ua.trim() === '') {
    allowed = 0;
    reason = "بدون User-Agent";
  } else if (uaLower.includes('mozilla') || uaLower.includes('chrome') || uaLower.includes('safari') || uaLower.includes('edge') || uaLower.includes('opera')) {
    allowed = 0;
    reason = "متصفح عادي (Browser User-Agent)";
  } else if (uaLower.includes('curl') || uaLower.includes('python') || uaLower.includes('wget') || uaLower.includes('postman') || uaLower.includes('axios') || uaLower.includes('bot')) {
    allowed = 0;
    reason = "أداة سحب معروفة: " + ua.slice(0, 50);
  } else if (accept.includes('text/html') || secFetch === 'navigate' || referer !== '' || cookie !== '') {
    allowed = 0;
    reason = "ترويسات متصفح مشبوهة (Accept/Sec-Fetch/Referer/Cookie)";
  } else if (!uaLower.includes('roblox')) {
    allowed = 0;
    reason = "User-Agent غير معروف: " + ua.slice(0, 100);
  }

  db.run("INSERT INTO logs (script_name, timestamp, ip, user_agent, allowed, reason) VALUES (?, ?, ?, ?, ?, ?)",
    [scriptName, Date.now(), ip, ua.slice(0, 200), allowed, reason]);

  if (Math.random() < 0.08) {
    db.run("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs l2 WHERE l2.script_name = logs.script_name ORDER BY id DESC LIMIT 100)");
  }

  if (allowed === 0) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).send('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>محمي - LunexScript</title><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap" rel="stylesheet"><style>body{background:#000;color:#fff;font-family:\'Tajawal\',sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center}.box{background:#111;border:1px solid #333;padding:40px;border-radius:12px;max-width:450px}h1{color:#ff4444;font-size:24px;margin-bottom:10px}p{color:#888;font-size:14px;line-height:1.6}</style></head><body><div class="box"><h1>هذا النص محمي 🛡️</h1><p>عذراً، لا يمكن تشغيل هذا الرابط إلا مباشرة من داخل لعبة روبلوكس.</p></div></body></html>');
  }

  db.get("SELECT content, revoked FROM scripts WHERE name = ?", [scriptName], function(err, script) {
    if (!script) {
      res.setHeader('Content-Type', 'text/plain;charset=UTF-8');
      return res.send("print('[LunexScript] Script not found.')");
    }

    if (script.revoked === 1) {
      res.setHeader('Content-Type', 'text/plain;charset=UTF-8');
      return res.send("print('[LunexScript] This script has been revoked by the owner.')");
    }

    var protocol = req.headers['x-forwarded-proto'] || 'http';
    var origin = protocol + '://' + req.get('host');
    var encryptedLua = generateLunexCipher(script.content, scriptName, origin);

    res.setHeader('Content-Type', 'text/plain;charset=UTF-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(encryptedLua);
  });
});

// دوال التشفير L-Cipher المتقدمة
function randomBytesHex(len) { return crypto.randomBytes(len).toString('hex'); }
function randomStr(len) {
  var chars = "abcdefghijklmnopqrstuvwxyz";
  var res = "";
  for (var i = 0; i < len; i++) res += chars[Math.floor(Math.random() * chars.length)];
  return res;
}
function xorBytesHex(buf, hexKey) {
  var keyBuffer = Buffer.from(hexKey, 'hex');
  var res = Buffer.alloc(buf.length);
  for (var i = 0; i < buf.length; i++) res[i] = buf[i] ^ keyBuffer[i % keyBuffer.length];
  return res;
}
function rotateBytes(buf, shift, dir) {
  var res = Buffer.alloc(buf.length);
  shift = shift % 8;
  for (var i = 0; i < buf.length; i++) {
    var b = buf[i];
    res[i] = (dir === 'left') ? (((b << shift) | (b >> (8 - shift))) & 0xFF) : (((b >> shift) | (b << (8 - shift))) & 0xFF);
  }
  return res;
}
function nibbleSwap(buf) {
  var res = Buffer.alloc(buf.length);
  for (var i = 0; i < buf.length; i++) {
    var b = buf[i];
    res[i] = ((b & 0x0F) << 4) | ((b & 0xF0) >> 4);
  }
  return res;
}
function pairSwap(buf) {
  var res = Buffer.from(buf);
  for (var i = 0; i < res.length - 1; i += 2) {
    var tmp = res[i]; res[i] = res[i+1]; res[i+1] = tmp;
  }
  return res;
}

function generateLunexCipher(rawLua, scriptName, origin) {
  var key1 = randomBytesHex(32), key2 = randomBytesHex(32), key3 = randomBytesHex(32);
  var r1 = Math.floor(Math.random() * 20) + 1, r2 = Math.floor(Math.random() * 20) + 1;
  var buf = Buffer.from(rawLua, 'utf8');
  buf = xorBytesHex(buf, key1); buf = rotateBytes(buf, r1, 'left');
  buf = xorBytesHex(buf, key2); buf = nibbleSwap(buf);
  buf = rotateBytes(buf, r2, 'right'); buf = xorBytesHex(buf, key3); buf = pairSwap(buf);
  var b64Payload = buf.toString('base64');

  var vLoad = "_" + randomStr(6), vHttp = "_" + randomStr(6), vData = "_" + randomStr(6), vDec = "_" + randomStr(6);
  var vK1 = "_" + randomStr(6), vK2 = "_" + randomStr(6), vK3 = "_" + randomStr(6), vR1 = "_" + randomStr(6), vR2 = "_" + randomStr(6);
  var dummy1 = "_" + randomStr(5), dummy2 = "_" + randomStr(5);

  return `-- [LunexScript Secure Loader]
local ${vHttp} = game:GetService("HttpService")
local ${dummy1} = math.random(1, 100)
if ${dummy1} == 999 then print("LunexDummy") end

local success, ${vLoad} = pcall(function()
    return game:HttpGet("${origin}/3bod-Lunex-Script/v/${scriptName}")
end)

if not success or ${vLoad} ~= "1" then
    warn("[LunexScript] Script execution blocked or revoked.")
    return
end

local ${vData} = "${b64Payload}"
local ${vK1} = "${key1}"
local ${vK2} = "${key2}"
local ${vK3} = "${key3}"
local ${vR1} = ${r1}
local ${vR2} = ${r2}
local ${dummy2} = {_a = 1, _b = 2}

local ${vDec} = (function()
    local b = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    local decF = function(data)
        data = string.gsub(data, '[^'..b..'=]', '')
        return (data:gsub('.', function(x)
            if (x == '=') then return '' end
            local r,f='',(b:find(x)-1)
            for i=6,1,-1 do r=r..(f%2^i-f%2^(i-1)>0 and '1' or '0') end
            return r
        end):gsub('%d%d%d?%d?%d?%d?%d?%d?', function(x)
            if (#x ~= 8) then return '' end
            local c=0
            for i=1,8 do c=c+(x:sub(i,i)=='1' and 2^(8-i) or 0) end
            return string.char(c)
        end))
    end

    local raw = decF(${vData})
    local t = {}
    for i = 1, #raw do t[i] = string.byte(raw, i) end

    for i = 1, #t - 1, 2 do
        local tmp = t[i]
        t[i] = t[i+1]
        t[i+1] = tmp
    end

    local function hexToBytes(h)
        local res = {}
        for i = 1, #h, 2 do
            table.insert(res, tonumber(h:sub(i, i+1), 16))
        end
        return res
    end

    local k3b = hexToBytes(${vK3})
    for i = 1, #t do
        t[i] = bit32.bxor(t[i], k3b[((i-1)%#k3b)+1])
    end

    local function rotL(val, shift)
        shift = shift % 8
        return bit32.band(bit32.bor(bit32.lshift(val, shift), bit32.rshift(val, 8 - shift)), 0xFF)
    end
    for i = 1, #t do
        t[i] = rotL(t[i], ${vR2})
    end

    for i = 1, #t do
        var val = t[i]
        local high = bit32.band(bit32.rshift(val, 4), 0x0F)
        local low = bit32.lshift(bit32.band(val, 0x0F), 4)
        t[i] = bit32.bor(high, low)
    end

    local k2b = hexToBytes(${vK2})
    for i = 1, #t do
        t[i] = bit32.bxor(t[i], k2b[((i-1)%#k2b)+1])
    end

    local function rotR(val, shift)
        shift = shift % 8
        return bit32.band(bit32.bor(bit32.rshift(val, shift), bit32.lshift(val, 8 - shift)), 0xFF)
    end
    for i = 1, #t do
        t[i] = rotR(t[i], ${vR1})
    end

    local k1b = hexToBytes(${vK1})
    for i = 1, #t do
        t[i] = bit32.bxor(t[i], k1b[((i-1)%#k1b)+1])
    end

    local finalChars = {}
    for i = 1, #t do finalChars[i] = string.char(t[i]) end
    return table.concat(finalChars)
end)()

if ${vDec} then
    local fn, err = loadstring(${vDec})
    if fn then
        pcall(fn)
    else
        warn("[LunexScript] Compile Error: " .. tostring(err))
    end
end`;
}

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('السيرفر يعمل الآن على البورت ' + PORT);
});
