import { toIcs, gcalLink, mapsLink } from './calendar.js';
import { cascade } from './schedule.js';

const $ = (s) => document.querySelector(s);
const form = $('#plan-form');
const statusEl = $('#status');
const results = $('#results');
const STORE = 'rehearsal:v2';
const LANG = { English: 'en', Hindi: 'hi', Spanish: 'es', French: 'fr', Portuguese: 'pt', Arabic: 'ar', German: 'de', Japanese: 'ja', Swahili: 'sw', Tamil: 'ta' };
const PERSONA_LABELS = { elderly: 'Elderly', mobility: 'Wheelchair / mobility', kids: 'Kids under 5', dietary: 'Allergies & diets', sensory: 'Sensory-sensitive' };
const RATING = { green: 'Fine', amber: 'Watch', red: 'Problem' };

let state = null; // { input, plan, done, rehearsal, lens }

// --- tiny DOM helper: never uses innerHTML, so AI output can't inject markup ---
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(2).filter((c) => c != null && c !== false));
  return el;
}

// State can come from localStorage or a share link, so check its shape before rendering it.
const isPlanState = (s) =>
  s && typeof s.input === 'object' && /^[A-Z]{3}$/.test(s.input.currency ?? '') &&
  ['budget', 'timeline', 'vendors', 'ideas', 'daySchedule'].every((k) => Array.isArray(s.plan?.[k]));

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    return isPlanState(s) ? s : null;
  } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage full or blocked: plan still works this session */ }
}

const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: state.input.currency, maximumFractionDigits: 0 }).format(n);
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const isoToday = () => new Date().toLocaleDateString('en-CA');

function say(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

async function api(payload) {
  const res = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function run(btn, msg, fn) {
  btn.disabled = true;
  btn.classList.add('loading');
  results.setAttribute('aria-busy', 'true');
  say(msg);
  try {
    await fn();
    say('');
  } catch (e) {
    say(e.message || 'Something went wrong.', true);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    results.removeAttribute('aria-busy');
  }
}

// --- share links: whole plan gzipped into the URL hash, no database ---
const toB64url = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function pack(obj) {
  const gz = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  return toB64url(new Uint8Array(await new Response(gz).arrayBuffer()));
}
async function unpack(s) {
  const raw = new Blob([fromB64url(s)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(raw).text());
}

$('#share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#s=${await pack(state)}`;
  try {
    await navigator.clipboard.writeText(url);
    say('Share link copied. Anyone who opens it gets a copy of this plan, including ticked items.');
  } catch {
    history.replaceState(null, '', url);
    say('Copy the link from your address bar to share this plan.');
  }
});

// --- form ---
$('#date').min = isoToday();

const EXAMPLES = [
  { eventType: 'wedding', months: 7, city: 'Jaipur, India', venue: 'Samode Haveli', endBy: '23:30', guests: 180, budget: 2500000, currency: 'INR', vibe: 'Modern boho with marigolds, low waste', traditions: "Punjabi Hindu; mehndi and sangeet; the groom's family is vegetarian", constraints: 'Grandmother uses a wheelchair; many guests flying in from abroad' },
  { eventType: 'birthday', months: 2, city: 'Lagos, Nigeria', venue: '', endBy: '18:00', guests: 40, budget: 900000, currency: 'NGN', vibe: 'Dinosaur explorer party for a 7-year-old', traditions: 'Yoruba family; small-chops and jollof are a must', constraints: 'Power cuts are common; half the guests are under 10' },
  { eventType: 'community', months: 3, city: 'Toronto, Canada', venue: 'Trinity Bellwoods Park', endBy: '18:00', guests: 120, budget: 3000, currency: 'CAD', vibe: 'Neighbourhood park clean-up and potluck picnic', traditions: 'Very multicultural street; label every dish', constraints: 'Needs a city park permit; no alcohol' },
];
let exampleIdx = 0;
$('#example').addEventListener('click', () => {
  const ex = EXAMPLES[exampleIdx++ % EXAMPLES.length];
  const d = new Date();
  d.setMonth(d.getMonth() + ex.months);
  fill({ ...ex, date: d.toLocaleDateString('en-CA') });
  say(`Example loaded: ${ex.city}. Press "Draft my plan".`);
});

function fill(input) {
  for (const [k, v] of Object.entries(input)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el instanceof RadioNodeList) [...el].forEach((r) => (r.checked = r.value === v));
    else el.value = v;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = Object.fromEntries(new FormData(form));
  input.guests = Number(input.guests);
  input.budget = Number(input.budget);
  input.currency = input.currency.toUpperCase();
  run(form.querySelector('[type=submit]'), `Drafting your plan. Gemini is searching prices, vendors and customs in ${input.city}…`, async () => {
    const plan = await api({ mode: 'plan', ...input });
    state = { input, plan, done: {}, rehearsal: null, lens: null };
    save();
    render();
    select($('#t-overview'));
    $('#plan-title').focus();
  });
});

$('#print').addEventListener('click', () => window.print());
$('#reset').addEventListener('click', () => {
  state = null;
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  results.hidden = true;
  form.reset();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  form.elements.city.focus();
});

// --- tabs (WAI-ARIA pattern: arrows/Home/End move between tabs) ---
const tabs = [...document.querySelectorAll('[role=tab]')];
function select(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t));
  t.addEventListener('keydown', (e) => {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const n = tabs[(next + tabs.length) % tabs.length];
    n.focus();
    select(n);
  });
});

