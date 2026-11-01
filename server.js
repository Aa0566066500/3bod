const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const path = require('node:path');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: '500kb' }));

const apiLimit = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

const publicDir = path.join(__dirname, 'public');

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables.');
  }

  return {
    url: url.replace(/\/+$/, ''),
    key
  };
}

async function db(table, options = {}) {
  const {
    method = 'GET',
    query = '',
    body,
    prefer
  } = options;

  const c = config();

  const response = await fetch(
    `${c.url}/rest/v1/${table}${query ? `?${query}` : ''}`,
    {
      method,
      headers: {
        apikey: c.key,
        authorization: `Bearer ${c.key}`,
        'content-type': 'application/json',
        ...(prefer ? { prefer } : {})
      },
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {})
    }
  );

  const raw = await response.text();

  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    const error = new Error(
      typeof data === 'object'
        ? data?.message ||
          data?.details ||
          'Database error'
        : 'Database error'
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

function hashKey(key) {
  return crypto
    .createHash('sha256')
    .update(key)
    .digest('hex');
}

function generateKey() {
  let digits = '';

  for (let i = 0; i < 20; i++) {
    digits += crypto.randomInt(0, 10);
  }

  return `LS-${digits}`;
}

function cleanSlug(value = '') {
  return String(value)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function validSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/.test(slug);
}

function getKey(req) {
  return String(
    req.get('x-lunex-key') ||
    req.body?.key ||
    ''
  ).trim();
}

/*
 * تجهيز النسخة المنشورة.
 *
 * هذه الدالة لا تنفذ تشويش Luau حقيقيًا.
 * اربط بها أداة تشويش متوافقة بعد اختيارها واختبارها.
 *
 * حاليًا تحفظ نسخة منفصلة من الكود الأصلي.
 */
function buildPublishedSource(source) {
  return String(source);
}

async function validOwner(req) {
  const key = getKey(req);

  if (!/^LS-\d{20}$/.test(key)) {
    return null;
  }

  const ownerKeyHash = hashKey(key);

  const rows = await db('site_keys', {
    query:
      `select=owner_key_hash,disabled` +
      `&owner_key_hash=eq.${ownerKeyHash}&limit=1`
  });

  if (!rows?.[0] || rows[0].disabled) {
    return null;
  }

  return ownerKeyHash;
}

async function audit(
  eventType,
  slug,
  ownerHash,
  details = {}
) {
  try {
    await db('audit_events', {
      method: 'POST',
      body: {
        owner_key_hash: ownerHash || null,
        event_type: eventType,
        script_slug: slug || null,
        details
      },
      prefer: 'return=minimal'
    });
  } catch (error) {
    console.error('Audit write failed:', error.message);
  }
}

function apiError(res, error) {
  console.error('Lunex API error:', error.message);

  const status =
    error.status && error.status < 500
      ? error.status
      : 500;

  res.status(status).json({
    error:
      status === 500
        ? 'حدث خطأ بالخادم. تحقق من إعدادات Supabase.'
        : error.message
  });
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'LUNEX SCRIPTS'
  });
});

app.use('/api', apiLimit);

/* إنشاء مفتاح مالك */

app.post('/api/owner-key', async (_req, res) => {
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = generateKey();
      const ownerKeyHash = hashKey(key);

      try {
        await db('site_keys', {
          method: 'POST',
          body: {
            owner_key_hash: ownerKeyHash
          },
          prefer: 'return=minimal'
        });

        return res.json({ key });
      } catch (error) {
        if (
          error.status !== 409 &&
          error.status !== 400
        ) {
          throw error;
        }
      }
    }

    res.status(503).json({
      error: 'تعذر إنشاء مفتاح الآن. حاول مرة أخرى.'
    });
  } catch (error) {
    apiError(res, error);
  }
});

/* التحقق من المفتاح */

app.post('/api/verify-key', async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim();

    if (!/^LS-\d{20}$/.test(key)) {
      return res.status(401).json({
        valid: false
      });
    }

    const ownerKeyHash = hashKey(key);

    const rows = await db('site_keys', {
      query:
        `select=owner_key_hash,disabled` +
        `&owner_key_hash=eq.${ownerKeyHash}&limit=1`
    });

    const valid = !!(
      rows?.[0] &&
      !rows[0].disabled
    );

    res.status(valid ? 200 : 401).json({
      valid
    });
  } catch (error) {
    apiError(res, error);
  }
});

/* عرض سكربتات المالك */

