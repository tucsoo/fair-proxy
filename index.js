const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;

// Connect to api.fair.lol IP but present as www.fair.lol
const FASTLY_IP = '151.101.2.15';
const SNI_HOST = 'www.fair.lol';
const API_HOST = 'api.fair.lol';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', mode: 'sni-spoof', sni: SNI_HOST, ip: FASTLY_IP }));
    return;
  }

  // Test different modes via query param
  const url = new URL(req.url, `http://localhost`);
  const mode = url.searchParams.get('_mode') || 'www';

  let hostname, servername, hostHeader;
  if (mode === 'api') {
    // Direct to api.fair.lol
    hostname = API_HOST;
    servername = API_HOST;
    hostHeader = API_HOST;
  } else if (mode === 'ip-www') {
    // Connect to Fastly IP with SNI=www.fair.lol
    hostname = FASTLY_IP;
    servername = SNI_HOST;
    hostHeader = SNI_HOST;
  } else if (mode === 'ip-api') {
    // Connect to Fastly IP with SNI=api.fair.lol
    hostname = FASTLY_IP;
    servername = API_HOST;
    hostHeader = API_HOST;
  } else {
    // Default: connect to api.fair.lol DNS but with SNI=www.fair.lol
    hostname = API_HOST;
    servername = SNI_HOST;
    hostHeader = SNI_HOST;
  }

  const targetPath = req.url.replace(/[?&]_mode=[^&]+/, '').replace(/\?$/, '');
  let body = '';

  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const headers = { ...req.headers };
    delete headers.host;
    headers.host = hostHeader;

    if (body) {
      headers['content-length'] = Buffer.byteLength(body);
    }

    const proxyReq = https.request({
      hostname: hostname,
      servername: servername,
      path: targetPath,
      method: req.method,
      headers: headers,
      rejectUnauthorized: false // allow cert mismatch
    }, (proxyRes) => {
      const respHeaders = { ...proxyRes.headers };
      respHeaders['access-control-allow-origin'] = '*';
      respHeaders['access-control-allow-headers'] = '*';
      respHeaders['access-control-allow-methods'] = '*';
      respHeaders['x-proxy-mode'] = mode;
      respHeaders['x-proxy-host'] = hostHeader;
      respHeaders['x-proxy-sni'] = servername;

      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy_error', message: e.message, mode, hostname, servername }));
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
  console.log(`Proxy on :${PORT} | Modes: www (default), api, ip-www, ip-api`);
});
