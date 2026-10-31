const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const path = require('node:path');

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '550kb' }));

const apiLimit = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false });
const rawLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const cleanName = (s='') => String(s).normalize('NFKD').toLowerCase().trim()
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
const validName = s => /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/.test(s) && s.length >= 3;
const newKey = () => 'LS-' + crypto.randomBytes(24).toString('base64url');

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Render.');
  return { url: url.replace(/\/+$/, ''), key };
}
async function db(table, { method='GET', query='', body, prefer }={}) {
  const c = config();
  const r = await fetch(`${c.url}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: {
      apikey: c.key, authorization: `Bearer ${c.key}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const raw = await r.text();
  let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!r.ok) {
    const e = new Error(typeof data === 'object' ? (data?.message || data?.details || 'Database error') : 'Database error');
    e.status = r.status; throw e;
  }
  return data;
}
async function validOwner(req, body={}) {
  const key = String(req.get('x-lunex-key') || body.key || '').trim();
  if (!/^LS-[A-Za-z0-9_-]{24,50}$/.test(key)) return null;
  const rows = await db('site_keys', { query: `select=key,disabled&key=eq.${encodeURIComponent(key)}&limit=1` });
  return rows?.[0] && !rows[0].disabled ? key : null;
}
async function audit(action, name, key) {
  try {
    await db('audit_events', { method:'POST', body: {
      action, script_name: name || null,
      actor_key_hint: key ? key.slice(0, 7) + '…' : null
    }, prefer:'return=minimal' });
  } catch {}
}
const apiError = (res, e) => {
  console.error('Lunex API error:', e.message);
  res.status(e.status && e.status < 500 ? e.status : 500).json({
    error: e.status && e.status < 500 ? e.message : 'حدث خطأ بالخادم. تحقق من إعدادات Supabase.'
  });
};

app.get('/health', (_req, res) => res.json({ ok:true, service:'Lunex Scripts' }));
app.use('/api', apiLimit);

app.post('/api/owner-key', async (_req, res) => {
  try {
    for (let i=0; i<3; i++) {
      const key = newKey();
      try {
        await db('site_keys', { method:'POST', body:{ key }, prefer:'return=minimal' });
        return res.json({ key });
      } catch (e) { if (i === 2) throw e; }
    }
  } catch (e) { apiError(res, e); }
});

app.post('/api/verify-key', async (req, res) => {
  try {
    const key = String(req.body?.key || '');
    const rows = key ? await db('site_keys', { query:`select=key,disabled&key=eq.${encodeURIComponent(key)}&limit=1` }) : [];
    res.status(rows?.[0] && !rows[0].disabled ? 200 : 401).json({ valid: !!(rows?.[0] && !rows[0].disabled) });
  } catch (e) { apiError(res, e); }
});

app.get('/api/scripts', async (req, res) => {
  try {
    const key = await validOwner(req);
    if (!key) return res.status(401).json({ error:'مفتاح الملكية غير صالح.' });
    const scripts = await db('scripts', { query:`select=id,name,content,revoked,created_at,updated_at&owner_key=eq.${encodeURIComponent(key)}&deleted_at=is.null&order=updated_at.desc` });
    res.json({ scripts: scripts || [] });
  } catch (e) { apiError(res, e); }
});

app.post('/api/scripts', async (req, res) => {
  try {
    const key = await validOwner(req, req.body);
    if (!key) return res.status(401).json({ error:'مفتاح الملكية غير صالح.' });
    const name = cleanName(req.body?.name);
    const content = String(req.body?.content || '');
    if (!validName(name)) return res.status(400).json({ error:'اختر اسمًا إنجليزيًا من 3 إلى 64 حرفًا/رقمًا، ويمكن استخدام الشرطة -.' });
    if (!content.trim() || content.length > 500000) return res.status(400).json({ error:'السورس فارغ أو يتجاوز 500 ألف حرف.' });
    const existing = await db('scripts', { query:`select=id,name,owner_key&name=eq.${encodeURIComponent(name)}&limit=1` });
    if (existing.length && existing[0].owner_key !== key) return res.status(409).json({ error:'هذا الاسم مستخدم من شخص آخر.' });
    if (existing.length) {
      await db('scripts', { method:'PATCH', query:`name=eq.${encodeURIComponent(name)}&owner_key=eq.${encodeURIComponent(key)}`, body:{ content, revoked:false, deleted_at:null, updated_at:new Date().toISOString() }, prefer:'return=minimal' });
      await audit('update', name, key);
    } else {
      await db('scripts', { method:'POST', body:{ name, content, owner_key:key }, prefer:'return=minimal' });
      await audit('create', name, key);
    }
    res.json({ success:true, name, url:`${req.protocol}://${req.get('host')}/${name}` });
  } catch (e) { apiError(res, e); }
});

