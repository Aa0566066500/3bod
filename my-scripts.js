const { getDb, ensureSchema, getOwnerToken, applyCookieIfNew } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const { token, isNew } = getOwnerToken(req);
  applyCookieIfNew(res, isNew, token);

  const db = getDb();
  await ensureSchema(db);

  const result = await db.execute({
    sql: `SELECT name, kill_switch, pull_count, created_at, updated_at FROM scripts WHERE owner_token=? ORDER BY updated_at DESC`,
    args: [token],
  });

  return res.status(200).json({ scripts: result.rows });
};
