const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { startFakeGmail } = require('./fake-gmail-server');

let fake;
let acc;
const EMAIL = 'test.user@example.com';

test.before(async () => {
  fake = await startFakeGmail();
  process.env.ROOST_GOOGLE_AUTH_URL = `${fake.url}/o/oauth2/v2/auth`;
  process.env.ROOST_GOOGLE_TOKEN_URL = `${fake.url}/token`;
  process.env.ROOST_CALENDAR_API_BASE = fake.url;
  process.env.ROOST_PLAIN_TOKENS = '1';
  delete require.cache[require.resolve('../src/gmail-api')];
  delete require.cache[require.resolve('../src/google-calendar')];
  const { GmailStore } = require('../src/gmail-api');
  const { CalendarAccount } = require('../src/google-calendar');
  const store = new GmailStore(path.join(os.tmpdir(), `roost-cal-test-${Date.now()}.json`), null);
  store.setClient('id.apps.googleusercontent.com', 'secret');
  acc = new CalendarAccount({ serviceId: 'cal1', store, deps: { openExternal: (u) => { fetch(u).catch(() => {}); } } });
});
test.after(async () => { acc.dispose(); await fake.close(); });

test('signs in with the calendar scope and gets the email', async () => {
  const reminders = [];
  acc.on('reminder', (r) => reminders.push(r));
  const r = await acc.signIn();
  assert.strictEqual(r.email, EMAIL);
  assert.strictEqual(fake.state.lastAuthRequest.scope, 'https://www.googleapis.com/auth/calendar');
  await new Promise((res) => setTimeout(res, 800));
  assert.ok(reminders.some((x) => x.id === 'ev_soon'), `reminder for event starting in 7 min: ${JSON.stringify(reminders)}`);
  assert.ok(!reminders.some((x) => x.id === 'ev_offsite'), 'no reminders for all-day events');
});

test('lists calendars', async () => {
  const { calendars } = await acc.listCalendars();
  assert.deepStrictEqual(calendars.map((c) => [c.summary, c.accessRole, c.primary]), [[EMAIL, 'owner', true], ['Team', 'writer', false], ['Holidays', 'reader', false]]);
});

test('lists events across calendars: timed, overlapping, all-day, recurring; skips cancelled', async () => {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 14);
  const { events } = await acc.listEvents({ timeMin: from.toISOString(), timeMax: to.toISOString() });
  const by = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.ok(by.ev_standup && by.ev_review, 'overlapping events from two calendars');
  assert.strictEqual(by.ev_standup.hangoutLink, 'https://meet.google.com/abc-defg-hij');
  assert.strictEqual(by.ev_review.color, '#33b679');
  assert.strictEqual(by.ev_offsite.allDay, true);
  assert.strictEqual(by.ev_offsite.endMs - by.ev_offsite.startMs, 2 * 86400000);
  assert.strictEqual(by.ev_lunch.selfResponse, 'needsAction');
  assert.strictEqual(by.ev_lunch.canEdit, false, 'invite from someone else is not editable');
  assert.strictEqual(by.ev_standup.canEdit, true);
  assert.strictEqual(by.ev_holiday.canEdit, false, 'reader calendar');
  assert.ok(events.some((e) => e.recurringEventId === 'ev_weekly'));
  assert.strictEqual(events.find((e) => e.recurringEventId === 'ev_weekly').color, '#f6bf26', 'event colorId wins');
  assert.ok(!by.ev_cancelled);
  for (let i = 1; i < events.length; i++) assert.ok(events[i - 1].startMs <= events[i].startMs, 'sorted');
});

test('creates a timed event with guests and a Meet link, then edits and deletes it', async () => {
  const s = new Date(); s.setDate(s.getDate() + 2); s.setHours(9, 0, 0, 0);
  const e = new Date(s.getTime() + 3600000);
  const { event } = await acc.createEvent({ calendarId: EMAIL, summary: 'Plan', start: s.toISOString(), end: e.toISOString(), attendees: ['x@example.com'], addMeet: true });
  assert.strictEqual(event.summary, 'Plan');
  assert.ok(event.hangoutLink);
  const ins = fake.state.calendar.log.find((l) => l.op === 'insert' && l.id === event.id);
  assert.strictEqual(ins.sendUpdates, 'all');
  assert.ok(ins.body.conferenceData.createRequest.requestId);
  const up = await acc.updateEvent({ calendarId: EMAIL, id: event.id, summary: 'Plan v2', location: 'HQ' });
  assert.strictEqual(up.event.summary, 'Plan v2');
  assert.strictEqual(up.event.location, 'HQ');
  await acc.deleteEvent({ calendarId: EMAIL, id: event.id });
  assert.ok(!fake.state.calendar.events[EMAIL].some((x) => x.id === event.id));
});

test('creates an all-day event with an exclusive end date', async () => {
  const { event } = await acc.createEvent({ calendarId: 'team@group.calendar.google.com', summary: 'Trip', allDay: true, start: '2026-12-01', end: '2026-12-04' });
  assert.deepStrictEqual([event.allDay, event.start, event.end], [true, '2026-12-01', '2026-12-04']);
  const body = fake.state.calendar.log.find((l) => l.id === event.id).body;
  assert.deepStrictEqual(body.start, { date: '2026-12-01' });
});

test('switches an event between timed and all-day', async () => {
  const { event } = await acc.updateEvent({ calendarId: EMAIL, id: 'ev_standup', allDay: true, start: '2026-11-10', end: '2026-11-11' });
  assert.strictEqual(event.allDay, true);
  const back = await acc.updateEvent({ calendarId: EMAIL, id: 'ev_standup', allDay: false, start: '2026-11-10T10:00:00Z', end: '2026-11-10T11:00:00Z' });
  assert.strictEqual(back.event.allDay, false);
});

test('answers an invite', async () => {
  const { event } = await acc.respond({ calendarId: EMAIL, id: 'ev_lunch', response: 'accepted' });
  assert.strictEqual(event.selfResponse, 'accepted');
  assert.strictEqual(fake.state.calendar.log.at(-1).sendUpdates, 'all');
});

test('validates input', async () => {
  await assert.rejects(acc.createEvent({ calendarId: EMAIL, summary: 'x', start: '2026-11-10T11:00:00Z', end: '2026-11-10T10:00:00Z' }), /end must be after/);
  await assert.rejects(acc.createEvent({ calendarId: EMAIL, summary: 'x', start: '2026-11-10T10:00:00Z', end: '2026-11-10T11:00:00Z', attendees: 'not-an-email' }), /not an email/);
  await assert.rejects(acc.createEvent({ calendarId: 'holidays@group.v.calendar.google.com', summary: 'x', start: '2026-11-10T10:00:00Z', end: '2026-11-10T11:00:00Z' }), /Forbidden/);
});

test('reports a turned-off Calendar API clearly', async () => {
  fake.state.calendar.disabled = true;
  await assert.rejects(acc.listCalendars(), (err) => err.apiDisabled === true && /Calendar API is not turned on/.test(err.message));
  fake.state.calendar.disabled = false;
});

test('refreshes an expired access token', async () => {
  fake.state.expireAll();
  const { calendars } = await acc.listCalendars();
  assert.strictEqual(calendars.length, 3);
});