// --- rendering ---
function sourcesLine(list) {
  const safe = (list ?? []).filter((s) => typeof s?.uri === 'string' && s.uri.startsWith('https://'));
  if (!safe.length) return null;
  return h('p', { className: 'sources' }, 'Checked with Google Search: ',
    safe.map((s, i) => [i ? ' · ' : '', h('a', { href: s.uri, target: '_blank', rel: 'noopener noreferrer' }, s.title)]));
}

function render() {
  if (!state?.plan) return;
  const { input, plan } = state;
  results.hidden = false;
  results.lang = LANG[input.language] ?? 'en';
  results.dir = input.language === 'Arabic' ? 'rtl' : 'ltr';
  $('#plan-meta').textContent = [input.eventType, input.venue, input.city, fmtDate(input.date), `${input.guests} guests`, money(input.budget)].filter(Boolean).join(' · ');
  $('#plan-title').textContent = plan.title;
  $('#plan-summary').textContent = plan.summary;
  $('#plan-sources').replaceChildren(sourcesLine(plan.sources) ?? '');
  renderOverview();
  renderBudget();
  renderTimeline();
  renderVendors();
  renderChaos();
  renderRehearsal();
  renderLens();
}

function renderOverview() {
  const { plan } = state;
  $('#p-overview').replaceChildren(
    h('h3', {}, 'Signature moments'),
    h('div', { className: 'cards three' },
      plan.ideas.map((idea, i) =>
        h('article', { className: 'card idea' },
          h('span', { className: 'idea-num', ariaHidden: 'true' }, `0${i + 1}`),
          h('h4', {}, idea.name),
          h('p', {}, idea.description),
          h('span', { className: `badge ${idea.costTier}` }, `${idea.costTier} cost`),
        ),
      ),
    ),
    h('h3', {}, 'Run of show'),
    h('ol', { className: 'schedule' },
      plan.daySchedule.map((s) => h('li', {}, h('time', {}, s.time), h('span', {}, s.activity))),
    ),
  );
}

