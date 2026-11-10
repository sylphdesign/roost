// Roost Google Calendar screen.
// Talks to the main process only through window.gcal (see preload). Builds all DOM with
// createElement/textContent. Event descriptions are reduced to plain text with DOMParser.
'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const HOUR_PX = 48;
  const DAY_MS = 86400000;
  const MONTH_CHIPS = 3;
  const NARROW_MQ = window.matchMedia('(max-width: 760px)');
  const API_URL = 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com';
  const LS_VIEW = 'roost.calendar.view';
  const LS_CALS = 'roost.calendar.selected.';

  // Feather-style 24x24 stroke icons. Constant path data only.
  const ICONS = {
    menu: ['M3 12h18', 'M3 6h18', 'M3 18h18'],
    calendar: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
    chevLeft: ['M15 18l-6-6 6-6'],
    chevRight: ['M9 18l6-6-6-6'],
    chevDown: ['M6 9l6 6 6-6'],
    refresh: ['M23 4v6h-6', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
    plus: ['M12 5v14', 'M5 12h14'],
    x: ['M18 6L6 18', 'M6 6l12 12'],
    signout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    external: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14L21 3'],
    clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
    pin: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    video: ['M23 7l-7 5 7 5V7z', 'M3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'],
    text: ['M17 10H3', 'M21 6H3', 'M21 14H3', 'M17 18H3'],
    edit: ['M12 20h9', 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'],
    trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
    check: ['M20 6L9 17l-5-5'],
    help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
    info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
    user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    repeat: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
    alert: ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  };

  const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;
  const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    email: null,
    calendars: [],
    selected: {},         // calendarId -> bool (user choice, remembered per account)
    view: loadView(),     // 'day' | 'week' | 'month'
    cursor: startOfDay(new Date()),
    miniMonth: startOfMonth(new Date()),
    events: [],
    loadedKey: null,      // range key of state.events
    loading: false,
    apiDisabled: null,    // error text when the Calendar API is off
    rangeReq: 0,
    calReq: 0,
    signInSeq: 0,
    openEvent: null,      // event shown in details
    editor: null,         // { mode, event, durationMs, dayCount, saving }
    confirm: null,        // { resolve }
    pendingOpen: null,    // { calendarId, id } from a notification
    scrollReset: true,    // scroll the time grid to the default position on next render
    toastTimer: null,
    nowTimer: null,
    today: dayKey(new Date()),
  };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function icon(name, filled) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon' + (filled ? ' filled' : ''));
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name] || []) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  function iconButton(name, label, onClick, opts = {}) {
    const b = el('button', 'icon-btn' + (opts.cls ? ' ' + opts.cls : ''));
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = opts.title || label;
    b.appendChild(icon(name, opts.filled));
    b.addEventListener('click', onClick);
    return b;
  }

  function textButton(name, label, onClick, cls) {
    const b = el('button', 'btn ' + (cls || ''));
    b.type = 'button';
    if (name) b.appendChild(icon(name));
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', onClick);
    return b;
  }

  function hydrateIcons(root) {
    root.querySelectorAll('[data-icon]').forEach((n) => {
      const svg = icon(n.getAttribute('data-icon'));
      if (n.className) svg.setAttribute('class', svg.getAttribute('class') + ' ' + n.className);
      n.replaceWith(svg);
    });
  }

  function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) { /* ignore */ }
  }

  function loadView() {
    const v = lsGet(LS_VIEW);
    return v === 'day' || v === 'week' || v === 'month' ? v : 'week';
  }

  function titleOf(ev) { return (ev && ev.summary && String(ev.summary).trim()) || '(No title)'; }

  // Hex color -> rgba string. Falls back to the accent color.
  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    let h = m ? m[1] : '7c6cff';
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function safeColor(hex) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(hex || '').trim()) ? String(hex).trim() : '#7c6cff';
  }

  // A light version of a color for text on dark tinted backgrounds.
  function lightColor(hex) {
    let h = safeColor(hex).slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    const mix = (c) => Math.round(c + (255 - c) * 0.55);
    return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
  }

  // ---------------------------------------------------------------------------
  // Dates (always local time)
  // ---------------------------------------------------------------------------

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function timeKey(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

  // 'YYYY-MM-DD' -> local Date at midnight (null when invalid).
  function parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? null : d;
  }

  // 'YYYY-MM-DD' + 'HH:MM' -> local Date (null when invalid).
  function parseDateTime(day, time) {
    const d = parseDay(day);
    if (!d) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
    if (!m) return null;
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d;
  }

  // Days between two local midnights (DST-safe).
  function dayDiff(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
  }

  function firstDayOfWeek() {
    try {
      const loc = new Intl.Locale(navigator.language || 'en-US');
      const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
      if (info && info.firstDay) return info.firstDay % 7; // 1 = Monday ... 7 = Sunday
    } catch (_) { /* ignore */ }
    return 0;
  }
  const WEEK_START = firstDayOfWeek();

  function startOfWeek(d) {
    const x = startOfDay(d);
    const diff = (x.getDay() - WEEK_START + 7) % 7;
    return addDays(x, -diff);
  }

  function fmt(d, opts) { return d.toLocaleDateString([], opts); }
  function fmtTime(d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

  // "9 AM" / "09" style hour label, per locale.
  function fmtHour(h) {
    const d = new Date(2000, 0, 1, h);
    return d.toLocaleTimeString([], { hour: 'numeric' });
  }

  // Short time for chips: "9am" style is US-only, so keep the locale format but drop ":00".
  function fmtShortTime(d) {
    if (d.getMinutes() === 0) return d.toLocaleTimeString([], { hour: 'numeric' });
    return fmtTime(d);
  }

  function fmtRange(a, b, opts) {
    try {
      const f = new Intl.DateTimeFormat([], opts);
      if (typeof f.formatRange === 'function') return f.formatRange(a, b);
      return f.format(a) + ' – ' + f.format(b);
    } catch (_) {
      return a.toLocaleString() + ' – ' + b.toLocaleString();
    }
  }

  // ---------------------------------------------------------------------------
  // Events: normalized local times
  // ---------------------------------------------------------------------------

  // Adds cached local fields: _s/_e (Date; for all-day, local midnights with exclusive end),
  // _allRow (shown in the all-day row: all-day or 24h+ timed events).
  function prep(ev) {
    if (ev._prepped) return ev;
    if (ev.allDay) {
      const s = parseDay(ev.start) || startOfDay(new Date(Number(ev.startMs) || Date.now()));
      let e = parseDay(ev.end) || addDays(s, 1);
      if (e <= s) e = addDays(s, 1);
      ev._s = s;
      ev._e = e;
      ev._allRow = true;
    } else {
      const s = new Date(Number(ev.startMs) || Date.parse(ev.start));
      let e = new Date(Number(ev.endMs) || Date.parse(ev.end));
      if (isNaN(e) || e < s) e = new Date(s.getTime());
      ev._s = s;
      ev._e = e;
      ev._allRow = e - s >= DAY_MS;
    }
    ev._color = safeColor(ev.color || (calendarById(ev.calendarId) || {}).backgroundColor);
    ev._prepped = true;
    return ev;
  }

  function calendarById(id) { return state.calendars.find((c) => c.id === id) || null; }

  function isDeclined(ev) { return ev.selfResponse === 'declined'; }
  function isPending(ev) { return ev.selfResponse === 'needsAction' || ev.selfResponse === 'tentative'; }

  // Does the event touch the local day [d, d+1)?
  function touchesDay(ev, d) {
    const s = startOfDay(d);
    const e = addDays(s, 1);
    if (ev.allDay) return ev._s < e && ev._e > s;
    if (ev._e.getTime() === ev._s.getTime()) return ev._s >= s && ev._s < e;
    return ev._s < e && ev._e > s;
  }

  function sortEvents(list) {
    return list.sort((a, b) => {
      if (a._allRow !== b._allRow) return a._allRow ? -1 : 1;
      if (a._s - b._s) return a._s - b._s;
      return (b._e - b._s) - (a._e - a._s);
    });
  }

  // ---------------------------------------------------------------------------
  // Bridge
  // ---------------------------------------------------------------------------

  async function call(method, args) {
    let r;
    try {
      if (!window.gcal || typeof window.gcal.call !== 'function') {
        return { ok: false, error: 'The Google Calendar connection is not available.' };
      }
      r = await window.gcal.call(method, args || {});
    } catch (err) {
      r = { ok: false, error: (err && err.message) || 'Something went wrong.' };
    }
    if (!r || typeof r !== 'object') r = { ok: false, error: 'Unexpected response.' };
    if (!r.ok) {
      if (r.needsSetup) showSetup();
      else if (r.needsSignIn) showSignIn();
    }
    return r;
  }

  function errText(r) { return (r && r.error) || 'Something went wrong.'; }

  function openExternal(url) {
    if (!/^(https?:|mailto:)/i.test(String(url || ''))) return;
    call('openExternal', { url: String(url) }).then((r) => { if (!r.ok) toast(errText(r), { error: true }); });
  }

  // Shows an error toast, or the "Calendar API is off" state when that is the cause.
  function reportError(r) {
    if (r.needsSetup || r.needsSignIn) return;
    if (r.apiDisabled) { state.apiDisabled = errText(r); renderView(); return; }
    toast(errText(r), { error: true });
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  const SCREENS = ['screen-loading', 'screen-setup', 'screen-signin', 'screen-cal'];
  let currentScreen = 'screen-loading';

  function showScreen(id) {
    currentScreen = id;
    for (const s of SCREENS) $(s).hidden = s !== id;
  }

  function closeOverlays() {
    closeEditorNow();
    closeConfirm(false);
    closeDetails();
    closeDrawer();
  }

  function showLoading(text, withRetry) {
    $('loading-text').textContent = text || 'Loading…';
    $('loading-retry').hidden = !withRetry;
    document.querySelector('#screen-loading .spinner').hidden = !!withRetry;
    showScreen('screen-loading');
  }

  function showSetup(fromSignIn) {
    closeOverlays();
    $('setup-error').hidden = true;
    $('setup-save').disabled = false;
    $('setup-cancel').hidden = !fromSignIn;
    showScreen('screen-setup');
  }

  function showSignIn(error) {
    closeOverlays();
    $('signin-idle').hidden = false;
    $('signin-waiting').hidden = true;
    $('signin-error').hidden = !error;
    $('signin-error').textContent = error || '';
    showScreen('screen-signin');
  }

  async function init() {
    showLoading('Loading…');
    const r = await call('getStatus');
    if (!r.ok) {
      if (!r.needsSetup && !r.needsSignIn) showLoading(errText(r), true);
      return;
    }
    if (!r.configured) return showSetup(false);
    const expect = $('signin-expect');
    if (expect) {
      expect.hidden = !r.expectEmail;
      expect.textContent = r.expectEmail ? `Sign in as ${r.expectEmail}. This Calendar follows the Gmail tab you use now.` : '';
    }
    if (!r.signedIn) return showSignIn();
    enterCalendar(r.email);
  }

  // ---------------------------------------------------------------------------
  // Setup + sign-in
  // ---------------------------------------------------------------------------

  async function onSaveSetup(e) {
    e.preventDefault();
    const clientId = $('setup-client-id').value.trim();
    const clientSecret = $('setup-client-secret').value.trim();
    const err = $('setup-error');
    if (!clientId || !clientSecret) {
      err.textContent = 'Please paste both the Client ID and the Client secret.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    $('setup-save').disabled = true;
    const r = await call('saveClientConfig', { clientId, clientSecret });
    $('setup-save').disabled = false;
    if (!r.ok) {
      if (currentScreen === 'screen-setup') { err.textContent = errText(r); err.hidden = false; }
      return;
    }
    $('setup-client-secret').value = '';
    init();
  }

  async function onSignIn() {
    const seq = ++state.signInSeq;
    $('signin-error').hidden = true;
    $('signin-idle').hidden = true;
    $('signin-waiting').hidden = false;
    const r = await call('signIn');
    if (r.ok) return init(); // even after Cancel: the user did finish signing in
    if (seq !== state.signInSeq) return; // cancelled; ignore the late error
    if (r.needsSetup) return;
    showSignIn(errText(r));
  }

  function onCancelSignIn() {
    state.signInSeq++;
    showSignIn();
  }

  async function onSignOut() {
    closeDrawer();
    const r = await call('signOut');
    if (!r.ok) return toast(errText(r), { error: true });
    resetCalState();
    init();
  }

  function resetCalState() {
    closeOverlays();
    state.email = null;
    state.calendars = [];
    state.selected = {};
    state.events = [];
    state.loadedKey = null;
    state.apiDisabled = null;
    state.pendingOpen = null;
    state.rangeReq++;
    state.calReq++;
    state.scrollReset = true;
  }

  // ---------------------------------------------------------------------------
  // Calendar screen
  // ---------------------------------------------------------------------------

  async function enterCalendar(email) {
    const changedAccount = state.email && email && state.email !== email;
    if (changedAccount) resetCalState();
    state.email = email || null;
    const acc = $('account-email');
    acc.textContent = email || '';
    acc.title = email || '';
    showScreen('screen-cal');
    renderChrome();
    renderView();
    await loadCalendars();
    if (state.pendingOpen) {
      const p = state.pendingOpen;
      state.pendingOpen = null;
      openEventById(p.calendarId, p.id);
    }
  }

  function loadSelection() {
    try {
      const raw = lsGet(LS_CALS + (state.email || ''));
      const obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (_) {
      return {};
    }
  }

  function saveSelection() {
    lsSet(LS_CALS + (state.email || ''), JSON.stringify(state.selected));
  }

  async function loadCalendars() {
    const seq = ++state.calReq;
    setLoading(true);
    const r = await call('listCalendars');
    if (seq !== state.calReq || currentScreen !== 'screen-cal') return;
    if (!r.ok) {
      setLoading(false);
      reportError(r);
      if (!r.apiDisabled) renderView();
      return;
    }
    state.apiDisabled = null;
    const cals = Array.isArray(r.calendars) ? r.calendars.slice() : [];
    cals.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0)
      || String(a.summary || '').localeCompare(String(b.summary || '')));
    state.calendars = cals;
    const saved = loadSelection();
    state.selected = {};
    for (const c of cals) state.selected[c.id] = typeof saved[c.id] === 'boolean' ? saved[c.id] : c.selected !== false;
    // Events carry calendar colors as a fallback; recompute.
    for (const ev of state.events) ev._prepped = false;
    renderCalendarList();
    await loadRange({ quiet: state.loadedKey === rangeKey() });
  }

  function selectedIds() {
    return state.calendars.filter((c) => state.selected[c.id]).map((c) => c.id);
  }

  // ---------------------------------------------------------------------------
  // Range
  // ---------------------------------------------------------------------------

  function isNarrow() { return NARROW_MQ.matches; }

  // Number of day columns for the time-grid views.
  function dayCount() {
    if (state.view === 'day') return 1;
    return isNarrow() ? 3 : 7;
  }

  function range() {
    const c = state.cursor;
    if (state.view === 'month') {
      const first = startOfMonth(c);
      const start = startOfWeek(first);
      return { start, end: addDays(start, 42), days: 42 };
    }
    if (state.view === 'day') return { start: startOfDay(c), end: addDays(startOfDay(c), 1), days: 1 };
    const n = dayCount();
    const start = n === 7 ? startOfWeek(c) : startOfDay(c);
    return { start, end: addDays(start, n), days: n };
  }

  function rangeKey() {
    const r = range();
    return dayKey(r.start) + '/' + dayKey(r.end) + '/' + selectedIds().join(',');
  }

  function rangeTitle() {
    const r = range();
    const now = new Date();
    if (state.view === 'month') return fmt(state.cursor, { month: 'long', year: 'numeric' });
    if (r.days === 1) {
      const opts = { weekday: 'long', month: 'short', day: 'numeric' };
      if (r.start.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
      return fmt(r.start, opts);
    }
    return fmtRange(r.start, addDays(r.end, -1), { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function loadRange(opts = {}) {
    const seq = ++state.rangeReq;
    const key = rangeKey();
    const ids = selectedIds();
    if (!ids.length) {
      state.events = [];
      state.loadedKey = key;
      setLoading(false);
      renderView();
      return;
    }
    if (!opts.quiet && state.loadedKey !== key) {
      // Keep showing old events for a moment would be confusing across ranges; clear them.
      state.events = [];
      renderView();
    }
    setLoading(true);
    const r = range();
    const res = await call('listEvents', {
      timeMin: r.start.toISOString(),
      timeMax: r.end.toISOString(),
      calendarIds: ids,
    });
    if (seq !== state.rangeReq || currentScreen !== 'screen-cal') return;
    setLoading(false);
    if (!res.ok) {
      reportError(res);
      if (!opts.quiet) { state.loadedKey = null; renderView(); }
      return;
    }
    state.apiDisabled = null;
    const sel = new Set(ids);
    state.events = (Array.isArray(res.events) ? res.events : []).filter((e) => e && sel.has(e.calendarId)).map(prep);
    sortEvents(state.events);
    state.loadedKey = key;
    // Keep the details panel in sync with fresh data.
    if (state.openEvent) {
      const fresh = findEvent(state.openEvent.calendarId, state.openEvent.id);
      if (fresh) { state.openEvent = fresh; renderDetails(); }
    }
    renderView();
  }

  function setLoading(on) {
    state.loading = on;
    $('view-loading').hidden = !on;
  }

  function findEvent(calendarId, id) {
    return state.events.find((e) => e.id === id && (!calendarId || e.calendarId === calendarId)) || null;
  }

  function go(cursor, view) {
    if (view && view !== state.view) {
      state.view = view;
      lsSet(LS_VIEW, view);
      state.scrollReset = true;
    }
    if (cursor) state.cursor = startOfDay(cursor);
    state.miniMonth = startOfMonth(state.cursor);
    const key = rangeKey();
    renderChrome();
    if (key !== state.loadedKey) {
      state.scrollReset = true;
      loadRange();
    } else {
      renderView();
    }
  }

  function step(dir) {
    const c = state.cursor;
    if (state.view === 'month') return go(new Date(c.getFullYear(), c.getMonth() + dir, 1));
    if (state.view === 'day') return go(addDays(c, dir));
    return go(addDays(c, dir * dayCount()));
  }

  function goToday() { go(new Date()); }

  // ---------------------------------------------------------------------------
  // Chrome: top bar, mini calendar, calendar list
  // ---------------------------------------------------------------------------

  function renderChrome() {
    $('range-title').textContent = rangeTitle();
    document.querySelectorAll('.view-switch button').forEach((b) => {
      const on = b.getAttribute('data-view') === state.view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderMini();
  }

  function renderMini() {
    const m = state.miniMonth;
    $('mini-title').textContent = fmt(m, { month: 'long', year: 'numeric' });
    const grid = $('mini-grid');
    grid.textContent = '';
    const start = startOfWeek(m);
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      grid.appendChild(el('span', 'mini-dow', fmt(d, { weekday: 'narrow' })));
    }
    const today = new Date();
    const r = range();
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const b = el('button', 'mini-day', d.getDate());
      b.type = 'button';
      b.setAttribute('aria-label', fmt(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
      if (d.getMonth() !== m.getMonth()) b.classList.add('other');
      if (sameDay(d, today)) b.classList.add('today');
      if (state.view !== 'month' && d >= r.start && d < r.end) b.classList.add('in-range');
      if (sameDay(d, state.cursor)) b.classList.add('cursor');
      b.addEventListener('click', () => {
        closeDrawer();
        go(d);
      });
      grid.appendChild(b);
    }
  }

  function renderCalendarList() {
    const list = $('cal-list');
    list.textContent = '';
    if (!state.calendars.length) {
      list.appendChild(el('div', 'side-empty', state.apiDisabled ? '' : 'No calendars'));
      return;
    }
    for (const c of state.calendars) {
      const row = el('label', 'cal-item');
      row.title = c.summary || c.id;
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!state.selected[c.id];
      const box = el('span', 'cal-box');
      const color = safeColor(c.backgroundColor);
      box.style.setProperty('--c', color);
      box.appendChild(icon('check'));
      cb.addEventListener('change', () => {
        state.selected[c.id] = cb.checked;
        saveSelection();
        loadRange({ quiet: true });
      });
      row.append(cb, box, el('span', 'cal-name', c.summary || c.id));
      list.appendChild(row);
    }
  }

  // ---------------------------------------------------------------------------
  // View rendering
  // ---------------------------------------------------------------------------

  function renderView() {
    const view = $('view');
    $('range-title').textContent = rangeTitle();
    if (currentScreen !== 'screen-cal') return;
    if (state.apiDisabled) {
      view.textContent = '';
      view.appendChild(apiDisabledState(state.apiDisabled));
      return;
    }
    // Keep the time-grid scroll position across quiet re-renders.
    const oldScroll = view.querySelector('.tg-scroll');
    const keepTop = oldScroll && !state.scrollReset ? oldScroll.scrollTop : null;
    view.textContent = '';
    if (state.view === 'month') view.appendChild(renderMonth());
    else view.appendChild(renderTimeGrid());
    const sc = view.querySelector('.tg-scroll');
    if (sc) {
      if (keepTop != null) sc.scrollTop = keepTop;
      else scrollToDefault(sc);
    }
    state.scrollReset = false;
    markNarrowBlocks();
    updateNowLine();
    if (!state.loading && state.loadedKey === rangeKey() && !selectedIds().length && state.calendars.length) {
      view.appendChild(overlayNote('No calendars selected', 'Turn on a calendar in the list on the left.'));
    }
  }

  function overlayNote(title, sub) {
    const n = el('div', 'view-note');
    n.appendChild(el('strong', null, title));
    if (sub) n.appendChild(el('span', null, sub));
    return n;
  }

  function apiDisabledState(text) {
    const box = el('div', 'view-state');
    const mark = el('div', 'brand-mark warn');
    mark.appendChild(icon('alert'));
    box.appendChild(mark);
    box.appendChild(el('h3', null, 'Turn on the Google Calendar API'));
    box.appendChild(el('p', 'muted', text));
    box.appendChild(el('p', 'muted small', 'Open your Google Cloud project, click Enable, wait a minute, then try again.'));
    const actions = el('div', 'view-state-actions');
    const open = textButton(null, 'Enable Calendar API', () => openExternal(API_URL), 'btn-primary');
    open.appendChild(icon('external'));
    actions.appendChild(open);
    actions.appendChild(textButton('refresh', 'Try again', () => { state.apiDisabled = null; renderView(); loadCalendars(); }));
    box.appendChild(actions);
    return box;
  }

  function scrollToDefault(sc) {
    const r = range();
    const now = new Date();
    let hour = 7;
    if (now >= r.start && now < r.end) hour = Math.max(0, now.getHours() + now.getMinutes() / 60 - 1.5);
    sc.scrollTop = Math.round(hour * HOUR_PX);
  }

  // ---- Week / day ----------------------------------------------------------

  function renderTimeGrid() {
    const r = range();
    const days = [];
    for (let i = 0; i < r.days; i++) days.push(addDays(r.start, i));
    const today = new Date();
    const root = el('div', 'tg tg-' + r.days);
    root.style.setProperty('--days', r.days);

    // Header: day names + dates
    const head = el('div', 'tg-head');
    head.appendChild(el('div', 'tg-gutter tg-tz', tzLabel()));
    for (const d of days) {
      const h = el('button', 'tg-day-head');
      h.type = 'button';
      h.title = fmt(d, { weekday: 'long', month: 'long', day: 'numeric' });
      if (sameDay(d, today)) h.classList.add('today');
      if (d < startOfDay(today)) h.classList.add('past');
      h.appendChild(el('span', 'dow', fmt(d, { weekday: 'short' })));
      h.appendChild(el('span', 'dnum', d.getDate()));
      h.addEventListener('click', () => go(d, 'day'));
      head.appendChild(h);
    }
    root.appendChild(head);

    // All-day row
    root.appendChild(renderAllDayRow(r, days));

    // Scrollable grid
    const sc = el('div', 'tg-scroll');
    const body = el('div', 'tg-body');
    body.style.height = 24 * HOUR_PX + 'px';
    const gutter = el('div', 'tg-gutter tg-hours');
    for (let h = 1; h < 24; h++) {
      const lab = el('span', 'tg-hour', fmtHour(h));
      lab.style.top = h * HOUR_PX + 'px';
      gutter.appendChild(lab);
    }
    body.appendChild(gutter);
    const cols = el('div', 'tg-cols');
    for (const d of days) cols.appendChild(renderDayColumn(d, today));
    body.appendChild(cols);
    sc.appendChild(body);
    root.appendChild(sc);
    return root;
  }

  function tzLabel() {
    try {
      const parts = new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(new Date());
      const tz = parts.find((p) => p.type === 'timeZoneName');
      return tz ? tz.value : '';
    } catch (_) {
      return '';
    }
  }

  function renderAllDayRow(r, days) {
    const row = el('div', 'tg-allday');
    row.appendChild(el('div', 'tg-gutter tg-allday-label', 'All day'));
    const lanesBox = el('div', 'tg-allday-grid');
    // Background cells: click to add an all-day event.
    days.forEach((d, i) => {
      const cell = el('div', 'tg-allday-cell');
      cell.style.gridColumn = String(i + 1);
      cell.style.gridRow = '1 / -1';
      cell.addEventListener('click', () => openEditor({ mode: 'create', start: d, allDay: true }));
      lanesBox.appendChild(cell);
    });
    // Segments clipped to the visible range, packed into lanes.
    const segs = [];
    for (const ev of state.events) {
      if (!ev._allRow) continue;
      const s = ev.allDay ? ev._s : startOfDay(ev._s);
      const e = ev.allDay ? ev._e : (ev._e.getHours() || ev._e.getMinutes() ? addDays(startOfDay(ev._e), 1) : startOfDay(ev._e));
      const from = Math.max(0, dayDiff(r.start, s));
      const to = Math.min(r.days, dayDiff(r.start, e));
      if (to <= from) continue;
      segs.push({ ev, from, to, clipL: s < r.start, clipR: e > r.end });
    }
    segs.sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
    const lanes = [];
    for (const sg of segs) {
      let lane = lanes.findIndex((end) => end <= sg.from);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = sg.to;
      const chip = eventChip(sg.ev, 'allday');
      if (sg.clipL) chip.classList.add('clip-l');
      if (sg.clipR) chip.classList.add('clip-r');
      chip.style.gridColumn = `${sg.from + 1} / ${sg.to + 1}`;
      chip.style.gridRow = String(lane + 1);
      lanesBox.appendChild(chip);
    }
    lanesBox.style.gridTemplateRows = `repeat(${Math.max(1, lanes.length)}, 24px)`;
    row.appendChild(lanesBox);
    if (!lanes.length) row.classList.add('empty');
    return row;
  }

  function renderDayColumn(d, today) {
    const col = el('div', 'tg-col');
    if (sameDay(d, today)) col.classList.add('today');
    const dayStart = startOfDay(d);
    const dayEnd = addDays(dayStart, 1);
    col.dataset.day = dayKey(d);

    // Click empty space -> new event at that half hour.
    col.addEventListener('click', (e) => {
      if (e.target !== col) return;
      const rect = col.getBoundingClientRect();
      const mins = Math.max(0, Math.min(24 * 60 - 30, Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30));
      const start = new Date(dayStart);
      start.setMinutes(mins);
      openEditor({ mode: 'create', start, allDay: false });
    });

    // Timed events touching this day, clipped to it.
    const items = [];
    for (const ev of state.events) {
      if (ev._allRow) continue;
      if (!touchesDay(ev, d)) continue;
      const s = ev._s < dayStart ? dayStart : ev._s;
      const e = ev._e > dayEnd ? dayEnd : ev._e;
      const top = ((s - dayStart) / 3600000) * HOUR_PX;
      const realH = ((e - s) / 3600000) * HOUR_PX;
      const h = Math.max(realH, 20);
      items.push({ ev, top, h, bottom: top + h, clipTop: ev._s < dayStart, clipBottom: ev._e > dayEnd });
    }
    layoutColumns(items);
    for (const it of items) {
      const b = eventChip(it.ev, 'block', it);
      b.style.top = it.top + 'px';
      b.style.height = Math.max(it.h - 1, 18) + 'px';
      b.style.left = `calc(${(it.col / it.cols) * 100}% + 1px)`;
      // Let blocks overlap slightly to the right like native calendars, except the last column.
      const span = it.span || 1;
      const width = (span / it.cols) * 100;
      b.style.width = `calc(${width}% - ${it.col + span >= it.cols ? 6 : 2}px)`;
      if (it.h < 34) b.classList.add('short');
      if (it.clipTop) b.classList.add('clip-top');
      if (it.clipBottom) b.classList.add('clip-bottom');
      col.appendChild(b);
    }

    // Half-hour lines are drawn with CSS; now line is positioned by updateNowLine().
    if (sameDay(d, today)) {
      const now = el('div', 'now-line');
      now.setAttribute('aria-hidden', 'true');
      col.appendChild(now);
    }
    return col;
  }

  // Standard column packing: group overlapping events into clusters, give each event the first
  // free column in its cluster, then let it grow right across columns that are free.
  function layoutColumns(items) {
    items.sort((a, b) => a.top - b.top || b.h - a.h);
    let cluster = [];
    let clusterEnd = -1;
    const flush = () => {
      if (!cluster.length) return;
      const colsEnd = [];
      for (const it of cluster) {
        let c = colsEnd.findIndex((end) => end <= it.top + 0.01);
        if (c < 0) { c = colsEnd.length; colsEnd.push(0); }
        colsEnd[c] = it.bottom;
        it.col = c;
      }
      const n = colsEnd.length;
      for (const it of cluster) {
        it.cols = n;
        let span = 1;
        while (it.col + span < n && !cluster.some((o) => o !== it && o.col === it.col + span
          && o.top < it.bottom - 0.01 && o.bottom > it.top + 0.01)) span++;
        it.span = span;
      }
      cluster = [];
      clusterEnd = -1;
    };
    for (const it of items) {
      if (cluster.length && it.top >= clusterEnd - 0.01) flush();
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.bottom);
    }
    flush();
  }

  // One event element. kind: 'block' (time grid), 'allday' (all-day row), 'month' (month cell)
  function eventChip(ev, kind, layout) {
    const b = el('button', 'ev ev-' + kind);
    b.type = 'button';
    b._ev = ev;
    const color = ev._color;
    b.style.setProperty('--c', color);
    b.style.setProperty('--c-bg', rgba(color, kind === 'month' && !ev._allRow ? 0 : 0.24));
    b.style.setProperty('--c-bg-hover', rgba(color, 0.34));
    b.style.setProperty('--c-bg-faint', rgba(color, 0.12));
    b.style.setProperty('--c-text', lightColor(color));
    if (isDeclined(ev)) b.classList.add('declined');
    else if (isPending(ev)) b.classList.add('pending');
    if (ev._e < new Date()) b.classList.add('past');
    if (state.openEvent && state.openEvent.id === ev.id && state.openEvent.calendarId === ev.calendarId) b.classList.add('open');

    const title = titleOf(ev);
    const timeText = ev.allDay ? '' : timeSpan(ev);
    b.title = title + (timeText ? '\n' + timeText : '') + (ev.location ? '\n' + ev.location : '');
    b.setAttribute('aria-label', `${title}, ${ev.allDay ? 'all day' : timeText}`);

    if (kind === 'block') {
      const t = el('span', 'ev-title', title);
      b.appendChild(t);
      if (layout && layout.h >= 34) {
        b.appendChild(el('span', 'ev-time', timeText));
        if (ev.location && layout.h >= 62) b.appendChild(el('span', 'ev-loc', ev.location));
      } else {
        t.appendChild(el('span', 'ev-time-inline', ', ' + fmtShortTime(ev._s)));
      }
    } else if (kind === 'allday') {
      b.appendChild(el('span', 'ev-title', title));
    } else {
      if (!ev._allRow) {
        b.appendChild(el('span', 'ev-dot'));
        b.appendChild(el('span', 'ev-time-inline', fmtShortTime(ev._s)));
      }
      b.appendChild(el('span', 'ev-title', title));
    }
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetails(ev);
    });
    return b;
  }

  // Thin side-by-side blocks: one-line title with ellipsis instead of breaking words.
  function markNarrowBlocks() {
    document.querySelectorAll('#view .ev-block').forEach((b) => {
      b.classList.toggle('narrow', b.offsetWidth < 70);
    });
  }

  // "10:00 – 11:00 AM"; events that cross midnight show times only ("10:00 PM – 6:00 AM").
  function timeSpan(ev) {
    if (sameDay(ev._s, ev._e)) return fmtRange(ev._s, ev._e, { hour: 'numeric', minute: '2-digit' });
    return fmtTime(ev._s) + ' – ' + fmtTime(ev._e);
  }

  function updateNowLine() {
    const line = document.querySelector('#view .now-line');
    if (!line) return;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    line.style.top = (mins / 60) * HOUR_PX + 'px';
  }

  function tick() {
    const k = dayKey(new Date());
    if (k !== state.today) {
      // Midnight passed: today moved. Re-render so highlights follow.
      state.today = k;
      if (currentScreen === 'screen-cal') { renderChrome(); renderView(); }
      return;
    }
    updateNowLine();
    // Fade blocks that just ended.
    const now = Date.now();
    document.querySelectorAll('#view .ev:not(.past)').forEach((n) => {
      const ev = n._ev;
      if (ev && ev._e.getTime() < now) n.classList.add('past');
    });
  }

  // ---- Month -----------------------------------------------------------------

  function renderMonth() {
    const r = range();
    const month = state.cursor.getMonth();
    const today = new Date();
    const root = el('div', 'month');
    const head = el('div', 'month-head');
    for (let i = 0; i < 7; i++) head.appendChild(el('div', 'month-dow', fmt(addDays(r.start, i), { weekday: 'short' })));
    root.appendChild(head);
    const grid = el('div', 'month-grid');
    for (let i = 0; i < 42; i++) {
      const d = addDays(r.start, i);
      const cell = el('div', 'month-cell');
      if (d.getMonth() !== month) cell.classList.add('other');
      if (sameDay(d, today)) cell.classList.add('today');
      if (d.getDay() === 0 || d.getDay() === 6) cell.classList.add('weekend');
      const num = el('button', 'month-num', d.getDate() === 1 ? fmt(d, { month: 'short', day: 'numeric' }) : d.getDate());
      num.type = 'button';
      num.title = fmt(d, { weekday: 'long', month: 'long', day: 'numeric' });
      num.addEventListener('click', (e) => { e.stopPropagation(); go(d, 'day'); });
      cell.appendChild(num);
      const evs = state.events.filter((ev) => touchesDay(ev, d));
      const list = el('div', 'month-events');
      const show = Math.min(evs.length, MONTH_CHIPS);
      for (let j = 0; j < show; j++) {
        const chip = eventChip(evs[j], 'month');
        if (evs[j]._allRow) {
          if (evs[j]._s < startOfDay(d) && d.getDay() !== WEEK_START) chip.classList.add('clip-l');
          const endDay = evs[j].allDay ? addDays(evs[j]._e, -1) : evs[j]._e;
          if (startOfDay(endDay) > startOfDay(d) && addDays(d, 1).getDay() !== WEEK_START) chip.classList.add('clip-r');
        }
        list.appendChild(chip);
      }
      if (evs.length > show) {
        const more = el('button', 'month-more', `+${evs.length - show} more`);
        more.type = 'button';
        more.addEventListener('click', (e) => { e.stopPropagation(); go(d, 'day'); });
        list.appendChild(more);
      }
      cell.appendChild(list);
      cell.addEventListener('click', () => openEditor({ mode: 'create', start: d, allDay: true }));
      grid.appendChild(cell);
    }
    root.appendChild(grid);
    return root;
  }

  // ---------------------------------------------------------------------------
  // Details panel
  // ---------------------------------------------------------------------------

  function openDetails(ev) {
    state.openEvent = ev;
    renderDetails();
    const p = $('details');
    p.hidden = false;
    markOpenChips();
    p.focus({ preventScroll: true });
  }

  function closeDetails() {
    state.openEvent = null;
    const p = $('details');
    if (p) { p.hidden = true; p.textContent = ''; }
    markOpenChips();
  }

  function markOpenChips() {
    const o = state.openEvent;
    document.querySelectorAll('#view .ev').forEach((n) => {
      n.classList.toggle('open', !!(o && n._ev && n._ev.id === o.id && n._ev.calendarId === o.calendarId));
    });
  }

  function whenText(ev) {
    const s = ev._s;
    const e = ev._e;
    if (ev.allDay) {
      const last = addDays(e, -1);
      if (sameDay(s, last)) return fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: yearOpt(s) }) + ' · All day';
      return fmtRange(s, last, { weekday: 'short', month: 'short', day: 'numeric', year: yearOpt(s, last) }) + ' · All day';
    }
    if (sameDay(s, e) || (e - s < DAY_MS && e.getHours() === 0 && e.getMinutes() === 0 && dayDiff(s, e) === 1)) {
      return fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: yearOpt(s) }) + ' · '
        + fmtRange(s, e, { hour: 'numeric', minute: '2-digit' });
    }
    return fmtRange(s, e, { weekday: 'short', month: 'short', day: 'numeric', year: yearOpt(s, e), hour: 'numeric', minute: '2-digit' });
  }

  function yearOpt(a, b) {
    const y = new Date().getFullYear();
    return a.getFullYear() !== y || (b && b.getFullYear() !== y) ? 'numeric' : undefined;
  }

  function htmlToText(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      doc.querySelectorAll('style, script, head, title').forEach((n) => n.remove());
      doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
      doc.querySelectorAll('p, div, tr, li, h1, h2, h3, h4, h5, h6, blockquote, table').forEach((n) => n.append('\n'));
      // Keep link targets that differ from their text, e.g. <a href="https://x">Join</a>.
      doc.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href) && !String(a.textContent || '').includes(href)) a.append(' (' + href + ')');
      });
      const text = (doc.body ? doc.body.textContent : '') || '';
      return text.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } catch (_) {
      return '';
    }
  }

  // Plain text -> nodes with http(s) links that open in the browser.
  function linkify(text, parent) {
    const s = String(text || '');
    let last = 0;
    URL_RE.lastIndex = 0;
    let m;
    while ((m = URL_RE.exec(s))) {
      if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
      parent.appendChild(extLink(m[0], m[0]));
      last = m.index + m[0].length;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  }

  function extLink(text, url) {
    const a = el('a', 'ext-link', text);
    a.href = '#';
    a.title = url;
    a.addEventListener('click', (e) => { e.preventDefault(); openExternal(url); });
    return a;
  }

  function detailRow(iconName, cls) {
    const row = el('div', 'd-row' + (cls ? ' ' + cls : ''));
    const ic = el('span', 'd-icon');
    ic.appendChild(icon(iconName));
    row.appendChild(ic);
    const body = el('div', 'd-body');
    row.appendChild(body);
    return { row, body };
  }

  const RESPONSE_LABEL = { accepted: 'Going', declined: 'Not going', tentative: 'Maybe', needsAction: 'Awaiting' };
  const RESPONSE_ICON = { accepted: 'check', declined: 'x', tentative: 'help', needsAction: 'clock' };

  function renderDetails() {
    const ev = state.openEvent;
    const p = $('details');
    p.textContent = '';
    if (!ev) return;
    const cal = calendarById(ev.calendarId);

    // Toolbar
    const bar = el('div', 'd-bar');
    if (ev.canEdit) {
      bar.appendChild(iconButton('edit', 'Edit event', () => openEditor({ mode: 'edit', event: ev })));
      bar.appendChild(iconButton('trash', 'Delete event', () => deleteEvent(ev)));
    }
    if (ev.htmlLink) bar.appendChild(iconButton('external', 'Open in Google Calendar', () => openExternal(ev.htmlLink)));
    bar.appendChild(el('span', 'spacer'));
    bar.appendChild(iconButton('x', 'Close', closeDetails, { title: 'Close (Esc)' }));
    p.appendChild(bar);

    const scroll = el('div', 'd-scroll');
    p.appendChild(scroll);

    // Title
    const head = el('div', 'd-head');
    const dot = el('span', 'd-swatch');
    dot.style.background = ev._color;
    head.appendChild(dot);
    const titleBox = el('div', 'd-titlebox');
    const h = el('h2', 'd-title' + (isDeclined(ev) ? ' declined' : ''), titleOf(ev));
    titleBox.appendChild(h);
    titleBox.appendChild(el('div', 'd-when', whenText(ev)));
    if (ev.recurringEventId) {
      const rec = el('div', 'd-sub');
      rec.appendChild(icon('repeat'));
      rec.appendChild(document.createTextNode('Repeating event'));
      titleBox.appendChild(rec);
    }
    head.appendChild(titleBox);
    scroll.appendChild(head);

    // Meet
    if (ev.hangoutLink) {
      const { row, body } = detailRow('video', 'd-meet');
      const join = textButton(null, 'Join with Google Meet', () => openExternal(ev.hangoutLink), 'btn-primary');
      body.appendChild(join);
      body.appendChild(el('div', 'd-faint', String(ev.hangoutLink).replace(/^https?:\/\//, '')));
      scroll.appendChild(row);
    }

    // Location
    if (ev.location && String(ev.location).trim()) {
      const { row, body } = detailRow('pin');
      const loc = String(ev.location).trim();
      if (/^https?:\/\/\S+$/i.test(loc)) body.appendChild(extLink(loc, loc));
      else linkify(loc, body);
      scroll.appendChild(row);
    }

    // Guests
    const guests = Array.isArray(ev.attendees) ? ev.attendees : [];
    if (guests.length) {
      const { row, body } = detailRow('users');
      const counts = {};
      for (const g of guests) counts[g.responseStatus || 'needsAction'] = (counts[g.responseStatus || 'needsAction'] || 0) + 1;
      body.appendChild(el('div', 'd-label', guests.length === 1 ? '1 guest' : `${guests.length} guests`));
      const parts = [];
      if (counts.accepted) parts.push(`${counts.accepted} yes`);
      if (counts.tentative) parts.push(`${counts.tentative} maybe`);
      if (counts.declined) parts.push(`${counts.declined} no`);
      if (counts.needsAction) parts.push(`${counts.needsAction} awaiting`);
      body.appendChild(el('div', 'd-faint', parts.join(', ')));
      const list = el('ul', 'guests');
      const sorted = guests.slice().sort((a, b) => (b.organizer ? 1 : 0) - (a.organizer ? 1 : 0));
      for (const g of sorted) {
        const li = el('li', 'guest');
        const status = g.responseStatus || 'needsAction';
        const st = el('span', 'guest-status st-' + status);
        st.title = RESPONSE_LABEL[status] || status;
        st.appendChild(icon(RESPONSE_ICON[status] || 'clock'));
        li.appendChild(st);
        const who = el('div', 'guest-who');
        const name = (g.displayName && String(g.displayName).trim()) || g.email || '';
        who.appendChild(el('span', 'guest-name', name + (g.self ? ' (you)' : '')));
        const tags = [];
        if (g.organizer) tags.push('Organizer');
        if (g.displayName && g.email) tags.push(g.email);
        if (tags.length) who.appendChild(el('span', 'guest-meta', tags.join(' · ')));
        li.appendChild(who);
        list.appendChild(li);
      }
      body.appendChild(list);
      scroll.appendChild(row);
    }

    // Description
    const desc = htmlToText(ev.description);
    if (desc) {
      const { row, body } = detailRow('text');
      const d = el('div', 'd-desc');
      linkify(desc, d);
      body.appendChild(d);
      scroll.appendChild(row);
    }

    // Calendar + organizer
    {
      const { row, body } = detailRow('calendar');
      const line = el('div', 'd-cal');
      const cdot = el('span', 'dot');
      cdot.style.background = safeColor(cal ? cal.backgroundColor : ev._color);
      line.append(cdot, el('span', null, cal ? (cal.summary || cal.id) : ev.calendarId));
      body.appendChild(line);
      const org = ev.organizer;
      if (org && (org.displayName || org.email) && !(guests.length && guests.some((g) => g.organizer))) {
        const who = org.self ? 'You' : (org.displayName || org.email);
        body.appendChild(el('div', 'd-faint', 'Organizer: ' + who));
      }
      scroll.appendChild(row);
    }

    // RSVP
    const isOrganizer = !!(ev.organizer && ev.organizer.self);
    if (ev.selfResponse && !isOrganizer) {
      const box = el('div', 'rsvp');
      box.appendChild(el('span', 'rsvp-label', 'Going?'));
      const group = el('div', 'rsvp-group');
      for (const [resp, label] of [['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']]) {
        const b = el('button', 'rsvp-btn' + (ev.selfResponse === resp ? ' active r-' + resp : ''), label);
        b.type = 'button';
        b.setAttribute('aria-pressed', ev.selfResponse === resp ? 'true' : 'false');
        b.addEventListener('click', () => respond(ev, resp, group));
        group.appendChild(b);
      }
      box.appendChild(group);
      p.appendChild(box);
    }

    // Footer
    const foot = el('div', 'd-foot');
    if (ev.htmlLink) {
      const open = textButton(null, 'Open in Google Calendar', () => openExternal(ev.htmlLink), 'btn-small btn-ghost');
      open.appendChild(icon('external'));
      foot.appendChild(open);
    }
    foot.appendChild(el('span', 'spacer'));
    if (ev.canEdit) {
      foot.appendChild(textButton('trash', 'Delete', () => deleteEvent(ev), 'btn-small btn-ghost danger-text'));
      foot.appendChild(textButton('edit', 'Edit', () => openEditor({ mode: 'edit', event: ev }), 'btn-small'));
    }
    p.appendChild(foot);
  }

  async function respond(ev, response, group) {
    if (ev.selfResponse === response) return;
    group.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const r = await call('respond', { calendarId: ev.calendarId, id: ev.id, response });
    if (!r.ok) {
      group.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      return reportError(r);
    }
    const fresh = r.event ? prep(Object.assign({}, r.event)) : Object.assign(ev, { selfResponse: response });
    replaceEvent(ev, fresh);
    if (state.openEvent === ev) { state.openEvent = fresh; renderDetails(); }
    renderView();
    toast(response === 'accepted' ? 'You said yes' : response === 'declined' ? 'You said no' : 'You said maybe');
  }

  function replaceEvent(old, fresh) {
    const i = state.events.indexOf(old);
    if (i >= 0) state.events[i] = fresh;
    sortEvents(state.events);
  }

  async function deleteEvent(ev) {
    const text = ev.recurringEventId
      ? 'This deletes only this event, not the whole series.'
      : `“${titleOf(ev)}” will be removed from your calendar.`;
    const ok = await askConfirm('Delete event?', text, 'Delete');
    if (!ok) return;
    const r = await call('deleteEvent', { calendarId: ev.calendarId, id: ev.id });
    if (!r.ok) return reportError(r);
    state.events = state.events.filter((e) => e !== ev);
    if (state.openEvent === ev) closeDetails();
    renderView();
    toast('Event deleted');
    loadRange({ quiet: true });
  }

  // Opens an event from a reminder notification: find its day, go there, open details.
  async function openEventById(calendarId, id) {
    let ev = findEvent(calendarId, id);
    if (!ev) {
      const now = new Date();
      const r = await call('listEvents', {
        timeMin: addDays(startOfDay(now), -1).toISOString(),
        timeMax: addDays(startOfDay(now), 31).toISOString(),
        calendarIds: [calendarId],
      });
      if (!r.ok) return reportError(r);
      const found = (r.events || []).find((e) => e && e.id === id);
      if (!found) return toast('That event could not be found.', { error: true });
      ev = prep(found);
    }
    closeEditorNow();
    const target = startOfDay(ev._s);
    if (state.view === 'month' && target.getMonth() === state.cursor.getMonth()
      && target.getFullYear() === state.cursor.getFullYear()) {
      state.cursor = target;
    } else {
      state.cursor = target;
      state.scrollReset = true;
    }
    state.miniMonth = startOfMonth(target);
    renderChrome();
    // Make sure the calendar is shown, so the event appears in the view.
    if (state.selected[ev.calendarId] === false) {
      state.selected[ev.calendarId] = true;
      saveSelection();
      renderCalendarList();
    }
    await loadRange({ quiet: state.loadedKey === rangeKey() });
    openDetails(findEvent(ev.calendarId, ev.id) || ev);
    // Scroll the event into view in the time grid.
    const sc = document.querySelector('#view .tg-scroll');
    if (sc && !ev._allRow) sc.scrollTop = Math.max(0, (ev._s.getHours() - 1) * HOUR_PX);
  }

  // ---------------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------------

  function writableCalendars() {
    return state.calendars.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer');
  }

  // opts: { mode: 'create', start: Date, allDay } or { mode: 'edit', event }
  function openEditor(opts) {
    if (state.editor) return;
    const cals = writableCalendars();
    if (opts.mode === 'create' && !cals.length) {
      toast(state.calendars.length ? 'You cannot add events to these calendars.' : 'Calendars are still loading.', { error: true });
      return;
    }
    closeDrawer();
    const ed = { mode: opts.mode, event: opts.event || null, saving: false, keepAttendees: [] };
    state.editor = ed;

    $('editor-title').textContent = opts.mode === 'edit' ? 'Edit event' : 'New event';
    $('ed-error').hidden = true;
    $('editor-save').disabled = false;
    $('editor-save').textContent = 'Save';

    // Calendar select
    const sel = $('ed-calendar');
    sel.textContent = '';
    let list = cals;
    if (opts.mode === 'edit') {
      const cur = calendarById(opts.event.calendarId);
      list = [cur || { id: opts.event.calendarId, summary: opts.event.calendarId, backgroundColor: opts.event._color }];
    }
    for (const c of list) {
      const o = el('option', null, c.summary || c.id);
      o.value = c.id;
      sel.appendChild(o);
    }
    sel.disabled = opts.mode === 'edit';
    $('ed-meet-row').hidden = opts.mode === 'edit';
    $('ed-meet').checked = false;

    let start;
    let end;
    let allDay;
    if (opts.mode === 'edit') {
      const ev = opts.event;
      allDay = !!ev.allDay;
      start = new Date(ev._s);
      end = allDay ? addDays(ev._e, -1) : new Date(ev._e); // all-day end shown inclusive
      $('ed-title').value = ev.summary || '';
      $('ed-location').value = ev.location || '';
      $('ed-description').value = htmlToText(ev.description);
      const guests = Array.isArray(ev.attendees) ? ev.attendees : [];
      ed.keepAttendees = guests.filter((g) => g.self && g.email).map((g) => g.email);
      $('ed-guests').value = guests.filter((g) => !g.self && g.email).map((g) => g.email).join(', ');
      sel.value = ev.calendarId;
    } else {
      allDay = !!opts.allDay;
      start = new Date(opts.start || defaultStart());
      if (allDay) {
        start = startOfDay(start);
        end = new Date(start);
      } else {
        end = new Date(start.getTime() + 3600000);
      }
      $('ed-title').value = '';
      $('ed-location').value = '';
      $('ed-description').value = '';
      $('ed-guests').value = '';
      const primary = cals.find((c) => c.primary) || cals[0];
      sel.value = primary.id;
    }
    // Timed default for when the user turns all-day off.
    if (allDay) {
      const s = new Date(start);
      s.setHours(9, 0, 0, 0);
      ed.durationMs = 3600000;
      $('ed-start-time').value = timeKey(s);
      $('ed-end-time').value = timeKey(new Date(s.getTime() + 3600000));
    } else {
      ed.durationMs = Math.max(0, end - start);
      $('ed-start-time').value = timeKey(start);
      $('ed-end-time').value = timeKey(end);
    }
    $('ed-start-date').value = dayKey(start);
    $('ed-end-date').value = dayKey(end);
    ed.dayCount = Math.max(0, dayDiff(startOfDay(start), startOfDay(end)));
    $('ed-allday').checked = allDay;
    applyAllDayUI();
    updateCalDot();
    updateDuration();

    ed.snapshot = editorSnapshot();
    $('editor-backdrop').hidden = false;
    setTimeout(() => $('ed-title').focus(), 0);
  }

  function defaultStart() {
    const now = new Date();
    if (sameDay(state.cursor, now)) {
      const s = new Date(now);
      s.setMinutes(0, 0, 0);
      s.setHours(s.getHours() + 1);
      return s;
    }
    const s = new Date(state.cursor);
    s.setHours(9, 0, 0, 0);
    return s;
  }

  function applyAllDayUI() {
    const all = $('ed-allday').checked;
    $('ed-start-time').hidden = all;
    $('ed-end-time').hidden = all;
  }

  function updateCalDot() {
    const c = calendarById($('ed-calendar').value);
    $('ed-cal-dot').style.background = safeColor(c ? c.backgroundColor : state.editor && state.editor.event && state.editor.event._color);
  }

  function readEditorTimes() {
    const all = $('ed-allday').checked;
    if (all) {
      const s = parseDay($('ed-start-date').value);
      const e = parseDay($('ed-end-date').value);
      return { all, s, e };
    }
    const s = parseDateTime($('ed-start-date').value, $('ed-start-time').value);
    const e = parseDateTime($('ed-end-date').value, $('ed-end-time').value);
    return { all, s, e };
  }

  // Start moved: move the end too so the length stays the same.
  function onStartChanged() {
    const ed = state.editor;
    if (!ed) return;
    const { all, s } = readEditorTimes();
    if (!s) return;
    if (all) {
      const e = addDays(s, ed.dayCount || 0);
      $('ed-end-date').value = dayKey(e);
    } else {
      const e = new Date(s.getTime() + (ed.durationMs || 0));
      $('ed-end-date').value = dayKey(e);
      $('ed-end-time').value = timeKey(e);
    }
    updateDuration();
  }

  // End moved: remember the new length (if valid).
  function onEndChanged() {
    const ed = state.editor;
    if (!ed) return;
    const { all, s, e } = readEditorTimes();
    if (s && e) {
      if (all && e >= s) ed.dayCount = dayDiff(s, e);
      if (!all && e > s) ed.durationMs = e - s;
    }
    updateDuration();
  }

  function onAllDayChanged() {
    const ed = state.editor;
    if (!ed) return;
    const all = $('ed-allday').checked;
    if (all) {
      const s = parseDay($('ed-start-date').value);
      const e = parseDay($('ed-end-date').value);
      ed.dayCount = s && e && e >= s ? dayDiff(s, e) : 0;
      if (s && (!e || e < s)) $('ed-end-date').value = dayKey(s);
    } else {
      // Back to timed: keep the dates, use the remembered times.
      const { s } = readEditorTimes();
      if (s) {
        const e = new Date(s.getTime() + (ed.durationMs || 3600000));
        if (dayDiff(s, e) === 0 || !ed.dayCount) {
          $('ed-end-date').value = dayKey(e);
          $('ed-end-time').value = timeKey(e);
        }
      }
    }
    applyAllDayUI();
    updateDuration();
  }

  function updateDuration() {
    const out = $('ed-duration');
    const { all, s, e } = readEditorTimes();
    out.classList.remove('bad');
    if (!s || !e) { out.textContent = ''; return; }
    if (all) {
      const n = dayDiff(s, e) + 1;
      if (n < 1) { out.textContent = 'Ends before it starts'; out.classList.add('bad'); return; }
      out.textContent = n === 1 ? '1 day' : `${n} days`;
      return;
    }
    const mins = Math.round((e - s) / 60000);
    if (mins <= 0) { out.textContent = 'Ends before it starts'; out.classList.add('bad'); return; }
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    const parts = [];
    if (d) parts.push(d === 1 ? '1 day' : `${d} days`);
    if (h) parts.push(`${h} h`);
    if (m) parts.push(`${m} min`);
    out.textContent = parts.join(' ');
  }

  function edError(text, focusId) {
    const err = $('ed-error');
    err.textContent = text;
    err.hidden = false;
    if (focusId) $(focusId).focus();
  }

  function parseGuests(s) {
    const tokens = String(s || '').split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean)
      .map((t) => { const m = /<([^>]+)>/.exec(t); return (m ? m[1] : t).replace(/^mailto:/i, ''); });
    const bad = tokens.filter((t) => !EMAIL_RE.test(t));
    const seen = new Set();
    const good = [];
    for (const t of tokens) {
      const k = t.toLowerCase();
      if (EMAIL_RE.test(t) && !seen.has(k)) { seen.add(k); good.push(t); }
    }
    return { good, bad };
  }

  async function onSaveEditor(e) {
    e.preventDefault();
    const ed = state.editor;
    if (!ed || ed.saving) return;
    $('ed-error').hidden = true;
    const { all, s, e: end } = readEditorTimes();
    if (!s) return edError(all ? 'Please enter a start date.' : 'Please enter a start date and time.', 'ed-start-date');
    if (!end) return edError(all ? 'Please enter an end date.' : 'Please enter an end date and time.', 'ed-end-date');
    if (all ? end < s : end <= s) return edError('The end must be after the start.', all ? 'ed-end-date' : 'ed-end-time');
    const guests = parseGuests($('ed-guests').value);
    if (guests.bad.length) return edError(`This guest address is not valid: ${guests.bad[0]}`, 'ed-guests');

    const payload = {
      calendarId: $('ed-calendar').value,
      summary: $('ed-title').value.trim(),
      description: $('ed-description').value,
      location: $('ed-location').value.trim(),
      allDay: all,
      start: all ? dayKey(s) : s.toISOString(),
      end: all ? dayKey(addDays(end, 1)) : end.toISOString(), // all-day end is exclusive for Google
    };
    let method = 'createEvent';
    if (ed.mode === 'edit') {
      method = 'updateEvent';
      payload.id = ed.event.id;
      payload.calendarId = ed.event.calendarId;
      const keep = ed.keepAttendees.filter((k) => !guests.good.some((g) => g.toLowerCase() === k.toLowerCase()));
      payload.attendees = keep.concat(guests.good);
    } else {
      payload.attendees = guests.good;
      payload.addMeet = $('ed-meet').checked;
    }

    ed.saving = true;
    $('editor-save').disabled = true;
    $('editor-save').textContent = 'Saving…';
    const r = await call(method, payload);
    if (state.editor !== ed) return; // closed meanwhile
    ed.saving = false;
    $('editor-save').disabled = false;
    $('editor-save').textContent = 'Save';
    if (!r.ok) {
      if (r.needsSetup || r.needsSignIn) return;
      return edError(r.apiDisabled ? 'The Google Calendar API is turned off for your Google Cloud project.' : errText(r));
    }
    closeEditorNow();
    toast('Event saved');
    if (r.event) {
      const fresh = prep(Object.assign({}, r.event));
      if (ed.mode === 'edit') replaceEvent(ed.event, fresh);
      else { state.events.push(fresh); sortEvents(state.events); }
      if (state.openEvent && ed.mode === 'edit' && state.openEvent === ed.event) {
        state.openEvent = fresh;
        renderDetails();
      }
      renderView();
    }
    loadRange({ quiet: true });
  }

  function editorDirty() {
    const ed = state.editor;
    if (!ed) return false;
    if (ed.mode === 'create') {
      return !!($('ed-title').value.trim() || $('ed-location').value.trim()
        || $('ed-description').value.trim() || $('ed-guests').value.trim());
    }
    return editorSnapshot() !== ed.snapshot;
  }

  function editorSnapshot() {
    return JSON.stringify(['ed-title', 'ed-allday', 'ed-start-date', 'ed-start-time', 'ed-end-date', 'ed-end-time',
      'ed-location', 'ed-guests', 'ed-description'].map((id) => ($(id).type === 'checkbox' ? $(id).checked : $(id).value)));
  }

  async function closeEditor() {
    if (!state.editor) return;
    if (editorDirty()) {
      const ok = await askConfirm('Discard changes?', 'Your changes to this event will be lost.', 'Discard');
      if (!ok) return;
    }
    closeEditorNow();
  }

  function closeEditorNow() {
    state.editor = null;
    const b = $('editor-backdrop');
    if (b) b.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Confirm dialog
  // ---------------------------------------------------------------------------

  function askConfirm(title, text, okLabel) {
    closeConfirm(false);
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = okLabel || 'OK';
    $('confirm-backdrop').hidden = false;
    setTimeout(() => $('confirm-cancel').focus(), 0);
    return new Promise((resolve) => { state.confirm = { resolve }; });
  }

  function closeConfirm(result) {
    const c = state.confirm;
    state.confirm = null;
    const b = $('confirm-backdrop');
    if (b) b.hidden = true;
    if (c) c.resolve(result);
  }

  // ---------------------------------------------------------------------------
  // Drawer (narrow widths)
  // ---------------------------------------------------------------------------

  function openDrawer() {
    $('screen-cal').classList.add('drawer-open');
    $('drawer-backdrop').hidden = false;
  }
  function closeDrawer() {
    const s = $('screen-cal');
    if (!s) return;
    s.classList.remove('drawer-open');
    $('drawer-backdrop').hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------

  function toast(text, opts = {}) {
    const box = $('toasts');
    box.textContent = '';
    clearTimeout(state.toastTimer);
    const t = el('div', 'toast' + (opts.error ? ' error' : ''));
    t.setAttribute('role', opts.error ? 'alert' : 'status');
    t.appendChild(el('span', 'toast-text', text));
    if (opts.action) {
      const b = el('button', 'link-btn', opts.action);
      b.type = 'button';
      b.addEventListener('click', () => { dismissToast(t); opts.onAction && opts.onAction(); });
      t.appendChild(b);
    }
    const x = iconButton('x', 'Dismiss', () => dismissToast(t));
    x.style.width = '24px';
    x.style.height = '24px';
    t.appendChild(x);
    box.appendChild(t);
    state.toastTimer = setTimeout(() => dismissToast(t), opts.error ? 7000 : opts.action ? 6000 : 3000);
  }

  function dismissToast(t) {
    if (!t.isConnected) return;
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 180);
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (state.confirm) { e.preventDefault(); closeConfirm(false); return; }
      if (state.editor) { e.preventDefault(); closeEditor(); return; }
    }
    if (currentScreen !== 'screen-cal') return;
    if (state.confirm || state.editor) return;
    if (e.key === 'Escape') {
      if (state.openEvent) { e.preventDefault(); closeDetails(); return; }
      if ($('screen-cal').classList.contains('drawer-open')) { closeDrawer(); return; }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) return;
    const handlers = {
      t: goToday,
      j: () => step(1),
      n: () => step(1),
      k: () => step(-1),
      p: () => step(-1),
      d: () => go(null, 'day'),
      w: () => go(null, 'week'),
      m: () => go(null, 'month'),
      c: () => openEditor({ mode: 'create', start: defaultStart(), allDay: false }),
    };
    const h = handlers[e.key];
    if (!h) return;
    e.preventDefault();
    h();
  }

  // ---------------------------------------------------------------------------
  // Events from main
  // ---------------------------------------------------------------------------

  function onEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'changed') {
      if (currentScreen === 'screen-cal' && !state.apiDisabled) loadRange({ quiet: true });
    } else if (ev.type === 'open-event' && ev.id) {
      const p = { calendarId: String(ev.calendarId || ''), id: String(ev.id) };
      if (currentScreen !== 'screen-cal' || !state.calendars.length) { state.pendingOpen = p; return; }
      openEventById(p.calendarId, p.id);
    } else if (ev.type === 'auth') {
      if (ev.signedIn) {
        if (currentScreen === 'screen-cal' && ev.email === state.email) return;
        init();
      } else {
        resetCalState();
        init();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function wire() {
    hydrateIcons(document);

    // Setup + sign-in links
    document.querySelectorAll('[data-url]').forEach((b) => {
      b.addEventListener('click', () => openExternal(b.getAttribute('data-url')));
    });
    $('setup-form').addEventListener('submit', onSaveSetup);
    $('setup-cancel').addEventListener('click', () => showSignIn());
    $('loading-retry').addEventListener('click', init);
    $('signin-btn').addEventListener('click', onSignIn);
    $('signin-cancel').addEventListener('click', onCancelSignIn);
    $('signin-test-users').addEventListener('click', () => openExternal('https://console.cloud.google.com/auth/audience'));
    $('signin-change-key').addEventListener('click', () => { state.signInSeq++; showSetup(true); });

    // Calendar chrome
    $('today-btn').addEventListener('click', goToday);
    $('prev-btn').addEventListener('click', () => step(-1));
    $('next-btn').addEventListener('click', () => step(1));
    document.querySelectorAll('.view-switch button').forEach((b) => {
      b.addEventListener('click', () => go(null, b.getAttribute('data-view')));
    });
    $('refresh-btn').addEventListener('click', async () => {
      const b = $('refresh-btn');
      b.classList.add('refresh-spin');
      await loadCalendars();
      b.classList.remove('refresh-spin');
    });
    $('new-btn').addEventListener('click', () => openEditor({ mode: 'create', start: defaultStart(), allDay: false }));
    $('signout-btn').addEventListener('click', onSignOut);
    $('menu-btn').addEventListener('click', openDrawer);
    $('drawer-backdrop').addEventListener('click', closeDrawer);
    $('mini-prev').addEventListener('click', () => { state.miniMonth = addMonths(state.miniMonth, -1); renderMini(); });
    $('mini-next').addEventListener('click', () => { state.miniMonth = addMonths(state.miniMonth, 1); renderMini(); });

    // Editor
    $('editor-form').addEventListener('submit', onSaveEditor);
    $('editor-close').addEventListener('click', closeEditor);
    $('editor-cancel').addEventListener('click', closeEditor);
    $('editor-backdrop').addEventListener('mousedown', (e) => { if (e.target === $('editor-backdrop')) closeEditor(); });
    $('ed-start-date').addEventListener('change', onStartChanged);
    $('ed-start-time').addEventListener('change', onStartChanged);
    $('ed-end-date').addEventListener('change', onEndChanged);
    $('ed-end-time').addEventListener('change', onEndChanged);
    $('ed-allday').addEventListener('change', onAllDayChanged);
    $('ed-calendar').addEventListener('change', updateCalDot);

    // Confirm
    $('confirm-ok').addEventListener('click', () => closeConfirm(true));
    $('confirm-cancel').addEventListener('click', () => closeConfirm(false));
    $('confirm-backdrop').addEventListener('mousedown', (e) => { if (e.target === $('confirm-backdrop')) closeConfirm(false); });

    document.addEventListener('keydown', onKeyDown);

    // Week view shows 3 days on narrow windows; re-render when crossing the breakpoint.
    const onNarrow = () => {
      if (currentScreen !== 'screen-cal') return;
      if (!isNarrow()) closeDrawer();
      go(null);
    };
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(markNarrowBlocks, 100);
    });
    if (typeof NARROW_MQ.addEventListener === 'function') NARROW_MQ.addEventListener('change', onNarrow);
    else if (typeof NARROW_MQ.addListener === 'function') NARROW_MQ.addListener(onNarrow);

    state.nowTimer = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

    if (window.gcal && typeof window.gcal.onEvent === 'function') {
      try { window.gcal.onEvent(onEvent); } catch (_) { /* ignore */ }
    }
  }

  wire();
  init();
})();
