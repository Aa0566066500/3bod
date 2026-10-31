const { getDb, ensureSchema, getOwnerToken, applyCookieIfNew } = require("../../_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const name = req.query.name;
  const { token, isNew } = getOwnerToken(req);
  applyCookieIfNew(res, isNew, token);

  const db = getDb();
  await ensureSchema(db);

  const row = await db.execute({ sql: "SELECT owner_token, kill_switch FROM scripts WHERE name=?", args: [name] });
  if (!row.rows.length) return res.status(404).json({ error: "not_found" });
  if (row.rows[0].owner_token !== token) return res.status(403).json({ error: "forbidden" });

  const next = row.rows[0].kill_switch ? 0 : 1;
  await db.execute({ sql: "UPDATE scripts SET kill_switch=? WHERE name=?", args: [next, name] });
  return res.status(200).json({ ok: true, kill_switch: next });
};
