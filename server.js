// Zero-dependency HTTP server: static files + one JSON API backed by Gemini.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, buildPrompt, callGemini, finalize } from './lib/planner.js';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};
const RATE = { max: 30, windowMs: 10 * 60_000 };
const CACHE_MAX = 200;

const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, ...(isJson && { 'content-type': 'application/json' }), ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req, limit = 32_768) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpError(413, 'Request too large.');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'Invalid JSON.');
  }
}

async function serveStatic(pathname, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    throw httpError(400, 'Bad path.');
  }
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) throw httpError(404, 'Not found.');
  const body = await readFile(file).catch(() => null);
  if (!body) throw httpError(404, 'Not found.');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  send(res, 200, body, { 'content-type': type, 'cache-control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=600' });
}

export function makeServer({ apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || 'gemini-3.6-flash', fetchImpl = fetch } = {}) {
  // ponytail: in-memory cache + rate limit are per instance; move to Memorystore if Cloud Run scales past one instance.
  const cache = new Map();
  const hits = new Map();

  function limited(ip) {
    const now = Date.now();
    if (hits.size > 10_000) hits.clear();
    const h = hits.get(ip);
    if (!h || now > h.reset) return hits.set(ip, { count: 1, reset: now + RATE.windowMs }), false;
    return ++h.count > RATE.max;
  }

  async function generate(req, res) {
    // Cloud Run's front end appends the real client IP last; earlier entries are client-controlled and spoofable.
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',').at(-1).trim();
    if (limited(ip)) throw httpError(429, 'Too many requests. Please wait a few minutes.');
    const { errors, value } = validate(await readJson(req));
    if (errors.length) throw httpError(400, `Please check: ${errors.join(', ')}.`);
    if (!apiKey) throw httpError(503, 'The AI planner is not configured (missing GEMINI_API_KEY).');

    const key = JSON.stringify(value);
    if (!cache.has(key)) {
      let data;
      try {
        data = finalize(value.mode, await callGemini(buildPrompt(value), { apiKey, model, fetchImpl, grounded: value.mode !== 'lens' }), value);
      } catch (e) {
        console.error('gemini_error', e.message);
        throw httpError(502, 'The AI planner is busy right now. Please try again in a moment.');
      }
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, data);
    }
    send(res, 200, cache.get(key));
  }

  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/healthz') return send(res, 200, { ok: true });
      if (pathname === '/api/generate') {
        if (req.method !== 'POST') throw httpError(405, 'Use POST.');
        return await generate(req, res);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Method not allowed.');
      await serveStatic(pathname, res);
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status ?? 500, { error: e.status ? e.message : 'Something went wrong.' });
    }
  });
}

if (process.argv[1] && normalize(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  makeServer().listen(port, () => console.log(`Rehearsal listening on http://localhost:${port}`));
}
