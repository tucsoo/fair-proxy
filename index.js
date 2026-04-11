const http = require('http');
const https = require('https');
const PORT = process.env.PORT || 3000;

const captured = [];

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', mode: 'forward-proxy', captured: captured.length }));
  }

  // Retrieve/clear captured webhooks
  if (req.url === '/captured') {
    if (req.method === 'DELETE') captured.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(req.method === 'DELETE' ? { cleared: true } : captured));
  }

  // Capture mode (webhook interception for inflate)
  if (req.url === '/capture') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        captured.push({ ts: Date.now(), data: JSON.parse(body) });
        if (captured.length > 50) captured.shift();
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ captured: true, total: captured.length }));
    });
    return;
  }

  // Forward mode: relay any method to X-Target-Url
  const targetUrl = req.headers['x-target-url'];
  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'X-Target-Url header required' }));
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const url = new URL(targetUrl);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    // Forward all headers except proxy-internal ones
    const fwdHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (['host', 'x-target-url', 'content-length', 'connection', 'transfer-encoding'].includes(lk)) continue;
      fwdHeaders[k] = v;
    }
    if (body) fwdHeaders['content-length'] = Buffer.byteLength(body);

    const proxyReq = mod.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method,
      headers: fwdHeaders,
    }, proxyRes => {
      let rb = '';
      proxyRes.on('data', c => rb += c);
      proxyRes.on('end', () => {
        // Forward all response headers back
        const rh = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) rh[k] = v;
        res.writeHead(proxyRes.statusCode, rh);
        res.end(rb);
      });
    });
    proxyReq.on('error', e => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); });
    proxyReq.setTimeout(15000, () => { proxyReq.destroy(); res.writeHead(504); res.end('timeout'); });
    if (body) proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, () => console.log(`Forward proxy :${PORT} | /health /capture /captured`));
