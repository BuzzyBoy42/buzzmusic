// Cloudflare Worker: HTTPS proxy for your HTTP stream (97.119.213.15:3001)
// Route example:  https://your-subdomain.workers.dev/stream/<filename>
// or bind it to your own domain route in Cloudflare: https://music.yourdomain.com/stream/*

const ORIGIN_BASE = 'http://97.119.213.15:3001'; // your current stream origin (HTTP)

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // only proxy /stream/*
    if (!url.pathname.startsWith('/stream/')) {
      return new Response('OK: use /stream/<file>', { status: 200, headers: cors({}) });
    }

    // build origin URL: http://IP:3001/stream/<file...>
    const originUrl = new URL(url.pathname, ORIGIN_BASE);
    originUrl.search = url.search;

    // forward method + headers (including Range & If-Range)
    const fwdHeaders = new Headers(req.headers);
    // Remove hop-by-hop / forbidden headers
    ['host','cf-connecting-ip','x-forwarded-for','x-forwarded-proto','content-length','connection','accept-encoding']
      .forEach(h => fwdHeaders.delete(h));

    const init = {
      method: req.method,
      headers: fwdHeaders,
      // Don’t refetch compressed bytes; origin should send raw (good for ranges)
      cf: { cacheTtl: 0, cacheEverything: false },
      // For HEAD/GET only; no body for audio
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : req.body
    };

    let resp;
    try {
      resp = await fetch(originUrl.toString(), init);
    } catch (e) {
      return new Response(`Upstream fetch failed: ${e.message}`, { status: 502, headers: cors({}) });
    }

    // Clone headers, add CORS, ensure Accept-Ranges present
    const h = new Headers(resp.headers);
    const status = resp.status;

    // Some origins already set these; ensure they’re there for players
    if (!h.has('Accept-Ranges')) h.set('Accept-Ranges', 'bytes');
    // Avoid content sniffing issues
    if (!h.has('Content-Type')) h.set('Content-Type', 'audio/mpeg');

    // CORS for <audio> and any fetch-based tester
    applyCors(h);

    // Strip hop-by-hop
    ['connection','transfer-encoding','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','upgrade']
      .forEach(x => h.delete(x));

    // Stream back body; Range (206) & Content-Range are preserved from origin
    return new Response(resp.body, { status, headers: h });
  }
};

function cors(extra) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-Range, Content-Type',
    ...extra
  };
}
function applyCors(h) {
  const base = cors({});
  for (const [k,v] of Object.entries(base)) h.set(k, v);
}