app.delete('/api/scripts/:name', async (req, res) => {
  try {
    const key = await validOwner(req);
    if (!key) return res.status(401).json({ error:'مفتاح الملكية غير صالح.' });
    const name = cleanName(req.params.name);
    const rows = await db('scripts', { query:`select=id&name=eq.${encodeURIComponent(name)}&owner_key=eq.${encodeURIComponent(key)}&deleted_at=is.null&limit=1` });
    if (!rows.length) return res.status(404).json({ error:'السورس غير موجود أو ليس ملكك.' });
    await db('scripts', { method:'PATCH', query:`name=eq.${encodeURIComponent(name)}&owner_key=eq.${encodeURIComponent(key)}`, body:{ deleted_at:new Date().toISOString(), revoked:true, updated_at:new Date().toISOString() }, prefer:'return=minimal' });
    await audit('delete', name, key);
    res.json({ success:true });
  } catch (e) { apiError(res, e); }
});

app.post('/api/scripts/:name/toggle', async (req, res) => {
  try {
    const key = await validOwner(req);
    if (!key) return res.status(401).json({ error:'مفتاح الملكية غير صالح.' });
    const name = cleanName(req.params.name);
    const rows = await db('scripts', { query:`select=name,revoked,toggle_at&name=eq.${encodeURIComponent(name)}&owner_key=eq.${encodeURIComponent(key)}&deleted_at=is.null&limit=1` });
    if (!rows.length) return res.status(404).json({ error:'السورس غير موجود أو ليس ملكك.' });
    if (rows[0].toggle_at && Date.now()-Date.parse(rows[0].toggle_at)<5000) return res.status(429).json({ error:'انتظر قليلًا قبل تغيير الحالة.' });
    const revoked = !rows[0].revoked;
    await db('scripts', { method:'PATCH', query:`name=eq.${encodeURIComponent(name)}&owner_key=eq.${encodeURIComponent(key)}`, body:{ revoked, toggle_at:new Date().toISOString(), updated_at:new Date().toISOString() }, prefer:'return=minimal' });
    await audit(revoked ? 'disable' : 'enable', name, key);
    res.json({ success:true, revoked });
  } catch (e) { apiError(res, e); }
});

app.get('/:slug', async (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/health') return next();
  const slug = cleanName(req.params.slug);
  if (!validName(slug)) return res.status(404).sendFile(path.join(__dirname, 'public', 'not-found.html'));
  try {
    const rows = await db('scripts', { query:`select=name,content,revoked,deleted_at&name=eq.${encodeURIComponent(slug)}&limit=1` });
    if (!rows.length || rows[0].deleted_at) return res.status(404).sendFile(path.join(__dirname, 'public', 'not-found.html'));
    if (rows[0].revoked) return res.status(403).type('text').send("warn('[Lunex] This source is disabled.')");
    // Same named URL: browser gets a protected information page; executor gets code with ?exec=1.
    if (req.query.exec === '1') {
      res.set({
        'Content-Type':'text/plain; charset=utf-8',
        'Cache-Control':'no-store, no-cache, must-revalidate',
        Pragma:'no-cache',
        'X-Content-Type-Options':'nosniff',
        'Content-Disposition':'inline'
      });
      return res.status(200).send(rows[0].content || "warn('[Lunex] Empty source.')");
    }
    return res.sendFile(path.join(__dirname, 'public', 'protected.html'));
  } catch (e) {
    console.error('Lunex route error:', e.message);
    res.status(503).send('Lunex is temporarily unavailable.');
  }
});

app.use(express.static(path.join(__dirname, 'public'), { index:'index.html', maxAge:'1h' }));
app.use((_req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'not-found.html')));

app.listen(PORT, () => console.log(`Lunex Scripts listening on ${PORT}`));
