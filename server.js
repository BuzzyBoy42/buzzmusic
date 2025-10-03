// server.js — serves BuzzMusic and streams with proper byte-range support.
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const AUDIO_DIR  = path.join(__dirname, 'audio');   // put your .mp3/.m4a files here
const PUBLIC_DIR = path.join(__dirname, 'public');  // put index.html here

app.use(express.static(PUBLIC_DIR));

// Optional CORS (harmless same-origin; helpful if you later embed from elsewhere)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Byte-range streaming: /stream/<file>
app.get('/stream/:file', (req, res) => {
  const filePath = path.join(AUDIO_DIR, req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const stat  = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`BuzzMusic at http://localhost:${PORT}  |  Streams at /stream/<file>`)
);
