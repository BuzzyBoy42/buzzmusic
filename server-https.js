// server-https.js — HTTPS BuzzMusic + byte-range audio streaming
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');

const app = express();

// --- Paths (adjust if you move files) ---
const ROOT       = __dirname;
const INDEX_FILE = path.join(ROOT, 'index.html'); // this file from above
const AUDIO_DIR  = path.join(ROOT, 'audio');      // put your .mp3/.m4a here

// --- Ports (use 8443/8080 for local without sudo, 443/80 in prod) ---
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const HTTP_PORT  = Number(process.env.HTTP_PORT  || 8080);

// --- TLS certs ---
// For production (Let's Encrypt):
//   export SSL_CERT_FILE=/etc/letsencrypt/live/your.domain/fullchain.pem
//   export SSL_KEY_FILE=/etc/letsencrypt/live/your.domain/privkey.pem
// For local dev (mkcert):
//   mkcert -install && mkcert localhost
//   export SSL_CERT_FILE=./localhost.pem
//   export SSL_KEY_FILE=./localhost-key.pem
const SSL_CERT_FILE = process.env.SSL_CERT_FILE || './localhost.pem';
const SSL_KEY_FILE  = process.env.SSL_KEY_FILE  || './localhost-key.pem';
if (!fs.existsSync(SSL_CERT_FILE) || !fs.existsSync(SSL_KEY_FILE)) {
  console.error('TLS cert/key not found. Set SSL_CERT_FILE and SSL_KEY_FILE env vars, or generate with mkcert.');
  process.exit(1);
}

// --- Serve the single HTML file ---
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  fs.createReadStream(INDEX_FILE).pipe(res);
});

// --- Optional: serve other static assets relative to root (favicon, images) ---
app.use(express.static(ROOT));

// --- CORS (harmless same-origin; helpful if you ever embed elsewhere) ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// --- Byte-range streaming at /stream/<file> ---
app.get('/stream/:file', (req, res) => {
  const filePath = path.join(AUDIO_DIR, req.params.file);
  if (!filePath.startsWith(AUDIO_DIR)) return res.status(400).end(); // path escape guard
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const stat  = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;

  // Basic content-type mapping
  const mime =
    filePath.endsWith('.mp3') ? 'audio/mpeg' :
    filePath.endsWith('.m4a') ? 'audio/mp4'  :
    filePath.endsWith('.aac') ? 'audio/aac'  :
    filePath.endsWith('.wav') ? 'audio/wav'  :
    'application/octet-stream';

  if (!range) {
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': total,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const [s, e] = range.replace(/bytes=/, '').split('-');
  const start = parseInt(s, 10);
  const end   = e ? parseInt(e, 10) : total - 1;

  if (isNaN(start) || isNaN(end) || start > end || end >= total) {
    return res.status(416).set('Content-Range', `bytes */${total}`).end();
  }

  res.writeHead(206, {
    'Content-Type': mime,
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': (end - start + 1)
  });

  fs.createReadStream(filePath, { start, end }).pipe(res);
});

// --- HTTPS server + HTTP -> HTTPS redirect ---
const tlsOptions = {
  key:  fs.readFileSync(SSL_KEY_FILE),
  cert: fs.readFileSync(SSL_CERT_FILE)
};
https.createServer(tlsOptions, app).listen(HTTPS_PORT, () => {
  console.log(`BuzzMusic: https://localhost:${HTTPS_PORT}/`);
});
http.createServer((req, res) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  res.writeHead(301, { Location: `https://${host}${HTTPS_PORT===443?'':':'+HTTPS_PORT}${req.url}` });
  res.end();
}).listen(HTTP_PORT, () => {
  console.log(`HTTP redirect :${HTTP_PORT} → HTTPS :${HTTPS_PORT}`);
});
