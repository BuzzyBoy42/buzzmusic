// worker.js — Cloudflare Worker proxy + diagnostics
// Maps:
//   /audio/<file>  -> http://97.119.213.15:3001/stream/<file>
//   /_probe?file=… -> JSON probe against origin (Range 0-1)

const ORIGIN = 'http://97.119.213.15:3001'; // your home server

export default {
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    // Diagnostics probe
    if (url.pathname === '/_probe') {
      const file = (url.searchParams.get('file') || '').trim();
      if (!file) return json({ ok: false, error: 'missing ?file=' }, 400);
      const originUrl = new URL('/stream/' + encodeURIComponent(file), ORIGIN);
      try {
        const r = await fetch(originUrl, {
          method: 'GET',
          headers: { Range: 'bytes=0-1' }
        });
        const out = {
          ok: r.ok || r.status === 206,
          status: r.status,
          url: originUrl.toString(),
          headers: {
            'accept-ranges': r.headers.get('Accept-Ranges'),
            'content-range': r.headers.get('Content-Range'),
            'content-type' : r.headers.get('Content-Type'),
            'content-length': r.headers.get('Content-Length')
          }
        };
        return json(out, 200);
      } catch (e) {
        return json({ ok:false, error: String(e), url: originUrl.toString() }, 502);
      }
    }

    // Simple message for root
    if (url.pathname === '/' && req.method === 'GET') {
      return new Response('BuzzMusic proxy up. Use /audio/<file> or /_probe?file=<name>.', { status: 200, headers: cors() });
    }

    // Only handle /audio/* for streaming
    if (!url.pathname.startsWith('/audio/')) {
      return new Response('Use /audio/<file> or /_probe?file=<name>', { status: 404, headers: cors() });
    }

    // Map /audio/<file> -> /stream/<file> at origin
    const filePart = url.pathname.slice('/audio/'.length); // still URL-encoded
    const upstream = new URL('/stream/' + filePart + url.search, ORIGIN);

    // Forward headers (keep Range), drop hop-by-hop
    const fwd = new Headers(req.headers);
    ['host','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','content-length','accept-encoding']
      .forEach(h => fwd.delete(h));

    let resp;
    try {
      resp = await fetch(upstream, {
        method: req.method,
        headers: fwd,
        body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : req.body,
        redirect: 'manual'
      });
    } catch (e) {
      return new Response(`Upstream fetch failed: ${e.message}`, { status: 502, headers: cors() });
    }

    // Copy headers + add CORS + ensure audio semantics
    const h = new Headers(resp.headers);
    applyCors(h);
    if (!h.has('Accept-Ranges')) h.set('Accept-Ranges', 'bytes');
    if (!h.has('Content-Type')) h.set('Content-Type', 'audio/mpeg');
    // helpful debug passthrough
    h.set('x-origin-status', String(resp.status));
    h.set('x-origin-url', upstream.toString());

    // Strip hop-by-hop on response
    ['connection','transfer-encoding','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','upgrade']
      .forEach(x => h.delete(x));

    return new Response(resp.body, { status: resp.status, headers: h });
  }
};

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-Range, Content-Type',
    ...extra
  };
}
function applyCors(h) {
  const c = cors();
  for (const [k, v] of Object.entries(c)) h.set(k, v);
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json; charset=utf-8' }
  });
}
