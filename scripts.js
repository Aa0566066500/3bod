const { getDb, ensureSchema, getOwnerToken, applyCookieIfNew, encryptCode } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const { token, isNew } = getOwnerToken(req);
  applyCookieIfNew(res, isNew, token);

  const db = getDb();
  await ensureSchema(db);

  const body = req.body || {};
  const { name, code } = body;
  if (!name || !code) return res.status(400).json({ error: "name_and_code_required" });

  const cleanName = String(name).trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
  if (!cleanName) return res.status(400).json({ error: "invalid_name" });

  const existing = await db.execute({ sql: "SELECT owner_token FROM scripts WHERE name=?", args: [cleanName] });
  if (existing.rows.length && existing.rows[0].owner_token !== token) {
    return res.status(403).json({ error: "name_taken_by_another_owner" });
  }

  const enc = encryptCode(String(code));
  const now = new Date().toISOString();

  if (existing.rows.length) {
    await db.execute({
      sql: "UPDATE scripts SET enc_salt=?, enc_iv=?, enc_tag=?, enc_data=?, updated_at=? WHERE name=?",
      args: [enc.salt, enc.iv, enc.tag, enc.data, now, cleanName],
    });
    return res.status(200).json({ ok: true, name: cleanName, updated: true });
  }

  await db.execute({
    sql: `INSERT INTO scripts (name, owner_token, enc_salt, enc_iv, enc_tag, enc_data, kill_switch, pull_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    args: [cleanName, token, enc.salt, enc.iv, enc.tag, enc.data, now, now],
  });
  return res.status(200).json({ ok: true, name: cleanName, created: true });
};
