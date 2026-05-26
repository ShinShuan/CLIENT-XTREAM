/**
 * Xtream Proxy - Node.js Serverless Function (Vercel)
 * Proxie les appels API Xtream (JSON) et les flux vidéo.
 * Résout les problèmes CORS des serveurs Xtream.
 */

const https = require('https');
const http = require('http');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const target = req.query.url;
  if (!target) {
    res.status(400).json({ error: 'Paramètre url manquant' });
    return;
  }

  const decodedUrl = decodeURIComponent(target);

  try {
    const parsedUrl = new URL(decodedUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; XtreamClient/1.0)',
        'Accept': req.headers['accept'] || '*/*',
      },
      timeout: 25000,
    };

    // Forward Range header for video seeking
    if (req.headers['range']) {
      options.headers['Range'] = req.headers['range'];
    }

    const proxyReq = transport.request(options, (proxyRes) => {
      const ct = proxyRes.headers['content-type'] || '';

      // --- M3U8 : réécriture des URLs des segments ---
      if (ct.includes('mpegurl') || ct.includes('m3u') || ct.includes('vnd.apple.mpegurl')) {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          const baseDir = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);
          const proxyBase = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}/api/proxy`;
          const rewritten = body.split('\n').map(line => {
            const t = line.trim();
            if (t.startsWith('#') || !t) return line;
            let absolute;
            try { absolute = new URL(t, baseDir).href; } catch { return line; }
            return `${proxyBase}?url=${encodeURIComponent(absolute)}`;
          }).join('\n');

          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-cache');
          res.status(200).send(rewritten);
        });
        return;
      }

      // --- Binaire / JSON : forward la réponse ---
      const statusCode = proxyRes.statusCode || 200;

      // Forward content-type
      if (ct) res.setHeader('Content-Type', ct);

      // Forward content-length
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }

      // Forward content-range (pour le seeking vidéo)
      if (proxyRes.headers['content-range']) {
        res.setHeader('Content-Range', proxyRes.headers['content-range']);
      }

      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.status(statusCode);

      // Stream la réponse
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.status(500).json({ error: err.message });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({ error: 'Timeout du serveur distant' });
    });

    proxyReq.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};