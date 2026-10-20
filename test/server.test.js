import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server.js';

const future = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
const body = { mode: 'plan', eventType: 'birthday', date: future, city: 'Lagos', guests: 40, budget: 900000, currency: 'NGN' };
const fakePlan = {
  title: 'Dino Dig', summary: 's',
  budget: [{ category: 'Food', amount: 500 }, { category: 'Cake', amount: 500 }],
  timeline: [{ weeksBefore: 2, task: 'Order cake' }],
  vendors: [{ vendor: 'Baker', why: 'cake', bookByWeeksBefore: 3, questions: ['?'] }],
  ideas: [], daySchedule: [{ time: '14:00', activity: 'Start' }],
};

let calls = 0;
const fetchImpl = async () => {
  calls++;
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(fakePlan) }] } }] });
};
const servers = [];
const start = (opts) => new Promise((resolve) => {
  const s = makeServer(opts).listen(0, () => resolve(`http://127.0.0.1:${s.address().port}`));
  servers.push(s);
});
const post = (base, payload) => fetch(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

let live, keyless;
before(async () => {
  live = await start({ apiKey: 'test', model: 'm', fetchImpl });
  keyless = await start({ apiKey: '' });
});
after(() => servers.forEach((s) => s.close()));

test('serves the app with security headers', async () => {
  const res = await fetch(`${live}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${live}/healthz`)).status, 200);
});

test('only the search-widget frame gets inline styles, and only we can frame it', async () => {
  const csp = (await fetch(`${live}/widget.html`)).headers.get('content-security-policy');
  assert.match(csp, /style-src 'unsafe-inline'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.doesNotMatch((await fetch(`${live}/`)).headers.get('content-security-policy'), /unsafe-inline/);
});

test('blocks path traversal and unknown files', async () => {
  assert.equal((await fetch(`${live}/%2e%2e%2fserver.js`)).status, 404);
  assert.equal((await fetch(`${live}/nope.js`)).status, 404);
});

test('rejects bad input, bad JSON, oversized bodies and wrong methods', async () => {
  assert.equal((await post(live, { ...body, guests: -1 })).status, 400);
  assert.equal((await post(live, '{not json')).status, 400);
  assert.equal((await post(live, { ...body, vibe: 'x'.repeat(40_000) })).status, 413);
  assert.equal((await fetch(`${live}/api/generate`)).status, 405);
});

test('returns 503 when no API key is configured', async () => {
  const res = await post(keyless, body);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /GEMINI_API_KEY/);
});

test('rate limit keys on the proxy-appended IP, so spoofed X-Forwarded-For cannot dodge it', async () => {
  const s = await start({ apiKey: '' });
  const hit = (i) => fetch(`${s}/api/generate`, { method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` }, body: '{}' });
  for (let i = 0; i < 30; i++) assert.equal((await hit(i)).status, 400);
  assert.equal((await hit(99)).status, 429);
});

test('generates a finalized plan and caches identical requests', async () => {
  const res = await post(live, body);
  assert.equal(res.status, 200);
  const plan = await res.json();
  assert.equal(plan.budget.reduce((s, b) => s + b.amount, 0), 900000);
  assert.match(plan.timeline[0].due, /^\d{4}-\d{2}-\d{2}$/);
  await post(live, body);
  assert.equal(calls, 1);
});
