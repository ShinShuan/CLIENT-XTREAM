/**
 * Xtream Proxy - .edge.js → Edge Runtime automatique
 * Proxies API calls + streams. Réécrit les playlists M3U8.
 */

export async function handler(request) {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'Paramètre url manquant' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const decodedUrl = decodeURIComponent(target);

  try {
    const upstream = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; XtreamClient/1.0)',
        'Accept': request.headers.get('accept') || '*/*',
        'Range': request.headers.get('range') || '',
      },
    });

    const ct = upstream.headers.get('content-type') || '';

    // --- Playlist M3U8 : réécrit les segments → proxy ---
    if (ct.includes('mpegurl') || ct.includes('m3u') || ct.includes('vnd.apple.mpegurl')) {
      const text = await upstream.text();
      const baseDir = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);
      const proxyBase = `${reqUrl.origin}/api/proxy`;
      const rewritten = text.split('\n').map(line => {
        const t = line.trim();
        if (t.startsWith('#') || !t) return line;
        let absolute;
        try { absolute = new URL(t, baseDir).href; } catch { return line; }
        return `${proxyBase}?url=${encodeURIComponent(absolute)}`;
      });

      return new Response(rewritten.join('\n'), {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache',
        },
      });
    }

    // --- JSON / Binaire ---
    const respHeaders = {
      'content-type': ct || 'application/octet-stream',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'cache-control': 'no-cache, no-store, must-revalidate',
    };
    const cl = upstream.headers.get('content-length');
    if (cl) respHeaders['content-length'] = cl;
    const range = upstream.headers.get('content-range');
    if (range) respHeaders['content-range'] = range;

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}