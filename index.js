const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// إعداد قاعدة البيانات SQLite محلياً
const dbFile = path.join(__dirname, 'lunex.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) console.error('خطأ في اتصال قاعدة البيانات:', err.message);
  else console.log('تم الاتصال بقاعدة بيانات SQLite بنجاح.');
});

db.serialize(() => {
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

// API: فحص توفر المفتاح
app.post('/api/check', (req, res) => {
  const { name } = req.body;
  const cleanName = formatScriptName(name);

  if (cleanName.length < 8 || !/\d/.test(cleanName)) {
    return res.json({ valid: false, message: "يجب أن يكون المفتاح 8 أحرف على الأقل ويحتوي رقمًا واحدًا." });
  }

  db.get("SELECT name FROM scripts WHERE name = ?", [cleanName], (err, row) => {
    if (row) {
      const suggestions = [];
      const rndChars = "abcdefghijklmnopqrstuvwxyz0123456789";
      for (let i = 0; i < 3; i++) {
        let suffix = '';
        for (let j = 0; j < 3; j++) suffix += rndChars[Math.floor(Math.random() * rndChars.length)];
        suggestions.push(`${cleanName}-${suffix}1`);
      }
      return res.json({ valid: false, taken: true, suggestions });
    }
    res.json({ valid: true, formatted: cleanName });
  });
});

// API: جلب كل المفاتيح والسورسات
app.get('/api/scripts', (req, res) => {
  db.all("SELECT id, name, content, revoked, updated_at FROM scripts ORDER BY updated_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ scripts: rows || [] });
  });
});

// API: حفظ أو تحديث المفتاح والسورس
app.post('/api/save', (req, res) => {
  const { name, content } = req.body;
  const cleanName = formatScriptName(name);

  if (cleanName.length < 8 || !/\d/.test(cleanName)) {
    return res.status(400).json({ error: 'المفتاح غير مطابق للشروط (8 أحرف ورقم على الأقل).' });
  }

  db.get("SELECT COUNT(*) as cnt FROM scripts", [], (err, countRow) => {
    if (countRow && countRow.cnt >= 200) {
      return res.status(400).json({ error: 'لقد وصلت للحد الأقصى (200 سورس).' });
    }

    const now = Date.now();
    db.get("SELECT name FROM scripts WHERE name = ?", [cleanName], (err, existing) => {
      if (existing) {
        db.run("UPDATE scripts SET content = ?, updated_at = ? WHERE name = ?", [content || '', now, cleanName], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, name: cleanName });
        });
      } else {
        const id = generateUUID();
        db.run("INSERT INTO scripts (id, name, content, revoked, updated_at) VALUES (?, ?, ?, 0, ?)", [id, cleanName, content || '', now], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, name: cleanName });
        });
      }
    });
  });
});

// API: حذف مفتاح
app.post('/api/delete', (req, res) => {
  const { name } = req.body;
  db.run("DELETE FROM scripts WHERE name = ?", [name], () => {
    db.run("DELETE FROM logs WHERE script_name = ?", [name], () => {
      res.json({ success: true });
    });
  });
});

// API: إيقاف أو تفعيل مفتاح (Kill Switch)
app.post('/api/revoke', (req, res) => {
  const { name } = req.body;
  db.get("SELECT revoked FROM scripts WHERE name = ?", [name], (err, script) => {
    if (!script) return res.status(404).json({ error: 'not_found' });
    const newRevoked = script.revoked === 1 ? 0 : 1;
    db.run("UPDATE scripts SET revoked = ? WHERE name = ?", [newRevoked, name], () => {
      res.json({ success: true, revoked: newRevoked });
    });
  });
});

// API: جلب السجلات
app.get('/api/logs', (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'missing_name' });

  db.all("SELECT timestamp, ip, user_agent, allowed, reason FROM logs WHERE script_name = ? ORDER BY id DESC LIMIT 100", [name], (err, rows) => {
    res.json({ logs: rows || [] });
  });
});

// مسار الـ Kill Switch العام
app.get('/v/:name', (req, res) => {
  const scriptName = req.params.name.toLowerCase();
  db.get("SELECT revoked FROM scripts WHERE name = ?", [scriptName], (err, script) => {
    if (!script) return res.status(404).send("0");
    res.setHeader('Cache-Control', 'no-store');
    res.send(script.revoked === 1 ? "0" : "1");
  });
});

