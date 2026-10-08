'use strict';
// Minimal HTTP layer (no framework): routing, JSON bodies, cookies, security headers, static files.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i <= 0) return;
    try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) { /* ignore bad cookie */ }
  });
  return out;
}

function createApp({ publicDir, maxBody = 12 * 1024 * 1024 } = {}) {
  const routes = [];
  const statics = new Map();
  const add = (method) => (pattern, ...handlers) => routes.push({ method, parts: pattern.split('/').filter(Boolean), handlers });
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'), routes };

  function loadStatic() {
    statics.clear();
    if (!publicDir || !fs.existsSync(publicDir)) return;
    for (const name of fs.readdirSync(publicDir)) {
      const ext = path.extname(name).toLowerCase();
      if (!MIME[ext]) continue;
      const buf = fs.readFileSync(path.join(publicDir, name));
      const gz = ['.html', '.js', '.css', '.svg', '.json'].includes(ext) ? zlib.gzipSync(buf) : null;
      statics.set('/' + name, { buf, gz, type: MIME[ext], etag: '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"' });
    }
  }
  loadStatic();

  function match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    for (const r of routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i];
        if (p[0] === ':') params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (ok) return { r, params };
    }
    return null;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > maxBody) { reject(new HttpError(413, 'फ़ाइल/डेटा बहुत बड़ा है')); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function decorate(req, res) {
    res.json = (data, status = 200) => {
      const body = JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };
    res.send = (data, type = 'text/plain; charset=utf-8', status = 200, headers = {}) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, ...headers });
      res.end(buf);
    };
    res.cookie = (name, value, o = {}) => {
      let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
      if (o.maxAge != null) c += `; Max-Age=${Math.floor(o.maxAge)}`;
      if (o.secure) c += '; Secure';
      const prev = res.getHeader('Set-Cookie');
      res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
    };
  }

  async function handle(req, res) {
    decorate(req, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    req.secure = (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      req.query = Object.fromEntries(url.searchParams);
      req.cookies = parseCookies(req.headers.cookie);
      // behind Render's proxy the LAST X-Forwarded-For entry is the one the proxy itself appended (earlier ones can be forged)
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
      req.ip = xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || '';

      if (pathname === '/api' || pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
          if (req.headers['x-requested-with'] !== 'sts') throw new HttpError(403, 'अमान्य अनुरोध');
          const o = req.headers.origin;
          if (o) {
            let host = '';
            try { host = new URL(o).host; } catch (_) { /* invalid */ }
            if (host !== req.headers.host) throw new HttpError(403, 'अमान्य origin');
          }
        }
        req.body = {};
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          const raw = await readBody(req);
          if (raw.length) {
            try { req.body = JSON.parse(raw.toString('utf8')); } catch (_) { throw new HttpError(400, 'JSON गलत है'); }
          }
        }
        const m = match(req.method === 'HEAD' ? 'GET' : req.method, pathname);
        if (!m) throw new HttpError(404, 'API नहीं मिली');
        req.params = m.params;
        for (const h of m.r.handlers) {
          await h(req, res);
          if (res.writableEnded) return;
        }
        if (!res.writableEnded) res.json({ ok: true });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      if (pathname === '/healthz') {
        if (app.health) await app.health();
        return res.send('ok');
      }
      let f = statics.get(pathname);
      const isAsset = !!f && pathname !== '/index.html';
      if (!f) f = statics.get('/index.html'); // SPA fallback (/login, /admin/..., etc.)
      if (!f) throw new HttpError(404, 'Not found');
      const headers = { ETag: f.etag, 'Cache-Control': isAsset ? 'no-cache' : 'no-cache', Vary: 'Accept-Encoding' };
      if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); return res.end(); }
      const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      if (gz) headers['Content-Encoding'] = 'gzip';
      res.send(req.method === 'HEAD' ? '' : gz ? f.gz : f.buf, f.type, 200, headers);
    } catch (e) {
      let status = e.status || 500;
      let msg = e.message;
      if (e instanceof URIError) { status = 400; msg = 'URL गलत है'; }
      if (e.code === '23505') { status = 409; msg = 'यह रिकॉर्ड पहले से मौजूद है'; }
      else if (e.code === '23503') { status = 409; msg = 'यह रिकॉर्ड किसी और डेटा से जुड़ा है'; }
      else if (status >= 500) { console.error('[error]', req.method, req.url, e); msg = 'सर्वर में समस्या आई, कृपया दोबारा प्रयास करें'; }
      if (!res.headersSent) {
        if (req.url.startsWith('/api')) res.json({ error: msg }, status);
        else res.send(msg, 'text/plain; charset=utf-8', status);
      } else res.end();
    }
  }

  app.listen = (port, host = '0.0.0.0') => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((e) => { console.error('[fatal]', e); try { res.end(); } catch (_) { /* ignore */ } });
    });
    server.keepAliveTimeout = 65000;
    return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
  };
  app.reloadStatic = loadStatic;
  return app;
}

module.exports = { createApp, HttpError };
