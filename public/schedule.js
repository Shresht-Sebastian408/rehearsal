// Chaos test: push a delay down the run of show and flag what overruns the hard stop.
// Shared by the browser and the tests.

export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const fmt = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Delay every slot from index `from` onwards by `delay` minutes.
 * Times that go backwards are treated as past midnight. Returns slots with
 * { time, activity, shifted, over } where `over` means it now ends after `endBy`.
 */
export function cascade(schedule, from, delay, endBy = '') {
  // ponytail: every later slot slips by the full delay; no per-slot buffers to absorb it.
  let prev = -1;
  let offset = 0;
  const abs = schedule.map((s) => {
    let t = toMin(s.time);
    if (t === null) return null;
    t += offset;
    if (t < prev) (offset += 1440), (t += 1440);
    prev = t;
    return t;
  });
  const start = abs.find((t) => t !== null) ?? 0;
  let stop = toMin(endBy);
  if (stop !== null && stop < start) stop += 1440;
  return schedule.map((s, i) => {
    if (abs[i] === null) return { ...s, shifted: false, over: false };
    const shifted = i >= from && delay > 0;
    const t = abs[i] + (shifted ? delay : 0);
    return { ...s, time: fmt(t), shifted, over: stop !== null && t > stop };
  });
}