// مسار تسليم السكربت المشفّر وحماية المتصفحات
app.get('/:name', (req, res, next) => {
  const scriptName = req.params.name.toLowerCase();
  if (scriptName.startsWith('api') || scriptName.includes('.')) {
    return next();
  }

  const ua = req.headers['user-agent'] || '';
  const accept = req.headers['accept'] || '';
  const referer = req.headers['referer'] || '';
  const cookie = req.headers['cookie'] || '';
  const secFetch = req.headers['sec-fetch-mode'] || '';
  const ip = req.headers['x-forwarded-for'] || req.ip || '127.0.0.1';

  let allowed = 1;
  let reason = "Roblox user-agent";
  const uaLower = ua.toLowerCase();

  if (!ua || ua.trim() === '') {
    allowed = 0;
    reason = "بدون User-Agent";
  } else if (uaLower.includes('mozilla') || uaLower.includes('chrome') || uaLower.includes('safari') || uaLower.includes('edge') || uaLower.includes('opera')) {
    allowed = 0;
    reason = "متصفح عادي (Browser User-Agent)";
  } else if (uaLower.includes('curl') || uaLower.includes('python') || uaLower.includes('wget') || uaLower.includes('postman') || uaLower.includes('axios')) {
    allowed = 0;
    reason = `أداة سحب معروفة: ${ua.slice(0, 50)}`;
  } else if (accept.includes('text/html') || secFetch === 'navigate' || referer !== '' || cookie !== '') {
    allowed = 0;
    reason = "ترويسات متصفح مشبوهة";
  } else if (!uaLower.includes('roblox')) {
    allowed = 0;
    reason = `User-Agent غير معروف: ${ua.slice(0, 100)}`;
  }

  db.run("INSERT INTO logs (script_name, timestamp, ip, user_agent, allowed, reason) VALUES (?, ?, ?, ?, ?, ?)",
    [scriptName, Date.now(), ip, ua.slice(0, 200), allowed, reason]);

  if (allowed === 0) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).send(`<!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
    <meta charset="UTF-8">
    <title>محمي - LunexScript</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap" rel="stylesheet">
    <style>
    body { background: #000; color: #fff; font-family: 'Tajawal', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center; }
    .box { background: #111; border: 1px solid #333; padding: 40px; border-radius: 12px; max-width: 450px; }
    h1 { color: #ff4444; font-size: 24px; margin-bottom: 10px; }
    p { color: #888; font-size: 14px; line-height: 1.6; }
    a { display: inline-block; margin-top: 20px; background: #222; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; border: 1px solid #444; }
    </style>
    </head>
    <body>
    <div class="box">
      <h1>هذا المفتاح محمي 🛡️</h1>
      <p>عذراً، لا يمكن تشغيل هذا المفتاح إلا مباشرة من داخل لعبة روبلوكس.</p>
      <a href="/">الذهاب لموقع LunexScript</a>
    </div>
    </body>
    </html>`);
  }

  db.get("SELECT content, revoked FROM scripts WHERE name = ?", [scriptName], (err, script) => {
    if (!script) {
      res.setHeader('Content-Type', 'text/plain;charset=UTF-8');
      return res.send("print('[LunexScript] Key not found.')");
    }

    if (script.revoked === 1) {
      res.setHeader('Content-Type', 'text/plain;charset=UTF-8');
      return res.send("print('[LunexScript] This key has been revoked.')");
    }

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const origin = `${protocol}://${req.get('host')}`;
    const encryptedLua = generateLunexCipher(script.content, scriptName, origin);

    res.setHeader('Content-Type', 'text/plain;charset=UTF-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(encryptedLua);
  });
});

