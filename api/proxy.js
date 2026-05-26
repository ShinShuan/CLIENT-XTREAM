/**
 * Xtream Proxy - Edge Function (Vercel)
 * Proxies API calls (JSON) and streams (binary).
 * Si la réponse est un playlist M3U8, réécrit les URLs des segments
 * pour qu'ils passent aussi par le proxy (évite CORS).
 */
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const reqUrl = new URL(req.url);
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
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; XtreamClient/1.0)',
        'Accept': req.headers.get('accept') || '*/*',
        'Range': req.headers.get('range') || '',
      },
    });

    const ct = upstream.headers.get('content-type') || '';

    // --- M3U8 playlist : on réécrit les URLs des segments ---
    if (ct.includes('mpegurl') || ct.includes('m3u') || ct.includes('vnd.apple.mpegurl')) {
      const text = await upstream.text();
      const baseDir = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);
      const proxyBase = `${reqUrl.origin}/api/proxy`;
      const lines = text.split('\n');
      const rewritten = lines.map(line => {
        const t = line.trim();
        if (t.startsWith('#') || !t) return line;
        let absolute;
        try {
          absolute = new URL(t, baseDir).href;
        } catch {
          return line;
        }
        return `${proxyBase}?url=${encodeURIComponent(absolute)}`;
      });

      return new Response(rewritten.join('\n'), {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': '*',
          'cache-control': 'no-cache',
        },
      });
    }

    // --- JSON (API) ou binaire (stream) : on passe la réponse ---
    const respHeaders = {
      'content-type': ct || 'application/octet-stream',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': '*',
      'cache-control': 'no-cache, no-store, must-revalidate',
    };

    const cl = upstream.headers.get('content-length');
    if (cl) respHeaders['content-length'] = cl;

    const range = upstream.headers.get('content-range');
    if (range) respHeaders['content-range'] = range;

    // Gestion des status partiels (206) et des redirections
    const status = upstream.status;

    return new Response(upstream.body, {
      status,
      headers: respHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}