const { getDb, ensureSchema, getOwnerToken, applyCookieIfNew } = require("../_lib");

module.exports = async (req, res) => {
  if (req.method !== "DELETE") return res.status(405).json({ error: "method_not_allowed" });

  const name = req.query.name;
  const { token, isNew } = getOwnerToken(req);
  applyCookieIfNew(res, isNew, token);

  const db = getDb();
  await ensureSchema(db);

  const row = await db.execute({ sql: "SELECT owner_token FROM scripts WHERE name=?", args: [name] });
  if (!row.rows.length) return res.status(404).json({ error: "not_found" });
  if (row.rows[0].owner_token !== token) return res.status(403).json({ error: "forbidden" });

  await db.execute({ sql: "DELETE FROM scripts WHERE name=?", args: [name] });
  return res.status(200).json({ ok: true });
};