app.get('/api/scripts', async (req, res) => {
  try {
    const ownerHash = await validOwner(req);

    if (!ownerHash) {
      return res.status(401).json({
        error: 'المفتاح غير صحيح.'
      });
    }

    const scripts = await db('scripts', {
      query:
        'select=id,slug,title,content,enabled,created_at,updated_at,last_toggle_at' +
        `&owner_key_hash=eq.${ownerHash}` +
        '&order=updated_at.desc'
    });

    res.json({
      scripts: scripts || []
    });
  } catch (error) {
    apiError(res, error);
  }
});

/* إنشاء سكربت */

app.post('/api/scripts', async (req, res) => {
  try {
    const ownerHash = await validOwner(req);

    if (!ownerHash) {
      return res.status(401).json({
        error: 'المفتاح غير صحيح.'
      });
    }

    const slug = cleanSlug(
      req.body?.slug || req.body?.title
    );

    const title = String(
      req.body?.title || slug
    ).trim().slice(0, 100);

    const content = String(
      req.body?.content || ''
    );

    if (!validSlug(slug)) {
      return res.status(400).json({
        error: 'استخدم اسمًا إنجليزيًا صالحًا للرابط.'
      });
    }

    if (
      !title ||
      !content.trim() ||
      content.length > 500000
    ) {
      return res.status(400).json({
        error: 'أدخل اسمًا وكودًا صالحًا لا يتجاوز 500 ألف حرف.'
      });
    }

    const existing = await db('scripts', {
      query:
        `select=slug&slug=eq.${encodeURIComponent(slug)}&limit=1`
    });

    if (existing?.length) {
      return res.status(409).json({
        error: 'هذا الرابط مستخدم بالفعل. اختر اسمًا آخر.'
      });
    }

    const publishedContent =
      buildPublishedSource(content);

    await db('scripts', {
      method: 'POST',
      body: {
        owner_key_hash: ownerHash,
        slug,
        title,
        content,
        published_content: publishedContent,
        enabled: true
      },
      prefer: 'return=minimal'
    });

    await audit(
      'script_created',
      slug,
      ownerHash
    );

    res.json({
      success: true,
      slug,
      url: `${req.protocol}://${req.get('host')}/${slug}`
    });
  } catch (error) {
    apiError(res, error);
  }
});

/* تعديل سكربت مع الإبقاء على رابطه */

app.put('/api/scripts/:slug', async (req, res) => {
  try {
    const ownerHash = await validOwner(req);

    if (!ownerHash) {
      return res.status(401).json({
        error: 'المفتاح غير صحيح.'
      });
    }

    const slug = cleanSlug(req.params.slug);

    const title = String(
      req.body?.title || slug
    ).trim().slice(0, 100);

    const content = String(
      req.body?.content || ''
    );

    if (
      !title ||
      !content.trim() ||
      content.length > 500000
    ) {
      return res.status(400).json({
        error: 'الاسم أو الكود غير صالح.'
      });
    }

    const rows = await db('scripts', {
      query:
        `select=slug&slug=eq.${encodeURIComponent(slug)}` +
        `&owner_key_hash=eq.${ownerHash}&limit=1`
    });

    if (!rows?.length) {
      return res.status(404).json({
        error: 'السورس غير موجود أو لا تملكه.'
      });
    }

    const publishedContent =
      buildPublishedSource(content);

    await db('scripts', {
      method: 'PATCH',
      query:
        `slug=eq.${encodeURIComponent(slug)}` +
        `&owner_key_hash=eq.${ownerHash}`,
      body: {
        title,
        content,
        published_content: publishedContent,
        updated_at: new Date().toISOString()
      },
      prefer: 'return=minimal'
    });

    await audit(
      'script_updated',
      slug,
      ownerHash
    );

    res.json({
      success: true,
      slug,
      url: `${req.protocol}://${req.get('host')}/${slug}`
    });
  } catch (error) {
    apiError(res, error);
  }
});

/* حذف سكربت */

app.delete('/api/scripts/:slug', async (req, res) => {
  try {
    const ownerHash = await validOwner(req);

    if (!ownerHash) {
      return res.status(401).json({
        error: 'المفتاح غير صحيح.'
      });
    }

    const slug = cleanSlug(req.params.slug);

    const rows = await db('scripts', {
      query:
        `select=slug&slug=eq.${encodeURIComponent(slug)}` +
        `&owner_key_hash=eq.${ownerHash}&limit=1`
    });

    if (!rows?.length) {
      return res.status(404).json({
        error: 'السورس غير موجود أو لا تملكه.'
      });
    }

    await db('scripts', {
      method: 'DELETE',
      query:
        `slug=eq.${encodeURIComponent(slug)}` +
        `&owner_key_hash=eq.${ownerHash}`
    });

    await audit(
      'script_deleted',
      slug,
      ownerHash
    );

    res.json({
      success: true
    });
  } catch (error) {
    apiError(res, error);
  }
});

/* تفعيل أو تعطيل سكربت */

