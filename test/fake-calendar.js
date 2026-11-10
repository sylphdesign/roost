// Fake Google Calendar API v3 (subset Roost uses). Mounted by fake-gmail-server.js.
const crypto = require('crypto');

function createFakeCalendar({ email }) {
  const day = (offset, h = 0, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + offset); return d; };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cal = {
    disabled: false,
    calendars: [
      { id: email, summary: email, primary: true, accessRole: 'owner', backgroundColor: '#7c6cff', foregroundColor: '#ffffff', selected: true },
      { id: 'team@group.calendar.google.com', summary: 'Team', accessRole: 'writer', backgroundColor: '#33b679', foregroundColor: '#000000', selected: true },
      { id: 'holidays@group.v.calendar.google.com', summary: 'Holidays', accessRole: 'reader', backgroundColor: '#e67c73', foregroundColor: '#000000', selected: true },
    ],
    events: {}, // calendarId -> [event]
    log: [],
  };
  const self = { email, self: true };
  const add = (cid, e) => { (cal.events[cid] ||= []).push({ status: 'confirmed', htmlLink: `https://calendar.google.com/event?eid=${e.id}`, ...e }); };
  const soon = new Date(Date.now() + 7 * 60 * 1000);
  add(email, { id: 'ev_standup', summary: 'Standup', start: { dateTime: day(0, 10).toISOString() }, end: { dateTime: day(0, 11).toISOString() },
    organizer: self, attendees: [{ ...self, responseStatus: 'accepted', organizer: true }, { email: 'bob@example.com', responseStatus: 'accepted' }],
    hangoutLink: 'https://meet.google.com/abc-defg-hij', description: 'Daily sync. Notes: https://docs.example.com/standup' });
  add('team@group.calendar.google.com', { id: 'ev_review', summary: 'Design review', start: { dateTime: day(0, 10, 30).toISOString() }, end: { dateTime: day(0, 11, 30).toISOString() },
    organizer: { email: 'team@group.calendar.google.com' }, location: 'Room 4' });
  add(email, { id: 'ev_offsite', summary: 'Offsite', start: { date: ymd(day(1)) }, end: { date: ymd(day(3)) }, organizer: self });
  add(email, { id: 'ev_soon', summary: 'Starts soon', start: { dateTime: soon.toISOString() }, end: { dateTime: new Date(soon.getTime() + 30 * 60000).toISOString() }, organizer: self });
  add(email, { id: 'ev_lunch', summary: 'Lunch with Alice', start: { dateTime: day(1, 12).toISOString() }, end: { dateTime: day(1, 13).toISOString() },
    organizer: { email: 'alice@example.com', displayName: 'Alice Johnson' },
    attendees: [{ email: 'alice@example.com', displayName: 'Alice Johnson', organizer: true, responseStatus: 'accepted' }, { ...self, responseStatus: 'needsAction' }] });
  for (let w = -2; w <= 4; w++) {
    add(email, { id: `ev_weekly_${w + 2}`, recurringEventId: 'ev_weekly', summary: 'Weekly 1:1', start: { dateTime: day(w * 7 + 2, 15).toISOString() }, end: { dateTime: day(w * 7 + 2, 15, 30).toISOString() }, organizer: self, colorId: '5' });
  }
  add('holidays@group.v.calendar.google.com', { id: 'ev_holiday', summary: 'Public holiday', start: { date: ymd(day(9)) }, end: { date: ymd(day(10)) }, organizer: { email: 'holidays@group.v.calendar.google.com' } });
  add(email, { id: 'ev_cancelled', summary: 'Cancelled thing', status: 'cancelled', start: { dateTime: day(0, 16).toISOString() }, end: { dateTime: day(0, 17).toISOString() }, organizer: self });

  const t = (x) => (x.dateTime ? Date.parse(x.dateTime) : new Date(`${x.date}T00:00:00`).getTime());

  // returns true when handled
  function handle(req, res, u, p, raw, { json, gerr, authed }) {
    const m0 = /^\/calendar\/v3\/(.*)$/.exec(p);
    if (!m0) return false;
    if (!authed()) { gerr(res, 401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED'); return true; }
    if (cal.disabled) { gerr(res, 403, 'Google Calendar API has not been used in project 123 before or it is disabled.', 'PERMISSION_DENIED'); return true; }
    const rest = m0[1];
    const body = raw ? JSON.parse(raw) : {};
    let m;
    if (req.method === 'GET' && rest === 'users/me/calendarList') { json(res, 200, { kind: 'calendar#calendarList', items: cal.calendars }); return true; }
    if (req.method === 'GET' && rest === 'users/me/calendarList/primary') { json(res, 200, cal.calendars[0]); return true; }
    if ((m = /^calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(rest))) {
      let cid = decodeURIComponent(m[1]);
      if (cid === 'primary') cid = email;
      const c = cal.calendars.find((x) => x.id === cid);
      if (!c) { gerr(res, 404, 'Not Found', 'NOT_FOUND'); return true; }
      const list = (cal.events[cid] ||= []);
      const eid = m[2] && decodeURIComponent(m[2]);
      const canWrite = c.accessRole === 'owner' || c.accessRole === 'writer';
      const sendUpdates = u.searchParams.get('sendUpdates');
      if (req.method === 'GET' && !eid) {
        const min = Date.parse(u.searchParams.get('timeMin'));
        const max = Date.parse(u.searchParams.get('timeMax'));
        const items = list.filter((e) => t(e.end) > min && t(e.start) < max).sort((a, b) => t(a.start) - t(b.start))
          .map((e) => ({ ...e, attendees: e.attendees && e.attendees.map((a) => ({ ...a })) }));
        json(res, 200, { kind: 'calendar#events', items });
        return true;
      }
      const ev = eid && list.find((e) => e.id === eid);
      if (eid && !ev) { gerr(res, 404, 'Not Found', 'NOT_FOUND'); return true; }
      if (req.method === 'GET') { json(res, 200, ev); return true; }
      if (!canWrite && req.method !== 'PATCH') { gerr(res, 403, 'Forbidden', 'PERMISSION_DENIED'); return true; }
      if (req.method === 'POST' && !eid) {
        if (!body.start || !body.end) { gerr(res, 400, 'Missing time', 'INVALID_ARGUMENT'); return true; }
        const e = { id: `ev_${crypto.randomBytes(5).toString('hex')}`, status: 'confirmed', organizer: self, ...body };
        if (body.attendees && body.attendees.length) e.attendees = [{ ...self, organizer: true, responseStatus: 'accepted' }, ...body.attendees.map((a) => ({ ...a, responseStatus: 'needsAction' }))];
        if (body.conferenceData && body.conferenceData.createRequest && u.searchParams.get('conferenceDataVersion') === '1') {
          e.hangoutLink = 'https://meet.google.com/new-meet-xyz';
          e.conferenceData = { entryPoints: [{ entryPointType: 'video', uri: e.hangoutLink }] };
        }
        delete e.conferenceData?.createRequest;
        add(cid, e);
        cal.log.push({ op: 'insert', cid, id: e.id, sendUpdates, body });
        json(res, 200, list.find((x) => x.id === e.id));
        return true;
      }
      if (req.method === 'PATCH') {
        const onlyRsvp = Object.keys(body).length === 1 && body.attendees;
        if (!canWrite && !onlyRsvp) { gerr(res, 403, 'Forbidden', 'PERMISSION_DENIED'); return true; }
        for (const k of ['start', 'end']) if (body[k]) { for (const f of ['date', 'dateTime']) if (body[k][f] === null) delete body[k][f]; }
        Object.assign(ev, body);
        cal.log.push({ op: 'patch', cid, id: ev.id, sendUpdates, body });
        json(res, 200, ev);
        return true;
      }
      if (req.method === 'DELETE') {
        list.splice(list.indexOf(ev), 1);
        cal.log.push({ op: 'delete', cid, id: ev.id, sendUpdates });
        res.writeHead(204); res.end();
        return true;
      }
    }
    gerr(res, 404, 'Not Found', 'NOT_FOUND');
    return true;
  }
  return { cal, handle };
}

module.exports = { createFakeCalendar };
