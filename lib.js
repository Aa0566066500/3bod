/**
 * Lunex.Scripts — ملف مشترك بين كل الـ Netlify Functions
 *
 * ملاحظة مهمة: Netlify Functions ما عندها قرص دائم (ephemeral) — ما نقدر نستخدم
 * SQLite محلي زي نسخة Render. لازم قاعدة بيانات خارجية دائمة. استخدمنا Turso
 * (libSQL — متوافق مع SQLite تماماً، وله باقة مجانية مناسبة لمشروع زي هذا).
 */

const crypto = require("crypto");
const { createClient } = require("@libsql/client");

const MASTER_KEY = process.env.MASTER_KEY;
const COOKIE_NAME = "lnx_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5; // 5 سنوات

if (!MASTER_KEY) {
  throw new Error("MASTER_KEY غير موجود — ضيفه من Netlify > Site configuration > Environment variables");
}

let dbClient = null;
function getDb() {
  if (dbClient) return dbClient;
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("TURSO_DATABASE_URL أو TURSO_AUTH_TOKEN غير موجودين في Environment variables");
  }
  dbClient = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return dbClient;
}

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    owner_token TEXT NOT NULL,
    enc_salt TEXT NOT NULL,
    enc_iv TEXT NOT NULL,
    enc_tag TEXT NOT NULL,
    enc_data TEXT NOT NULL,
    kill_switch INTEGER NOT NULL DEFAULT 1,
    pull_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS pull_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id INTEGER NOT NULL,
    ip TEXT,
    ua TEXT,
    created_at TEXT NOT NULL
  )`);
  schemaReady = true;
}

/* ===== الهوية بدون تسجيل دخول ===== */

function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i === -1) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function getOwnerToken(event) {
  const raw = event.headers.cookie || event.headers.Cookie || "";
  const cookies = parseCookies(raw);
  const existing = cookies[COOKIE_NAME];
  if (existing) return { token: existing, isNew: false };
  return { token: crypto.randomUUID(), isNew: true };
}

function setCookieHeader(token) {
  return `${COOKIE_NAME}=${token}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/* ===== استجابة JSON موحّدة (مع ضبط الكوكي عند الحاجة) ===== */

function respond(statusCode, obj, newToken) {
  const headers = { "content-type": "application/json" };
  if (newToken) headers["set-cookie"] = setCookieHeader(newToken);
  return { statusCode, headers, body: JSON.stringify(obj) };
}

/* ===== التشفير AES-256-GCM ===== */

function deriveKey(salt) {
  return crypto.scryptSync(MASTER_KEY, salt, 32);
}

function encryptCode(code) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { salt, iv: iv.toString("hex"), tag: tag.toString("hex"), data: enc.toString("hex") };
}

function decryptCode(salt, ivHex, tagHex, dataHex) {
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return dec.toString("utf8");
}

/* ===== كشف متصفح عادي مقابل طلب تنفيذ ===== */

function looksLikeBrowser(event) {
  const ua = (event.headers["user-agent"] || event.headers["User-Agent"] || "").toLowerCase();
  const accept = (event.headers["accept"] || event.headers["Accept"] || "").toLowerCase();
  if (accept.includes("text/html")) return true;
  if (ua.includes("mozilla") || ua.includes("chrome") || ua.includes("safari") || ua.includes("edg/")) return true;
  return false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderProtectedPage(name, host) {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>سورس محمي — Lunex.Scripts</title>
<link rel="stylesheet" href="/style.css">
</head>
<body class="protected-page">
<div class="card">
  <div class="lock">🔒</div>
  <h1>هذا السورس محمي</h1>
  <p>السورس "<b>${escapeHtml(name)}</b>" لا يظهر إلا وقت التنفيذ داخل Roblox Studio، ولا يمكن فتحه أو نسخه من المتصفح.</p>
  <div class="box" id="snippet">loadstring(game:HttpGet("https://${escapeHtml(host)}/${escapeHtml(name)}/raw"))()</div>
  <button onclick="navigator.clipboard.writeText(document.getElementById('snippet').textContent)">نسخ رابط التنفيذ</button>
  <div class="brand">Lunex.Scripts</div>
</div>
</body></html>`;
}

module.exports = {
  getDb,
  ensureSchema,
  getOwnerToken,
  setCookieHeader,
  respond,
  encryptCode,
  decryptCode,
  looksLikeBrowser,
  renderProtectedPage,
};