app.post('/api/scripts/:slug/toggle', async (req, res) => {
  try {
    const ownerHash = await validOwner(req);

    if (!ownerHash) {
      return res.status(401).json({
        error: 'المفتاح غير صحيح.'
      });
    }

    const slug = cleanSlug(req.params.slug);

    const rows = await db('scripts', {
      query:
        `select=slug,enabled,last_toggle_at` +
        `&slug=eq.${encodeURIComponent(slug)}` +
        `&owner_key_hash=eq.${ownerHash}&limit=1`
    });

    if (!rows?.length) {
      return res.status(404).json({
        error: 'السورس غير موجود أو لا تملكه.'
      });
    }

    const script = rows[0];
    const now = Date.now();

    const last = script.last_toggle_at
      ? Date.parse(script.last_toggle_at)
      : 0;

    const wait = 15000 - (now - last);

    if (last && wait > 0) {
      return res.status(429).json({
        error: `انتظر ${Math.ceil(wait / 1000)} ثانية قبل تغيير الحالة.`
      });
    }

    const enabled = !script.enabled;
    const timestamp = new Date().toISOString();

    await db('scripts', {
      method: 'PATCH',
      query:
        `slug=eq.${encodeURIComponent(slug)}` +
        `&owner_key_hash=eq.${ownerHash}`,
      body: {
        enabled,
        last_toggle_at: timestamp,
        updated_at: timestamp
      },
      prefer: 'return=minimal'
    });

    await audit(
      enabled ? 'script_enabled' : 'script_disabled',
      slug,
      ownerHash
    );

    res.json({
      success: true,
      enabled
    });
  } catch (error) {
    apiError(res, error);
  }
});

/* سجل الأحداث */

app.get('/api/logs', async (req, res) => {
  try {
    const ownerHash = await validOwner(req);

    if (!ownerHash) {
      return res.status(401).json({
        error: 'المفتاح غير صحيح.'
      });
    }

    const logs = await db('audit_events', {
      query:
        'select=id,event_type,script_slug,details,created_at' +
        `&owner_key_hash=eq.${ownerHash}` +
        '&order=created_at.desc&limit=100'
    });

    res.json({
      logs: logs || []
    });
  } catch (error) {
    apiError(res, error);
  }
});

/* رابط السكربت المنشور */

app.get('/:slug', async (req, res) => {
  const slug = cleanSlug(req.params.slug);

  if (!validSlug(slug)) {
    return res
      .status(404)
      .sendFile(path.join(publicDir, 'not-found.html'));
  }

  try {
    const rows = await db('scripts', {
      query:
        'select=slug,title,enabled,owner_key_hash,published_content' +
        `&slug=eq.${encodeURIComponent(slug)}&limit=1`
    });

    if (!rows?.length) {
      await audit(
        'unknown_slug_request',
        slug,
        null,
        {
          method: req.method,
          mode: req.query.exec === '1' ? 'exec' : 'page'
        }
      );

      return res
        .status(404)
        .sendFile(path.join(publicDir, 'not-found.html'));
    }

    const script = rows[0];

    await audit(
      script.enabled
        ? 'source_request'
        : 'disabled_source_request',
      slug,
      script.owner_key_hash,
      {
        method: req.method,
        mode: req.query.exec === '1' ? 'exec' : 'page'
      }
    );

    if (!script.enabled) {
      if (req.query.exec === '1') {
        return res
          .status(403)
          .set('Cache-Control', 'no-store')
          .type('text/plain')
          .send("warn('[LUNEX] This source is disabled.')");
      }

      return res.status(403).type('text').send(
        'هذا السكربت معطّل حاليًا.'
      );
    }

    if (req.query.exec === '1') {
      if (
        typeof script.published_content !== 'string' ||
        !script.published_content.trim()
      ) {
        return res
          .status(404)
          .set('Cache-Control', 'no-store')
          .type('text/plain')
          .send("warn('[LUNEX] Published source unavailable.')");
      }

      return res
        .set({
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          'X-Content-Type-Options': 'nosniff'
        })
        .type('text/plain')
        .send(script.published_content);
    }

    return res.sendFile(
      path.join(publicDir, 'protected.html')
    );
  } catch (error) {
    console.error(
      'Source route error:',
      error.message
    );

    return res
      .status(503)
      .type('text/plain')
      .send('LUNEX SCRIPTS is temporarily unavailable.');
  }
});

/* الملفات الثابتة */

app.use(express.static(publicDir, {
  index: 'index.html'
}));

app.use((_req, res) => {
  res.status(404).sendFile(
    path.join(publicDir, 'not-found.html')
  );
});

app.listen(PORT, () => {
  console.log(`LUNEX SCRIPTS listening on port ${PORT}`);
});