// نظام التشفير L-Cipher
function randomBytesHex(len) { return crypto.randomBytes(len).toString('hex'); }
function randomStr(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let res = "";
  for (let i = 0; i < len; i++) res += chars[Math.floor(Math.random() * chars.length)];
  return res;
}
function xorBytesHex(buffer, hexKey) {
  const keyBuffer = Buffer.from(hexKey, 'hex');
  const res = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i++) res[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
  return res;
}
function rotateBytes(buffer, shift, dir) {
  const res = Buffer.alloc(buffer.length);
  shift = shift % 8;
  for (let i = 0; i < buffer.length; i++) {
    let b = buffer[i];
    res[i] = (dir === 'left') ? (((b << shift) | (b >> (8 - shift))) & 0xFF) : (((b >> shift) | (b << (8 - shift))) & 0xFF);
  }
  return res;
}
function nibbleSwap(buffer) {
  const res = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    let b = buffer[i];
    res[i] = ((b & 0x0F) << 4) | ((b & 0xF0) >> 4);
  }
  return res;
}
function pairSwap(buffer) {
  const res = Buffer.from(buffer);
  for (let i = 0; i < res.length - 1; i += 2) {
    let tmp = res[i]; res[i] = res[i+1]; res[i+1] = tmp;
  }
  return res;
}

function generateLunexCipher(rawLua, scriptName, origin) {
  const key1 = randomBytesHex(32), key2 = randomBytesHex(32), key3 = randomBytesHex(32);
  const r1 = Math.floor(Math.random() * 20) + 1, r2 = Math.floor(Math.random() * 20) + 1;
  let buf = Buffer.from(rawLua, 'utf8');
  buf = xorBytesHex(buf, key1); buf = rotateBytes(buf, r1, 'left');
  buf = xorBytesHex(buf, key2); buf = nibbleSwap(buf);
  buf = rotateBytes(buf, r2, 'right'); buf = xorBytesHex(buf, key3); buf = pairSwap(buf);
  const b64Payload = buf.toString('base64');

  const vLoad = "_" + randomStr(6), vHttp = "_" + randomStr(6), vData = "_" + randomStr(6), vDec = "_" + randomStr(6);
  const vK1 = "_" + randomStr(6), vK2 = "_" + randomStr(6), vK3 = "_" + randomStr(6), vR1 = "_" + randomStr(6), vR2 = "_" + randomStr(6);

  return `local ${vHttp} = game:GetService("HttpService")
local success, ${vLoad} = pcall(function() return game:HttpGet("${origin}/v/${scriptName}") end)
if not success or ${vLoad} ~= "1" then return end
local ${vData} = "${b64Payload}"
local ${vK1} = "${key1}" local ${vK2} = "${key2}" local ${vK3} = "${key3}"
local ${vR1} = ${r1} local ${vR2} = ${r2}
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
            local c=0 for i=1,8 do c=c+(x:sub(i,i)=='1' and 2^(8-i) or 0) end
            return string.char(c)
        end))
    end
    local raw = decF(${vData})
    local t = {} for i = 1, #raw do t[i] = string.byte(raw, i) end
    for i = 1, #t - 1, 2 do local tmp = t[i]; t[i] = t[i+1]; t[i+1] = tmp end
    local hexToBytes = function(h) local res = {} for i = 1, #h, 2 do table.insert(res, tonumber(h:sub(i, i+1), 16)) end return res end
    local k3b = hexToBytes(${vK3}) for i = 1, #t do t[i] = bit32.bxor(t[i], k3b[((i-1)%#k3b)+1]) end
    local rotL = function(val, shift) shift = shift % 8 return bit32.band(bit32.bor(bit32.lshift(val, shift), bit32.rshift(val, 8 - shift)), 0xFF) end
    for i = 1, #t do t[i] = rotL(t[i], ${vR2}) end
    for i = 1, #t do local val = t[i] t[i] = bit32.bor(bit32.band(bit32.rshift(val, 4), 0x0F), bit32.lshift(bit32.band(val, 0x0F), 4)) end
    local k2b = hexToBytes(${vK2}) for i = 1, #t do t[i] = bit32.bxor(t[i], k2b[((i-1)%#k2b)+1]) end
    local rotR = function(val, shift) shift = shift % 8 return bit32.band(bit32.bor(bit32.rshift(val, shift), bit32.lshift(val, 8 - shift)), 0xFF) end
    for i = 1, #t do t[i] = rotR(t[i], ${vR1}) end
    local k1b = hexToBytes(${vK1}); for i = 1, #t do t[i] = bit32.bxor(t[i], k1b[((i-1)%#k1b)+1]) end
    local finalChars = {} for i = 1, #t do finalChars[i] = string.char(t[i]) end
    return table.concat(finalChars)
end)()
if ${vDec} then local fn = loadstring(${vDec}) if fn then pcall(fn) end end`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`السيرفر يعمل الآن على البورت ${PORT}`);
});
