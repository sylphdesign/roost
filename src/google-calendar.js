// Google Calendar inside Roost, through Google's official Calendar API.
// Uses the same Google key and sign-in flow as Gmail (see gmail-api.js: GoogleAccount).
const crypto = require('crypto');
const { GoogleAccount, ApiError, mapLimit } = require('./gmail-api');

const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar';
const CAL_BASE = process.env.ROOST_CALENDAR_API_BASE || 'https://www.googleapis.com';
const REMIND_BEFORE_MS = 10 * 60 * 1000;
const POLL_MS = Number(process.env.ROOST_CALENDAR_POLL_MS || 5 * 60 * 1000);
const LOOKAHEAD_MS = 2 * 60 * 60 * 1000;

// Google's event colors (colorId 1–11).
const EVENT_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};

const enc = encodeURIComponent;
const isDateOnly = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// "2026-11-06" -> local midnight in ms (all-day events are dates, not instants).
function localDateMs(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).getTime();
}

function toEvent(e, cal) {
  const allDay = !!(e.start && e.start.date);
  const start = allDay ? e.start.date : e.start && e.start.dateTime;
  const end = allDay ? e.end && e.end.date : e.end && e.end.dateTime;
  const attendees = (e.attendees || []).map((a) => ({
    email: a.email, displayName: a.displayName || '', responseStatus: a.responseStatus || 'needsAction', self: !!a.self, organizer: !!a.organizer,
  }));
  const self = attendees.find((a) => a.self);
  const role = cal.accessRole;
  return {
    id: e.id,
    calendarId: cal.id,
    summary: e.summary || '',
    description: e.description || '',
    location: e.location || '',
    allDay,
    start,
    end,
    startMs: allDay ? localDateMs(start) : Date.parse(start),
    endMs: allDay ? localDateMs(end || start) : Date.parse(end || start),
    color: EVENT_COLORS[e.colorId] || cal.backgroundColor || '#7c6cff',
    htmlLink: e.htmlLink || '',
    hangoutLink: e.hangoutLink || ((e.conferenceData && e.conferenceData.entryPoints) || []).find((p) => p.entryPointType === 'video')?.uri || null,
    attendees,
    organizer: { email: e.organizer?.email || '', displayName: e.organizer?.displayName || '', self: !!e.organizer?.self },
    status: e.status || 'confirmed',
    recurringEventId: e.recurringEventId || null,
    canEdit: (role === 'owner' || role === 'writer') && (!!e.organizer?.self || e.guestsCanModify === true || !e.organizer || attendees.length === 0),
    selfResponse: self ? self.responseStatus : null,
  };
}

