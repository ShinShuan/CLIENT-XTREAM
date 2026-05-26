/**
 * Xtream Proxy - Node.js Serverless Function (Vercel)
 * Proxyfie les appels API Xtream et les flux vidéo.
 * Résout les problèmes CORS.
 */

const http = require('http');
const https = require('https');
const url = require('url');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Missing url param' });

  const decoded = decodeURIComponent(target);
  const parsed = url.parse(decoded);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.path + (parsed.hash || ''),
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; XtreamClient/1.0)',
      'Accept': req.headers['accept'] || '*/*',
    },
    timeout: 25000,
  };
  if (req.headers['range']) options.headers['Range'] = req.headers['range'];

  const proxyReq = transport.request(options, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || '';

    // M3U8 rewrite
    if (/mpegurl|m3u|vnd\.apple/.test(ct)) {
      let body = '';
      proxyRes.on('data', c => body += c);
      proxyRes.on('end', () => {
        const baseDir = decoded.substring(0, decoded.lastIndexOf('/') + 1);
        const proxyBase = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}/api/proxy`;
        const rewritten = body.split('\n').map(line => {
          const t = line.trim();
          if (t.startsWith('#') || !t) return line;
          try { return `${proxyBase}?url=${encodeURIComponent(new URL(t, baseDir).href)}`; } catch { return line; }
        }).join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).send(rewritten);
      });
      return;
    }

    // Forward binary/JSON
    const status = proxyRes.statusCode || 200;
    if (ct) res.setHeader('Content-Type', ct);
    if (proxyRes.headers['content-length']) res.setHeader('Content-Length', proxyRes.headers['content-length']);
    if (proxyRes.headers['content-range']) res.setHeader('Content-Range', proxyRes.headers['content-range']);
    res.setHeader('Cache-Control', 'no-cache');
    res.status(status);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => res.status(500).json({ error: err.message }));
  proxyReq.on('timeout', () => { proxyReq.destroy(); res.status(504).json({ error: 'Timeout' }); });
  proxyReq.end();
};