function renderBudget() {
  const out = h('div');
  const scale = h('input', { type: 'range', id: 'scale', min: 25, max: 150, step: 5, value: 100 });
  const readout = h('output', { htmlFor: 'scale' });
  const draw = () => {
    const f = Number(scale.value) / 100;
    const under = state.plan.budget.filter((b) => b.minimum > 0 && b.amount * f < b.minimum);
    readout.textContent = `${money(state.input.budget * f)} (${scale.value}%)`;
    out.replaceChildren(
      under.length
        ? h('p', { className: 'alert' }, `⚠ At this budget, ${under.map((b) => b.category).join(', ')} ${under.length > 1 ? 'fall' : 'falls'} below a realistic minimum for ${state.input.guests} guests. Change the format (for example, a sit-down dinner becomes high tea) instead of squeezing every line.`)
        : null,
      h('div', { className: 'bar', ariaHidden: 'true' },
        state.plan.budget.map((b, i) => {
          const seg = h('span', { className: `c${i % 8}`, title: b.category });
          seg.style.setProperty('flex-grow', b.amount);
          return seg;
        }),
      ),
      h('table', { className: 'table' },
        h('caption', { className: 'sr-only' }, 'Budget by category'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Category'), h('th', { scope: 'col', className: 'num' }, 'Amount'), h('th', { scope: 'col', className: 'num' }, 'Share'), h('th', { scope: 'col' }, 'Note'))),
        h('tbody', {},
          state.plan.budget.map((b, i) => {
            const low = under.includes(b);
            return h('tr', { className: low ? 'under' : '' },
              h('th', { scope: 'row' }, h('span', { className: `dot c${i % 8}`, ariaHidden: 'true' }), b.category),
              h('td', { className: 'num' }, money(b.amount * f), b.minimum > 0 && h('span', { className: 'floor' }, `${low ? 'below ' : ''}min ${money(b.minimum)}`)),
              h('td', { className: 'num' }, `${Math.round((b.amount / state.input.budget) * 100)}%`),
              h('td', { className: 'muted' }, b.note),
            );
          }),
        ),
      ),
    );
  };
  scale.addEventListener('input', draw);
  $('#p-budget').replaceChildren(
    h('div', { className: 'whatif card' },
      h('label', { htmlFor: 'scale' }, 'What if the budget changed?'),
      scale,
      readout,
      h('p', { className: 'fine' }, 'Lines scale together. Any line that drops below its realistic minimum turns red.'),
    ),
    out,
  );
  draw();
}

function checklist(items, prefix, labelOf, extra) {
  const done = () => items.filter((_, i) => state.done[`${prefix}${i}`]).length;
  const counter = h('p', { className: 'progress', ariaLive: 'polite' });
  const meter = h('progress', { max: items.length, ariaHidden: 'true' });
  const update = () => {
    counter.textContent = `${done()} of ${items.length} done`;
    meter.value = done();
  };
  const list = h('ul', { className: 'checklist' },
    items.map((item, i) => {
      const key = `${prefix}${i}`;
      const id = `chk-${key}`;
      return h('li', { className: 'card' },
        h('input', { type: 'checkbox', id, checked: !!state.done[key], onchange: (e) => { state.done[key] = e.target.checked; save(); update(); } }),
        h('div', {}, h('label', { htmlFor: id }, labelOf(item)), extra(item)),
      );
    }),
  );
  update();
  return [h('div', { className: 'progress-row' }, counter, meter), list];
}

function renderTimeline() {
  const { plan, input } = state;
  const today = isoToday();
  const events = plan.timeline.map((t) => ({ title: t.task, date: t.due, details: `${plan.title} (${input.city})` }));
  const ics = () => {
    const url = URL.createObjectURL(new Blob([toIcs([...events, { title: plan.title, date: input.date, details: 'The big day!' }])], { type: 'text/calendar' }));
    h('a', { href: url, download: 'rehearsal-timeline.ics' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('#p-timeline').replaceChildren(
    h('div', { className: 'toolbar' },
      h('h3', {}, 'Countdown'),
      h('button', { type: 'button', className: 'btn', onclick: ics }, 'Download .ics (Google / Apple / Outlook)'),
    ),
    ...checklist(plan.timeline, 't', (t) => t.task, (t) =>
      h('p', { className: 'meta' },
        h('time', { dateTime: t.due }, t.due <= today ? 'Do now' : fmtDate(t.due)),
        t.weeksBefore == null ? ' · added from Guest Lens · ' : ` · ${t.weeksBefore} weeks out · `,
        h('a', { href: gcalLink({ title: t.task, date: t.due, details: plan.title }), target: '_blank', rel: 'noopener' }, 'Add to Google Calendar'),
      ),
    ),
  );
}

function renderVendors() {
  const { plan, input } = state;
  $('#p-vendors').replaceChildren(
    h('h3', {}, 'Vendor checklist'),
    ...checklist(plan.vendors, 'v', (v) => [v.vendor, h('span', { className: 'sr-only' }, ' (booked)')], (v) =>
      h('div', {},
        h('p', { className: 'muted' }, v.why),
        h('p', { className: 'meta' }, `Book by ${fmtDate(v.bookBy)} · `,
          h('a', { href: mapsLink(`${v.vendor} in ${input.city}`), target: '_blank', rel: 'noopener' }, 'Search Google Maps')),
        h('details', {}, h('summary', {}, 'Ask before paying a deposit'), h('ul', {}, v.questions.map((q) => h('li', {}, q)))),
      ),
    ),
  );
}

// --- chaos test: client-side cascade, Gemini only for the rescue ---
const chaosSchedule = () => cascade(state.plan.daySchedule, Number($('#chaos-at').value), Number($('#chaos-delay').value), state.input.endBy);

function renderChaos() {
  const at = $('#chaos-at');
  at.replaceChildren(...state.plan.daySchedule.map((s, i) => h('option', { value: i }, `${s.time} ${s.activity}`.slice(0, 60))));
  at.value = String(Math.min(2, state.plan.daySchedule.length - 1));
  drawChaos();
}

function drawChaos() {
  const rows = chaosSchedule();
  const over = rows.filter((r) => r.over).length;
  const { endBy } = state.input;
  $('#chaos-out').replaceChildren(
    h('p', { className: over ? 'alert' : 'okay' },
      over ? `⚠ ${over} item${over > 1 ? 's' : ''} now run past your ${endBy} hard stop.`
        : endBy ? `✓ Still finishes before ${endBy}.` : 'Tip: add a "Must end by" time to the form to see what overruns.'),
    h('ol', { className: 'schedule chaos-list' },
      rows.map((r) => h('li', { className: r.over ? 'over' : r.shifted ? 'shifted' : '' },
        h('time', {}, r.time),
        h('span', {}, r.activity, r.over ? h('strong', { className: 'tag' }, 'overruns') : r.shifted ? h('span', { className: 'tag' }, `+${$('#chaos-delay').value} min`) : null),
      )),
    ),
  );
}
['#chaos-at', '#chaos-delay'].forEach((s) => $(s).addEventListener('change', drawChaos));

$('#rescue-btn').addEventListener('click', (e) => {
  const at = state.plan.daySchedule[Number($('#chaos-at').value)];
  const incident = `${$('#chaos-what').value} at ${at.time} (${at.activity}); the day is now running ${$('#chaos-delay').value} minutes late`;
  const schedule = chaosSchedule().map(({ time, activity }) => ({ time, activity }));
  run(e.currentTarget, 'Gemini is rescuing your day…', async () => {
    state.rehearsal = { ...(await api({ mode: 'rehearse', ...state.input, schedule, incident })), incident };
    save();
    renderRehearsal();
    $('#rehearse-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

function renderRehearsal() {
  const r = state.rehearsal;
  const out = $('#rehearse-out');
  if (!r) return out.replaceChildren();
  const ring = h('div', { className: 'score', role: 'img', ariaLabel: `Readiness score ${r.readinessScore} out of 100` },
    h('strong', {}, r.readinessScore), h('span', {}, '/100'));
  ring.style.setProperty('--score', r.readinessScore);
  const apply = () => {
    state.plan.daySchedule = r.recovery;
    save();
    renderOverview();
    renderChaos();
    say('Run of show updated. You can see it under "Ideas & day".');
  };
  out.replaceChildren(
    r.incident ? h('p', { className: 'alert' }, `Rescue plan for: ${r.incident}.`) : null,
    h('div', { className: 'verdict card' }, ring,
      h('div', {}, h('h4', {}, 'Verdict'), h('p', { className: 'lede' }, r.headline),
        h('h4', {}, 'Fix this week'), h('ol', {}, r.topFixes.map((f) => h('li', {}, f))),
        sourcesLine(r.sources))),
    h('ol', { className: 'moments' },
      r.moments.map((m) =>
        h('li', { className: `moment ${m.severity}` },
          h('div', { className: 'moment-time' }, h('time', {}, m.time), h('span', { className: `badge ${m.severity}` }, `${m.severity} risk`)),
          h('div', { className: 'card' },
            h('p', { className: 'scene' }, m.scene),
            h('p', {}, h('strong', {}, 'What breaks: '), m.risk),
            h('p', { className: 'fix' }, h('strong', {}, 'Fix: '), m.fix)),
        ),
      ),
    ),
    r.recovery?.length
      ? h('section', { className: 'card recovery' },
          h('div', { className: 'toolbar' }, h('h4', {}, 'Recommended run of show'), h('button', { type: 'button', className: 'btn', onclick: apply }, 'Apply to my plan')),
          h('ol', { className: 'schedule' }, r.recovery.map((s) => h('li', {}, h('time', {}, s.time), h('span', {}, s.activity)))))
      : null,
  );
}

function addTask(task) {
  state.plan.timeline.push({ task, due: isoToday(), weeksBefore: null });
  save();
  renderTimeline();
}

function renderLens() {
  const l = state.lens;
  const out = $('#lens-out');
  if (!l) return out.replaceChildren();
  const personas = Object.keys(PERSONA_LABELS);
  const detail = h('div', { className: 'cell-detail card', ariaLive: 'polite' },
    h('p', { className: 'muted' }, 'Select an amber or red cell to see the problem and the fix.'));
  const show = (stage, c) =>
    detail.replaceChildren(
      h('h4', {}, `${stage.stage} · ${PERSONA_LABELS[c.persona]}`),
      h('p', {}, c.issue),
      h('p', { className: 'fix' }, h('strong', {}, 'Fix: '), c.fix, c.cost > 0 ? ` (about ${money(c.cost)})` : ' (free)'),
      h('button', {
        type: 'button', className: 'btn',
        onclick: (e) => {
          addTask(`${c.fix} (${PERSONA_LABELS[c.persona]}, ${stage.stage})`);
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = 'Added to timeline ✓';
        },
      }, 'Add fix to timeline'),
    );
  out.replaceChildren(
    h('p', { className: 'lede' }, l.verdict),
    h('div', { className: 'heat-wrap' },
      h('table', { className: 'heat' },
        h('caption', { className: 'sr-only' }, 'Guest experience by stage and guest type'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Stage'), personas.map((p) => h('th', { scope: 'col' }, PERSONA_LABELS[p])))),
        h('tbody', {},
          l.stages.map((s) =>
            h('tr', {},
              h('th', { scope: 'row' }, h('time', {}, s.time), ' ', s.stage),
              personas.map((p) => {
                const c = s.cells.find((x) => x.persona === p);
                if (!c) return h('td', {}, '–');
                if (c.rating === 'green') return h('td', {}, h('span', { className: 'cell green' }, RATING.green));
                return h('td', {}, h('button', {
                  type: 'button', className: `cell ${c.rating}`, onclick: () => show(s, c),
                  ariaLabel: `${s.stage}, ${PERSONA_LABELS[p]}: ${RATING[c.rating]}. Show details`,
                }, RATING[c.rating]));
              }),
            ),
          ),
        ),
      ),
    ),
    detail,
  );
}

$('#rehearse-btn').addEventListener('click', (e) =>
  run(e.currentTarget, 'Rehearsing your day minute by minute…', async () => {
    state.rehearsal = await api({ mode: 'rehearse', ...state.input, schedule: state.plan.daySchedule });
    save();
    renderRehearsal();
  }),
);

$('#lens-btn').addEventListener('click', (e) =>
  run(e.currentTarget, 'Scoring every stage for five kinds of guests…', async () => {
    state.lens = await api({ mode: 'lens', ...state.input, schedule: state.plan.daySchedule });
    save();
    renderLens();
  }),
);

// --- startup: a share link wins over this browser's saved plan ---
if (location.hash.startsWith('#s=')) {
  try {
    const shared = await unpack(location.hash.slice(3));
    if (!isPlanState(shared)) throw new Error('bad shape');
    state = { done: {}, ...shared };
    save();
    say('Shared plan loaded. Changes you make are saved in this browser.');
  } catch {
    say('That share link is broken or incomplete.', true);
  }
  history.replaceState(null, '', location.pathname);
}
state ??= load();
if (state) {
  try {
    fill(state.input);
    render();
  } catch {
    state = null;
    results.hidden = true;
    say('Could not restore the saved plan, so please draft a new one.', true);
  }
}
