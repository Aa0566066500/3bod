const { getDb, ensureSchema, getOwnerToken, respond } = require("./_lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "method_not_allowed" });

  const name = (event.queryStringParameters || {}).name;
  if (!name) return respond(400, { error: "name_required" });

  const { token, isNew } = getOwnerToken(event);
  const db = getDb();
  await ensureSchema(db);

  const row = await db.execute({ sql: "SELECT owner_token, kill_switch FROM scripts WHERE name=?", args: [name] });
  if (!row.rows.length) return respond(404, { error: "not_found" }, isNew ? token : null);
  if (row.rows[0].owner_token !== token) return respond(403, { error: "forbidden" }, isNew ? token : null);

  const next = row.rows[0].kill_switch ? 0 : 1;
  await db.execute({ sql: "UPDATE scripts SET kill_switch=? WHERE name=?", args: [next, name] });
  return respond(200, { ok: true, kill_switch: next }, isNew ? token : null);
};