// Build the Google event body from the screen's simple fields.
function eventBody({ summary, description, location, allDay, start, end, attendees }, { forCreate = false, addMeet = false } = {}) {
  const body = {};
  if (summary !== undefined) body.summary = String(summary || '');
  if (description !== undefined) body.description = String(description || '');
  if (location !== undefined) body.location = String(location || '');
  if (start !== undefined || end !== undefined) {
    if (allDay) {
      if (!isDateOnly(start) || !isDateOnly(end)) throw new ApiError('All-day events need dates like 2026-11-06.');
      if (end <= start) throw new ApiError('The end must be after the start.');
      body.start = { date: start, dateTime: null };
      body.end = { date: end, dateTime: null };
    } else {
      const s = Date.parse(start);
      const en = Date.parse(end);
      if (!Number.isFinite(s) || !Number.isFinite(en)) throw new ApiError('Please give a start and end time.');
      if (en <= s) throw new ApiError('The end must be after the start.');
      body.start = { dateTime: new Date(s).toISOString(), date: null };
      body.end = { dateTime: new Date(en).toISOString(), date: null };
    }
    if (forCreate) { // Google rejects explicit nulls on insert
      for (const k of ['start', 'end']) for (const f of ['date', 'dateTime']) if (body[k][f] === null) delete body[k][f];
    }
  }
  if (attendees !== undefined) {
    const list = (Array.isArray(attendees) ? attendees : String(attendees || '').split(','))
      .map((a) => String(a).trim()).filter(Boolean);
    const bad = list.find((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (bad) throw new ApiError(`"${bad}" is not an email address.`);
    body.attendees = list.map((email) => ({ email }));
  }
  if (forCreate && addMeet) {
    body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return body;
}

class CalendarAccount extends GoogleAccount {
  constructor(opts) {
    super({ ...opts, scope: CAL_SCOPE, apiBase: CAL_BASE });
    this.apiDisabledText = 'The Google Calendar API is not turned on for your Google key. Turn it on in Google Cloud, then try again.';
    this.calendars = null; // cache: id -> calendar
    this.reminderTimers = new Map();
    this.reminded = new Set();
    this.pollTimer = null;
  }

  async fetchEmail() {
    const c = await this.api('GET', '/calendar/v3/users/me/calendarList/primary');
    return c.id;
  }

  async listCalendars() {
    const items = [];
    let pageToken;
    for (let i = 0; i < 5; i++) {
      const r = await this.api('GET', '/calendar/v3/users/me/calendarList', { query: { maxResults: 250, pageToken } });
      items.push(...(r.items || []));
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
    this.calendars = new Map(items.map((c) => [c.id, c]));
    return {
      calendars: items.filter((c) => !c.deleted && !c.hidden).map((c) => ({
        id: c.id, summary: c.summaryOverride || c.summary || c.id, primary: !!c.primary,
        backgroundColor: c.backgroundColor || '#7c6cff', foregroundColor: c.foregroundColor || '#ffffff',
        accessRole: c.accessRole, selected: c.selected !== false,
      })),
    };
  }

  async calendar(id) {
    if (!this.calendars || !this.calendars.has(id)) await this.listCalendars();
    const c = this.calendars.get(id);
    if (!c) throw new ApiError('That calendar was not found.');
    return c;
  }

  async listEvents({ timeMin, timeMax, calendarIds } = {}) {
    if (!timeMin || !timeMax) throw new ApiError('Missing time range.');
    if (!this.calendars) await this.listCalendars();
    const ids = (Array.isArray(calendarIds) && calendarIds.length ? calendarIds : [...this.calendars.values()].filter((c) => c.selected !== false).map((c) => c.id)).slice(0, 25);
    const lists = await mapLimit(ids, 5, async (id) => {
      const cal = this.calendars.get(id);
      if (!cal) return [];
      const out = [];
      let pageToken;
      for (let i = 0; i < 5; i++) {
        const r = await this.api('GET', `/calendar/v3/calendars/${enc(id)}/events`, {
          query: { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: 2500, pageToken },
        }).catch((err) => { if (err.status === 404) return { items: [] }; throw err; });
        out.push(...(r.items || []).filter((e) => e.status !== 'cancelled').map((e) => toEvent(e, cal)));
        pageToken = r.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    });
    return { events: lists.flat().sort((a, b) => a.startMs - b.startMs) };
  }

  async createEvent(args = {}) {
    const cal = await this.calendar(args.calendarId || 'primary');
    const body = eventBody(args, { forCreate: true, addMeet: !!args.addMeet });
    const e = await this.api('POST', `/calendar/v3/calendars/${enc(cal.id)}/events`, {
      query: { conferenceDataVersion: args.addMeet ? 1 : undefined, sendUpdates: body.attendees && body.attendees.length ? 'all' : 'none' },
      body,
    });
    this.emit('changed');
    return { event: toEvent(e, cal) };
  }

  async updateEvent(args = {}) {
    if (!args.id) throw new ApiError('Missing event.');
    const cal = await this.calendar(args.calendarId);
    const { calendarId, id, ...fields } = args;
    const body = eventBody(fields);
    const e = await this.api('PATCH', `/calendar/v3/calendars/${enc(cal.id)}/events/${enc(id)}`, {
      query: { sendUpdates: 'all' }, body,
    });
    this.emit('changed');
    return { event: toEvent(e, cal) };
  }

  async deleteEvent({ calendarId, id } = {}) {
    const cal = await this.calendar(calendarId);
    await this.api('DELETE', `/calendar/v3/calendars/${enc(cal.id)}/events/${enc(id)}`, { query: { sendUpdates: 'all' } });
    this.emit('changed');
    return {};
  }

  async respond({ calendarId, id, response } = {}) {
    if (!['accepted', 'declined', 'tentative'].includes(response)) throw new ApiError('Unknown answer.');
    const cal = await this.calendar(calendarId);
    const e = await this.api('GET', `/calendar/v3/calendars/${enc(cal.id)}/events/${enc(id)}`);
    const attendees = (e.attendees || []).map((a) => (a.self ? { ...a, responseStatus: response } : a));
    if (!attendees.some((a) => a.self)) throw new ApiError('You are not a guest of this event.');
    const updated = await this.api('PATCH', `/calendar/v3/calendars/${enc(cal.id)}/events/${enc(id)}`, {
      query: { sendUpdates: 'all' }, body: { attendees },
    });
    this.emit('changed');
    return { event: toEvent(updated, cal) };
  }

  // ----- reminders: a notification 10 minutes before each event -----

  startPolling() {
    if (this.pollTimer || !this.status().signedIn) return;
    this.pollTimer = setInterval(() => this.scheduleReminders(), POLL_MS);
    this.scheduleReminders();
  }

  stopPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const t of this.reminderTimers.values()) clearTimeout(t);
    this.reminderTimers.clear();
  }

  async scheduleReminders() {
    try {
      const now = Date.now();
      const { events } = await this.listEvents({ timeMin: new Date(now).toISOString(), timeMax: new Date(now + LOOKAHEAD_MS).toISOString() });
      for (const ev of events) {
        if (ev.allDay || ev.selfResponse === 'declined') continue;
        const key = `${ev.calendarId}|${ev.id}|${ev.startMs}`;
        if (this.reminded.has(key) || this.reminderTimers.has(key)) continue;
        const delay = ev.startMs - REMIND_BEFORE_MS - now;
        if (ev.startMs <= now) continue;
        const fire = () => {
          this.reminderTimers.delete(key);
          this.reminded.add(key);
          this.emit('reminder', { calendarId: ev.calendarId, id: ev.id, summary: ev.summary || '(No title)', startMs: ev.startMs, location: ev.location });
        };
        if (delay <= 0) fire();
        else this.reminderTimers.set(key, setTimeout(fire, delay));
      }
    } catch (err) {
      if (err.needsSignIn || err.needsSetup) this.stopPolling();
    }
  }
}

const CALENDAR_CONTRACT = ['getStatus', 'saveClientConfig', 'signIn', 'signOut', 'listCalendars', 'listEvents',
  'createEvent', 'updateEvent', 'deleteEvent', 'respond', 'openExternal'];

module.exports = { CalendarAccount, CALENDAR_CONTRACT, toEvent, eventBody, EVENT_COLORS, CAL_SCOPE };
