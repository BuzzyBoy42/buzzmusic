// Cloudflare Worker: HTTPS proxy to your home stream (97.119.213.15:3001)
// - /audio/<file>  → http://97.119.213.15:3001/stream/<file>
// - /stream/<file> → http://97.119.213.15:3001/stream/<file> (passthrough)

const ORIGIN = 'http://97.119.213.15:3001'; // your home server

export default {
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    // Only handle audio/stream paths
    if (!(url.pathname.startsWith('/audio/') || url.pathname.startsWith('/stream/'))) {
      return new Response('Use /audio/<file> or /stream/<file>', { status: 200, headers: cors() });
    }

    // Map /audio/* to upstream /stream/*; /stream/* passthrough
    const upstreamPath = url.pathname.startsWith('/audio/')
      ? '/stream/' + url.pathname.slice('/audio/'.length)
      : url.pathname;

    const upstreamURL = new URL(upstreamPath + url.search, ORIGIN);

    // Forward headers (keep Range/If-Range), drop hop-by-hop
    const fwd = new Headers(req.headers);
    ['host','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','content-length','accept-encoding']
      .forEach(h => fwd.delete(h));

    let upstreamResp;
    try {
      upstreamResp = await fetch(upstreamURL, {
        method: req.method,
        headers: fwd,
        body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : req.body,
        redirect: 'manual'
      });
    } catch (e) {
      return new Response(`Upstream fetch failed: ${e.message}`, { status: 502, headers: cors() });
    }

    // Copy headers, add CORS, ensure Range capability
    const h = new Headers(upstreamResp.headers);
    applyCors(h);
    if (!h.has('Accept-Ranges')) h.set('Accept-Ranges', 'bytes');
    if (!h.has('Content-Type')) h.set('Content-Type', 'audio/mpeg');
    // Optional: discourage caches if you’re frequently changing files
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');

    // Strip hop-by-hop on response too
    ['connection','transfer-encoding','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','upgrade']
      .forEach(x => h.delete(x));

    return new Response(upstreamResp.body, { status: upstreamResp.status, headers: h });
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
