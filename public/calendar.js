// Google Calendar / Maps links and .ics export. Shared by the browser and the tests.

const ymd = (iso) => iso.replaceAll('-', '');
export function nextDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const esc = (s) => String(s).replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');

/** All-day events [{ title, date: 'YYYY-MM-DD', details }] -> iCalendar text. */
export function toIcs(events, stamp = new Date()) {
  // ponytail: no 75-octet line folding; Google/Apple/Outlook all accept long lines.
  const dt = `${stamp.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rehearsal//AI Event Planner//EN', 'CALSCALE:GREGORIAN'];
  events.forEach((e, i) =>
    lines.push(
      'BEGIN:VEVENT',
      `UID:${dt}-${i}@rehearsal`,
      `DTSTAMP:${dt}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.details ?? '')}`,
      'END:VEVENT',
    ),
  );
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export function gcalLink({ title, date, details = '' }) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${ymd(date)}/${ymd(nextDay(date))}`, details });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export const mapsLink = (query) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
