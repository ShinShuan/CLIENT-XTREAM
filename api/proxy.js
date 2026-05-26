/**
 * Xtream Proxy - Node.js Serverless Function (Vercel)
 * Proxyfie les appels API Xtream (JSON) et les flux vidéo.
 * Tourne sur Vercel → pas de CORS, pas de timeout navigateur.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Missing url param' });

  const decoded = decodeURIComponent(target);
  let parsed;
  try { parsed = new URL(decoded); } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; XtreamClient/1.0)',
      'Accept': '*/*',
    },
    timeout: 30000,
  };

  if (req.headers['range']) options.headers['Range'] = req.headers['range'];

  const proxyReq = transport.request(options, (proxyRes) => {
    const statusCode = proxyRes.statusCode || 200;
    const ct = proxyRes.headers['content-type'] || '';

    // M3U8 playlist rewrite
    if (/mpegurl|m3u|vnd\.apple/i.test(ct)) {
      let body = '';
      proxyRes.on('data', chunk => body += chunk);
      proxyRes.on('end', () => {
        const baseDir = decoded.substring(0, decoded.lastIndexOf('/') + 1);
        const proxyBase = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}/api/proxy`;
        const lines = body.split('\n');
        const rewritten = lines.map(line => {
          const t = line.trim();
          if (t.startsWith('#') || !t) return line;
          try {
            const abs = new URL(t, baseDir).href;
            return `${proxyBase}?url=${encodeURIComponent(abs)}`;
          } catch { return line; }
        }).join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).send(rewritten);
      });
      return;
    }

    // Forward response headers
    if (ct) res.setHeader('Content-Type', ct);
    if (proxyRes.headers['content-length']) res.setHeader('Content-Length', proxyRes.headers['content-length']);
    if (proxyRes.headers['content-range']) res.setHeader('Content-Range', proxyRes.headers['content-range']);
    res.setHeader('Cache-Control', 'no-cache');
    res.status(statusCode);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: `Proxy error: ${err.message}` });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ error: 'Timeout - Le serveur Xtream ne répond pas' });
  });

  proxyReq.end();
};