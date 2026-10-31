const { getDb, ensureSchema, getOwnerToken, respond } = require("./_lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return respond(405, { error: "method_not_allowed" });

  const { token, isNew } = getOwnerToken(event);
  const db = getDb();
  await ensureSchema(db);

  const result = await db.execute({
    sql: `SELECT name, kill_switch, pull_count, created_at, updated_at FROM scripts WHERE owner_token=? ORDER BY updated_at DESC`,
    args: [token],
  });

  return respond(200, { scripts: result.rows }, isNew ? token : null);
};
