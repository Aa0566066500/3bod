const plain = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
    'x-content-type-options': 'nosniff'
  },
  body
});

export default async function handler(event) {
  const name = String(
    event.queryStringParameters?.name || ''
  ).toLowerCase().trim();

  if (
    !/^[a-z0-9-]{8,100}$/.test(name) ||
    !/\d/.test(name)
  ) {
    return plain(
      400,
      "warn('[Lunex.Script] Invalid source name.')"
    );
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return plain(
      503,
      "warn('[Lunex.Script] Service unavailable.')"
    );
  }

  try {
    const query = new URLSearchParams({
      select: 'name,content,revoked,deleted_at',
      name: `eq.${name}`,
      limit: '1'
    });

    const result = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/scripts?${query}`,
      {
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`
        }
      }
    );

    if (!result.ok) {
      return plain(
        503,
        "warn('[Lunex.Script] Service unavailable.')"
      );
    }

    const rows = await result.json();

    if (!rows.length || rows[0].deleted_at) {
      return plain(
        404,
        "warn('[Lunex.Script] Source not found.')"
      );
    }

    if (rows[0].revoked) {
      return plain(
        403,
        "warn('[Lunex.Script] SOURCE DISABLED')"
      );
    }

    return plain(
      200,
      rows[0].content ||
      "warn('[Lunex.Script] Empty source.')"
    );
  } catch {
    return plain(
      500,
      "warn('[Lunex.Script] Internal error.')"
    );
  }
}