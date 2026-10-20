import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cascade, toMin } from '../public/schedule.js';

const day = [
  { time: '16:00', activity: 'Baraat' },
  { time: '18:00', activity: 'Pheras' },
  { time: '20:00', activity: 'Dinner' },
  { time: '23:00', activity: 'Farewell' },
];

test('toMin parses HH:MM and rejects junk', () => {
  assert.equal(toMin('09:30'), 570);
  assert.equal(toMin('soon'), null);
});

test('cascade shifts everything from the incident onwards and flags overruns', () => {
  const out = cascade(day, 1, 60, '23:30');
  assert.deepEqual(out.map((s) => s.time), ['16:00', '19:00', '21:00', '00:00']);
  assert.deepEqual(out.map((s) => s.shifted), [false, true, true, true]);
  assert.deepEqual(out.map((s) => s.over), [false, false, false, true]);
});

test('cascade handles events that already run past midnight', () => {
  const late = [...day, { time: '00:30', activity: 'Clean-up' }];
  const out = cascade(late, 4, 30, '01:00');
  assert.equal(out[4].time, '01:00');
  assert.equal(out[4].over, false);
  assert.equal(cascade(late, 4, 45, '01:00')[4].over, true);
});

test('cascade with no hard stop never flags overruns', () => {
  assert.ok(cascade(day, 0, 90).every((s) => !s.over && s.shifted));
});
