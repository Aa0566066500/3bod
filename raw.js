const { getDb, ensureSchema, decryptCode, looksLikeBrowser, renderProtectedPage } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).send("method not allowed");

  const cleanName = String(req.query.name || "").toLowerCase();
  if (!cleanName) return res.status(400).type("text/plain").send("-- name required");

  const db = getDb();
  await ensureSchema(db);

  const result = await db.execute({ sql: "SELECT * FROM scripts WHERE name=?", args: [cleanName] });
  if (!result.rows.length) return res.status(404).type("text/plain").send("-- not found");
  const row = result.rows[0];

  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  await db.execute({
    sql: "INSERT INTO pull_logs (script_id, ip, ua, created_at) VALUES (?, ?, ?, ?)",
    args: [row.id, String(ip), ua, new Date().toISOString()],
  });
  await db.execute({ sql: "UPDATE scripts SET pull_count = pull_count + 1 WHERE id=?", args: [row.id] });

  if (!row.kill_switch) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(403).type("text/plain").send("-- script disabled by owner");
  }

  if (looksLikeBrowser(req)) {
    const host = req.headers.host || "";
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).type("html").send(renderProtectedPage(cleanName, host));
  }

  const code = decryptCode(row.enc_salt, row.enc_iv, row.enc_tag, row.enc_data);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).type("text/plain; charset=utf-8").send(code);
};
