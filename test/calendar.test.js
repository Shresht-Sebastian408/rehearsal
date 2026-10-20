import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIcs, gcalLink, mapsLink, nextDay } from '../public/calendar.js';

test('nextDay rolls over months and leap years', () => {
  assert.equal(nextDay('2027-01-31'), '2027-02-01');
  assert.equal(nextDay('2028-02-28'), '2028-02-29');
});

test('toIcs builds valid all-day events with escaped text', () => {
  const ics = toIcs([{ title: 'Book DJ, caterer; florist', date: '2027-03-05', details: 'line1\nline2' }], new Date('2026-10-20T00:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /DTSTART;VALUE=DATE:20270305\r\nDTEND;VALUE=DATE:20270306/);
  assert.match(ics, /SUMMARY:Book DJ\\, caterer\\; florist/);
  assert.match(ics, /DESCRIPTION:line1\\nline2/);
});

test('Google Calendar and Maps links encode their inputs', () => {
  const url = new URL(gcalLink({ title: 'Cake & tasting', date: '2027-03-05' }));
  assert.equal(url.hostname, 'calendar.google.com');
  assert.equal(url.searchParams.get('text'), 'Cake & tasting');
  assert.equal(url.searchParams.get('dates'), '20270305/20270306');
  assert.equal(new URL(mapsLink('Florist in São Paulo')).searchParams.get('query'), 'Florist in São Paulo');
});
