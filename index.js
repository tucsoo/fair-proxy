const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const TARGET = process.env.TARGET || 'www.fair.lol';

const server = http.createServer((req, res) => {
  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', target: TARGET }));
    return;
  }

  // Proxy all other requests to api.fair.lol
  const targetPath = req.url;
  let body = '';

  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const headers = { ...req.headers };
    delete headers.host;
    headers.host = TARGET;

    if (body) {
      headers['content-length'] = Buffer.byteLength(body);
    }

    const proxyReq = https.request({
      hostname: TARGET,
      path: targetPath,
      method: req.method,
      headers: headers
    }, (proxyRes) => {
      // Forward all response headers
      const respHeaders = { ...proxyRes.headers };
      // Add CORS for our access
      respHeaders['access-control-allow-origin'] = '*';
      respHeaders['access-control-allow-headers'] = '*';
      respHeaders['access-control-allow-methods'] = '*';

      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy_error', message: e.message }));
    });

    proxyReq.setTimeout(15000, () => {
      proxyReq.destroy();
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'timeout' }));
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}, forwarding to ${TARGET}`);
});
