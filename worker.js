// worker.js — Cloudflare Worker proxy for BuzzMusic
// HTTPS:  https://YOUR-WORKER.workers.dev/proxy/<file>
// Origin: http://97.119.213.15:3001/stream/<file>

const ORIGIN = 'http://97.119.213.15:3001';

export default {
  async fetch(req) {
    const url = new URL(req.url);

    // Preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    // Proxy route
    if (url.pathname.startsWith('/proxy/')) {
      const filePart = url.pathname.slice('/proxy/'.length); // still URL-encoded
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
      if (!h.has('Content-Type')) h.set('Content-Type', 'audio/mpeg'); // fallback if origin is vague
      // Strip hop-by-hop
      ['connection','transfer-encoding','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','upgrade']
        .forEach(x => h.delete(x));

      return new Response(resp.body, { status: resp.status, headers: h });
    }

    // Root/help
    return new Response('BuzzMusic proxy up. Use /proxy/<file>.', { status: 200, headers: cors() });
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
