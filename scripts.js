const { getDb, ensureSchema, getOwnerToken, respond, encryptCode } = require("./_lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "method_not_allowed" });

  const { token, isNew } = getOwnerToken(event);
  const db = getDb();
  await ensureSchema(db);

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "bad_json" }, isNew ? token : null);
  }

  const { name, code } = body;
  if (!name || !code) return respond(400, { error: "name_and_code_required" }, isNew ? token : null);

  const cleanName = String(name).trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
  if (!cleanName) return respond(400, { error: "invalid_name" }, isNew ? token : null);

  const existing = await db.execute({ sql: "SELECT owner_token FROM scripts WHERE name=?", args: [cleanName] });
  if (existing.rows.length && existing.rows[0].owner_token !== token) {
    return respond(403, { error: "name_taken_by_another_owner" }, isNew ? token : null);
  }

  const enc = encryptCode(String(code));
  const now = new Date().toISOString();

  if (existing.rows.length) {
    await db.execute({
      sql: "UPDATE scripts SET enc_salt=?, enc_iv=?, enc_tag=?, enc_data=?, updated_at=? WHERE name=?",
      args: [enc.salt, enc.iv, enc.tag, enc.data, now, cleanName],
    });
    return respond(200, { ok: true, name: cleanName, updated: true }, isNew ? token : null);
  }

  await db.execute({
    sql: `INSERT INTO scripts (name, owner_token, enc_salt, enc_iv, enc_tag, enc_data, kill_switch, pull_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    args: [cleanName, token, enc.salt, enc.iv, enc.tag, enc.data, now, now],
  });
  return respond(200, { ok: true, name: cleanName, created: true }, isNew ? token : null);
};
