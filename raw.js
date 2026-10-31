const { getDb, ensureSchema, decryptCode, looksLikeBrowser, renderProtectedPage } = require("./_lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "method not allowed" };

  const cleanName = ((event.queryStringParameters || {}).name || "").toLowerCase();
  if (!cleanName) return { statusCode: 400, body: "-- name required" };

  const db = getDb();
  await ensureSchema(db);

  const result = await db.execute({ sql: "SELECT * FROM scripts WHERE name=?", args: [cleanName] });
  if (!result.rows.length) {
    return { statusCode: 404, headers: { "content-type": "text/plain; charset=utf-8" }, body: "-- not found" };
  }
  const row = result.rows[0];

  const ip = event.headers["x-forwarded-for"] || event.headers["client-ip"] || "unknown";
  const ua = event.headers["user-agent"] || "unknown";
  await db.execute({
    sql: "INSERT INTO pull_logs (script_id, ip, ua, created_at) VALUES (?, ?, ?, ?)",
    args: [row.id, String(ip), ua, new Date().toISOString()],
  });
  await db.execute({ sql: "UPDATE scripts SET pull_count = pull_count + 1 WHERE id=?", args: [row.id] });

  if (!row.kill_switch) {
    return {
      statusCode: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      body: "-- script disabled by owner",
    };
  }

  if (looksLikeBrowser(event)) {
    const host = event.headers.host || event.headers["x-forwarded-host"] || "";
    return {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      body: renderProtectedPage(cleanName, host),
    };
  }

  const code = decryptCode(row.enc_salt, row.enc_iv, row.enc_tag, row.enc_data);
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "x-content-type-options": "nosniff",
    },
    body: code,
  };
};
