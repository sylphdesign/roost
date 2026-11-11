// Small pure helpers for the sidebar badges, the welcome screen, the shortcut bar and the quiet pill.
// Loaded by index.html before ui.js; unit tests require() this file.
(function (root) {
  // Which badge a sidebar tile shows.
  // red   = needs a person (Gmail: unread in the Primary tab; chat apps: their unread count)
  // calm  = gray number: unread, but nothing that needs a person (e.g. Promotions, Updates)
  // dot   = gray dot: something new, no count
  function badgeFor(svc) {
    const s = svc || {};
    const unread = s.unread > 0 ? s.unread : 0;
    const important = s.important === undefined || s.important === null ? unread : (s.important > 0 ? s.important : 0);
    const text = (n) => (n > 99 ? '99+' : String(n));
    if (important > 0) return { kind: 'red', text: text(important) };
    if (unread > 0) return { kind: 'calm', text: text(unread) };
    if (s.dot) return { kind: 'dot', text: '' };
    return null;
  }

  // The apps the welcome screen offers, in order: email, then chat, then Google Calendar.
  const WELCOME_GROUP_ORDER = ['mail', 'chat'];
  function welcomePresets(presets) {
    const list = Array.isArray(presets) ? presets.filter((p) => p && p.type !== 'custom') : [];
    const out = [];
    for (const g of WELCOME_GROUP_ORDER) out.push(...list.filter((p) => p.group === g));
    out.push(...list.filter((p) => p.type === 'calendar'));
    return out;
  }

  function welcomeHint(preset) {
    if (!preset) return '';
    if (preset.type === 'gmail') return 'Needs your own Google key · about 10 min';
    if (preset.type === 'calendar') return 'Uses your Gmail key';
    if (preset.group === 'chat') return 'Just sign in';
    return '';
  }

  function welcomeButtonLabel(count) {
    if (!(count > 0)) return 'Pick the apps you use';
    return count === 1 ? 'Add 1 app' : `Add ${count} apps`;
  }

  // ----- shortcut bar that steps back -----
  // A bar item is learned when every key in it was used LEARNED_AFTER times or more.
  // keys is the text the bar shows, e.g. 'j k', '[ ]', '⇧F'. learned maps one key ('j', 'F' for ⇧F …) to a use count.
  const LEARNED_AFTER = 5;
  function keyParts(keys) {
    return String(keys || '').split(/\s+/).filter(Boolean).map((k) => (/^⇧.$/u.test(k) ? k.slice(1).toUpperCase() : k));
  }
  function isKeyLearned(keys, learned, min = LEARNED_AFTER) {
    const parts = keyParts(keys);
    if (!parts.length || !learned || typeof learned !== 'object') return false;
    return parts.every((k) => Number(learned[k]) >= min);
  }
  // The bar items ([keys, what]) that are not learned yet.
  function keysToShow(items, learned) {
    return (Array.isArray(items) ? items : []).filter((it) => !isKeyLearned(it[0], learned));
  }

  // ----- quiet state: when does it end? -----
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  // The next end of the quiet hours window after `now` (a Date), or null when the window is not valid.
  // A window that crosses midnight (22:00 to 07:00) ends tomorrow morning when it is evening now.
  function quietEnd(now, quietHours) {
    const q = quietHours || {};
    const from = toMin(q.from);
    const to = toMin(q.to);
    if (from === null || to === null || from === to) return null;
    const d = new Date(now.getTime());
    d.setHours(Math.floor(to / 60), to % 60, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  // The short time in the user's locale, e.g. "07:00" (en-GB) or "7:00 AM" (en-US).
  function shortTime(date, locale) {
    try { return date.toLocaleTimeString(locale || [], { timeStyle: 'short' }); } catch { return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  }
  // Text for the quiet pill, the Do Not Disturb button title and the Settings status line.
  function quietText(quiet, quietHours, { now = new Date(), locale } = {}) {
    if (quiet === 'dnd') return { pill: '🔕 Do Not Disturb · until you turn it off', title: 'Do Not Disturb is ON · until you turn it off. Click to turn off (⌘⇧D)', status: 'Quiet now: Do Not Disturb is on until you turn it off.' };
    if (quiet === 'call') return { pill: '🔕 Quiet – in a call', title: 'Quiet: you are in a call. Click to turn on Do Not Disturb', status: 'Quiet now: you are in a call.' };
    if (quiet === 'hours') {
      const end = quietEnd(now, quietHours);
      const t = end ? shortTime(end, locale) : '';
      return t
        ? { pill: `🔕 Quiet until ${t}`, title: `Quiet hours until ${t}. Click to turn on Do Not Disturb`, status: `Quiet now: quiet hours until ${t}.` }
        : { pill: '🔕 Quiet hours', title: 'Quiet hours. Click to turn on Do Not Disturb', status: 'Quiet now: quiet hours.' };
    }
    return { pill: '', title: 'Do Not Disturb (⌘⇧D)', status: 'Not quiet now.' };
  }

  const api = { badgeFor, welcomePresets, welcomeHint, welcomeButtonLabel, isKeyLearned, keysToShow, quietEnd, quietText, LEARNED_AFTER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.roostUi = api;
})(typeof window !== 'undefined' ? window : globalThis);
