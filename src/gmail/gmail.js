// Roost Gmail screen.
// Talks to the main process only through window.gmail (see preload). Builds all DOM with
// createElement/textContent. Email HTML is shown only inside a sandboxed srcdoc iframe.
'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const SYSTEM_LABELS = [
    { id: 'INBOX', name: 'Inbox', icon: 'inbox', showCount: true },
    { id: 'STARRED', name: 'Starred', icon: 'star' },
    { id: 'SENT', name: 'Sent', icon: 'send' },
    { id: 'DRAFT', name: 'Drafts', icon: 'file' },
    { id: 'ALL', name: 'All Mail', icon: 'layers' },
    { id: 'SPAM', name: 'Spam', icon: 'spam' },
    { id: 'TRASH', name: 'Trash', icon: 'trash' },
  ];
  const HIDDEN_LABELS = new Set(['IMPORTANT', 'UNREAD', 'CHAT']);

  // Feather-style 24x24 stroke icons. Constant path data only.
  const ICONS = {
    menu: ['M3 12h18', 'M3 6h18', 'M3 18h18'],
    compose: ['M12 20h9', 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'],
    refresh: ['M23 4v6h-6', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
    search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
    archive: ['M21 8v13H3V8', 'M1 3h22v5H1z', 'M10 12h4'],
    trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
    mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 6l-10 7L2 6'],
    star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
    inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
    reply: ['M9 14L4 9l5-5', 'M20 20v-7a4 4 0 0 0-4-4H4'],
    replyAll: ['M7 17L2 12l5-5', 'M12 17l-5-5 5-5', 'M22 18v-2a4 4 0 0 0-4-4H7'],
    forward: ['M15 14l5-5-5-5', 'M4 20v-7a4 4 0 0 1 4-4h12'],
    back: ['M19 12H5', 'M12 19l-7-7 7-7'],
    expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
    collapse: ['M4 14h6v6', 'M20 10h-6V4', 'M14 10l7-7', 'M3 21l7-7'],
    clip: ['M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
    x: ['M18 6L6 18', 'M6 6l12 12'],
    send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z'],
    signout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    tag: ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'],
    file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
    layers: ['M12 2L2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
    spam: ['M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2z', 'M12 8v4', 'M12 16h.01'],
    download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
    external: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14L21 3'],
    unread: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 6l-10 7L2 6'],
    sparkle: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z', 'M19 15v5', 'M16.5 17.5h5', 'M5 2v4', 'M3 4h4'],
  };

  const AVATAR_COLORS = ['#7c6cff', '#e0679a', '#3fb47d', '#e39a3b', '#4d9de0', '#c05fd6', '#d9614c', '#2fa8a0'];
  const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;
  const REMOTE_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*["']?\s*(https?:)?\/\/|url\(\s*["']?\s*(https?:)?\/\/|\bbackground\s*=\s*["']?\s*https?:|\bsrcset\s*=\s*["']?\s*https?:/i;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    email: null,
    labels: [],
    labelId: 'INBOX',
    q: '',
    threads: [],
    nextPageToken: null,
    pagesLoaded: 0,
    listLoading: false,
    listError: null,
    cursor: -1,           // keyboard cursor index in state.threads
    openId: null,         // thread shown in reader
    openThread: null,     // full thread data
    listReq: 0,
    threadReq: 0,
    signInSeq: 0,
    compose: null,        // { mode, threadId, inReplyTo, references, initialBody, attachments, sending }
    pendingOpen: null,    // thread id from a notification that arrived before the mail screen
    toastTimer: null,
    ai: { configured: null, checking: null }, // configured: null = not checked yet
    aiThreads: new Map(), // "threadId:messageCount" -> { replies, repliesLoading, summary, summaryOpen }
    checked: new Set(),   // thread ids ticked in the list (for delete / archive of many at once)
    category: (() => { try { return localStorage.getItem('roost.category') || 'primary'; } catch { return 'primary'; } })(),
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

  function subjectOf(s) { return (s && String(s).trim()) || '(no subject)'; }
  function fromOf(s) { return (s && String(s).trim()) || '(unknown)'; }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function shortDate(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    if (isNaN(d)) return '';
    const now = new Date();
    if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
  }

  function longDate(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    if (isNaN(d)) return '';
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function formatSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function avatarColor(s) {
    let h = 0;
    for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  // Split an address header ("A <a@x>, "B, C" <b@x>") into tokens.
  function splitAddresses(s) {
    const out = [];
    let cur = '';
    let quote = false;
    let angle = 0;
    for (const ch of String(s || '')) {
      if (ch === '"') quote = !quote;
      else if (!quote && ch === '<') angle++;
      else if (!quote && ch === '>') angle = Math.max(0, angle - 1);
      if ((ch === ',' || ch === ';') && !quote && angle === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function emailOf(token) {
    const m = /<([^>]+)>/.exec(token);
    return (m ? m[1] : token).trim().replace(/^mailto:/i, '').toLowerCase();
  }

  function dedupeAddresses(tokens, exclude) {
    const seen = new Set((exclude || []).map((e) => String(e || '').toLowerCase()).filter(Boolean));
    const out = [];
    for (const t of tokens) {
      const e = emailOf(t);
      if (!e || seen.has(e)) continue;
      seen.add(e);
      out.push(t);
    }
    return out;
  }

  function htmlToText(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      doc.querySelectorAll('style, script, head, title').forEach((n) => n.remove());
      doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
      doc.querySelectorAll('p, div, tr, li, h1, h2, h3, h4, h5, h6, blockquote, table').forEach((n) => n.append('\n'));
      const text = (doc.body ? doc.body.textContent : '') || '';
      return text.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } catch (_) {
      return '';
    }
  }

  function messageText(m) {
    if (!m) return '';
    if (m._plain == null) m._plain = m.text != null ? String(m.text) : htmlToText(m.html);
    return m._plain;
  }

  // ---------------------------------------------------------------------------
  // Bridge
  // ---------------------------------------------------------------------------

  async function call(method, args) {
    let r;
    try {
      if (!window.gmail || typeof window.gmail.call !== 'function') {
        return { ok: false, error: 'The Gmail connection is not available.' };
      }
      r = await window.gmail.call(method, args || {});
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

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  const SCREENS = ['screen-loading', 'screen-setup', 'screen-signin', 'screen-mail'];
  let currentScreen = 'screen-loading';

  function showScreen(id) {
    currentScreen = id;
    for (const s of SCREENS) $(s).hidden = s !== id;
  }

  function showLoading(text, withRetry) {
    $('loading-text').textContent = text || 'Loading…';
    $('loading-retry').hidden = !withRetry;
    document.querySelector('#screen-loading .spinner').hidden = !!withRetry;
    showScreen('screen-loading');
  }

  function showSetup(fromSignIn) {
    closeComposeNow();
    $('setup-error').hidden = true;
    $('setup-save').disabled = false;
    $('setup-cancel').hidden = !fromSignIn;
    showScreen('screen-setup');
  }

  function showSignIn(error) {
    closeComposeNow();
    $('signin-idle').hidden = false;
    $('signin-waiting').hidden = true;
    $('signin-error').hidden = !error;
    $('signin-error').textContent = error || '';
    showScreen('screen-signin');
  }

  async function init() {
    showLoading('Loading…');
    call('getView').then((v) => { if (v && v.ok) applyView(v.view); });
    const r = await call('getStatus');
    if (!r.ok) {
      if (!r.needsSetup && !r.needsSignIn) showLoading(errText(r), true);
      return;
    }
    if (!r.configured) return showSetup(false);
    if (!r.signedIn) return showSignIn();
    enterMail(r.email);
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
    const r = await call('signOut');
    if (!r.ok) return toast(errText(r), { error: true });
    resetMailState();
    init();
  }

  function resetMailState() {
    state.email = null;
    state.labels = [];
    state.labelId = 'INBOX';
    state.q = '';
    state.threads = [];
    state.nextPageToken = null;
    state.pagesLoaded = 0;
    state.openId = null;
    state.openThread = null;
    state.cursor = -1;
    state.pendingOpen = null;
    state.aiThreads.clear();
    state.listReq++;
    state.threadReq++;
    $('search-input').value = '';
  }

  // ---------------------------------------------------------------------------
  // Mail screen
  // ---------------------------------------------------------------------------

  function enterMail(email) {
    const changedAccount = state.email && email && state.email !== email;
    if (changedAccount) resetMailState();
    state.email = email || null;
    checkAiStatus();
    const acc = $('account-email');
    acc.textContent = email || '';
    acc.title = email || '';
    const wasMail = currentScreen === 'screen-mail';
    showScreen('screen-mail');
    renderLabels();
    if (!wasMail || changedAccount || !state.pagesLoaded) {
      if (!state.openId) renderReaderEmpty();
      loadList();
    }
    refreshLabels();
    if (state.pendingOpen) {
      const id = state.pendingOpen;
      state.pendingOpen = null;
      openThreadFromNotification(id);
    }
  }

  function openThreadFromNotification(id) {
    if (state.q || state.labelId !== 'INBOX') selectLabel('INBOX');
    openThread(id);
  }

  // ---- Labels ----------------------------------------------------------------

  async function refreshLabels() {
    const r = await call('listLabels');
    if (!r.ok) return;
    state.labels = Array.isArray(r.labels) ? r.labels : [];
    renderLabels();
  }

  function labelById(id) { return state.labels.find((l) => l && l.id === id); }

  function userLabels() {
    return state.labels
      .filter((l) => l && l.id && l.type !== 'system' && !HIDDEN_LABELS.has(l.id) && !/^CATEGORY_/.test(l.id))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  }

  function labelName(id) {
    const sys = SYSTEM_LABELS.find((l) => l.id === id);
    if (sys) return sys.name;
    const l = labelById(id);
    return (l && l.name) || id;
  }

  function renderLabels() {
    const list = $('label-list');
    list.textContent = '';
    const current = state.q ? null : state.labelId;
    for (const sys of SYSTEM_LABELS) {
      const data = labelById(sys.id);
      const count = sys.showCount && data ? Number(data.threadsUnread) || 0 : 0;
      list.appendChild(labelItem(sys.id, sys.name, sys.icon, count, current === sys.id));
    }
    const users = userLabels();
    if (users.length) {
      list.appendChild(el('div', 'label-sep'));
      list.appendChild(el('div', 'label-heading', 'Labels'));
      for (const l of users) {
        list.appendChild(labelItem(l.id, l.name || l.id, 'tag', Number(l.threadsUnread) || 0, current === l.id));
      }
    }
  }

  function labelItem(id, name, iconName, count, selected) {
    const b = el('button', 'label-item' + (selected ? ' selected' : ''));
    b.type = 'button';
    if (selected) b.setAttribute('aria-current', 'page');
    b.appendChild(icon(iconName));
    b.appendChild(el('span', 'label-name', name));
    if (count > 0) b.appendChild(el('span', 'label-count', count > 9999 ? '9999+' : count));
    b.title = name;
    b.addEventListener('click', () => selectLabel(id));
    return b;
  }

  function selectLabel(id) {
    closeDrawer();
    state.labelId = id;
    state.q = '';
    $('search-input').value = '';
    renderLabels();
    loadList();
    if (onePane()) showListPane();
  }

  // ---- Drawer / narrow layout -----------------------------------------------

  function isNarrow() { return window.matchMedia('(max-width: 760px)').matches; }

  // ---- Email view settings (Settings › Email view) ---------------------------
  // pane: where an open email shows (right / below / off = full screen). One pane at a time when "off".
  const LIST_WIDTHS = { narrow: '300px', normal: '380px', wide: '500px' };
  state.view = { pane: 'right', listWidth: 'normal', density: 'comfortable', preview: true, labels: true };

  function applyView(v) {
    state.view = { ...state.view, ...(v || {}) };
    const s = $('screen-mail');
    for (const p of ['right', 'below', 'off']) s.classList.toggle('pane-' + p, state.view.pane === p);
    s.classList.toggle('density-compact', state.view.density === 'compact');
    s.classList.toggle('no-preview', !state.view.preview);
    s.classList.toggle('labels-hidden', !state.view.labels);
    s.style.setProperty('--list-w', LIST_WIDTHS[state.view.listWidth] || LIST_WIDTHS.normal);
    if (state.view.pane === 'off' || onePane()) s.classList.remove('list-collapsed');
  }

  // One pane at a time: a narrow window, or "full screen" emails.
  function onePane() { return isNarrow() || state.view.pane === 'off'; }

  function toggleListCollapsed() {
    if (!state.openId || onePane()) return;
    $('screen-mail').classList.toggle('list-collapsed');
    rerenderToolbar();
  }

  function openDrawer() {
    $('screen-mail').classList.add('drawer-open');
    $('drawer-backdrop').hidden = false;
  }

  function closeDrawer() {
    $('screen-mail').classList.remove('drawer-open');
    $('drawer-backdrop').hidden = true;
  }

  function showListPane() { $('screen-mail').classList.remove('reading'); }
  function showReaderPane() { $('screen-mail').classList.add('reading'); }

  // ---- Thread list ------------------------------------------------------------

  const CATEGORIES = [
    { id: 'primary', name: 'Primary', color: '#7c6cff' },
    { id: 'promotions', name: 'Promotions', color: '#3fb26b' },
    { id: 'social', name: 'Social', color: '#3a86ff' },
    { id: 'updates', name: 'Updates', color: '#f08a24' },
    { id: 'forums', name: 'Forums', color: '#c05bd6' },
  ];
  const inTabs = () => !state.q && state.labelId === 'INBOX';

  function renderTabs() {
    const nav = $('cat-tabs');
    nav.hidden = !inTabs();
    if (nav.hidden) return;
    nav.textContent = '';
    for (const c of CATEGORIES) {
      const b = el('button', 'cat-tab' + (c.id === state.category ? ' on' : ''));
      b.type = 'button';
      b.dataset.cat = c.id;
      b.setAttribute('aria-pressed', String(c.id === state.category));
      const dot = el('span', 'cat-dot');
      dot.style.color = c.color;
      b.append(dot, document.createTextNode(c.name));
      b.addEventListener('click', () => selectCategory(c.id));
      nav.appendChild(b);
    }
  }

  function selectCategory(id) {
    if (!CATEGORIES.some((c) => c.id === id)) return;
    state.category = id;
    try { localStorage.setItem('roost.category', id); } catch { /* private storage off */ }
    loadList();
  }

  function listArgs(pageToken) {
    const args = {};
    if (state.q) args.q = state.q;
    else if (state.labelId && state.labelId !== 'ALL') args.labelId = state.labelId;
    if (inTabs()) args.category = state.category;
    if (pageToken) args.pageToken = pageToken;
    return args;
  }

  function renderListHeader() {
    renderTabs();
    $('list-title').textContent = state.q ? 'Search results' : labelName(state.labelId);
    $('list-sub').textContent = state.q ? '“' + state.q + '”' : '';
  }

  async function loadList() {
    const req = ++state.listReq;
    state.listLoading = true;
    state.listError = null;
    state.threads = [];
    state.nextPageToken = null;
    state.pagesLoaded = 0;
    state.cursor = -1;
    state.checked.clear();
    renderListHeader();
    renderList();
    const r = await call('listThreads', listArgs());
    if (req !== state.listReq) return;
    state.listLoading = false;
    if (!r.ok) {
      state.listError = errText(r);
      renderList();
      return;
    }
    state.threads = Array.isArray(r.threads) ? r.threads.filter(Boolean) : [];
    state.nextPageToken = r.nextPageToken || null;
    state.pagesLoaded = 1;
    state.cursor = indexOfThread(state.openId);
    renderList();
    $('thread-list').scrollTop = 0;
  }

  async function loadMore(btn) {
    if (!state.nextPageToken) return;
    const req = state.listReq;
    btn.disabled = true;
    btn.textContent = 'Loading…';
    const r = await call('listThreads', listArgs(state.nextPageToken));
    if (req !== state.listReq) return;
    if (!r.ok) {
      btn.disabled = false;
      btn.textContent = 'Load more';
      return toast(errText(r), { error: true });
    }
    const have = new Set(state.threads.map((t) => t.id));
    for (const t of r.threads || []) if (t && !have.has(t.id)) state.threads.push(t);
    state.nextPageToken = r.nextPageToken || null;
    state.pagesLoaded++;
    renderList();
  }

  // Quiet refresh (after "changed" events, sends, undo): keeps scroll, selection and extra pages.
  async function refreshListQuietly() {
    if (currentScreen !== 'screen-mail' || state.listLoading) return;
    const req = ++state.listReq;
    const r = await call('listThreads', listArgs());
    if (req !== state.listReq || !r.ok) return;
    const fresh = Array.isArray(r.threads) ? r.threads.filter(Boolean) : [];
    const freshIds = new Set(fresh.map((t) => t.id));
    let merged = fresh;
    if (state.pagesLoaded > 1) {
      // Keep threads loaded from later pages that are not in the new first page.
      const firstPageLen = Math.max(fresh.length, 1);
      const older = state.threads.slice(firstPageLen).filter((t) => !freshIds.has(t.id));
      merged = fresh.concat(older);
    } else {
      state.nextPageToken = r.nextPageToken || null;
      state.pagesLoaded = 1;
    }
    const prevOpen = state.openId ? state.threads.find((t) => t.id === state.openId) : null;
    const nowOpen = state.openId ? merged.find((t) => t.id === state.openId) : null;
    const list = $('thread-list');
    const scroll = list.scrollTop;
    state.threads = merged;
    state.cursor = state.openId ? indexOfThread(state.openId) : Math.min(state.cursor, merged.length - 1);
    renderList();
    list.scrollTop = scroll;
    // A new reply arrived in the open thread: reload it quietly.
    if (prevOpen && nowOpen && Number(nowOpen.messageCount) !== Number(prevOpen.messageCount)) {
      openThread(state.openId, { quiet: true });
    }
  }

  function indexOfThread(id) {
    if (!id) return -1;
    return state.threads.findIndex((t) => t.id === id);
  }

  function renderList() {
    const list = $('thread-list');
    list.textContent = '';
    const ids = new Set(state.threads.map((t) => t.id));
    for (const id of [...state.checked]) if (!ids.has(id)) state.checked.delete(id);
    renderBulkBar();
    if (state.listLoading) {
      list.setAttribute('aria-busy', 'true');
      for (let i = 0; i < 8; i++) {
        const s = el('div', 'skeleton');
        s.append(el('i'), el('i'), el('i'));
        list.appendChild(s);
      }
      return;
    }
    list.removeAttribute('aria-busy');
    if (state.listError) {
      const box = el('div', 'list-state');
      box.appendChild(el('p', null, state.listError));
      box.appendChild(textButton(null, 'Try again', () => loadList()));
      list.appendChild(box);
      return;
    }
    if (!state.threads.length) {
      const tabName = inTabs() && (CATEGORIES.find((c) => c.id === state.category) || {}).name;
      const msg = state.q ? 'No messages match your search.' : 'No conversations in ' + (tabName || labelName(state.labelId)) + '.';
      list.appendChild(el('div', 'list-state', msg));
      return;
    }
    state.threads.forEach((t, i) => list.appendChild(threadRow(t, i)));
    if (state.nextPageToken) {
      const more = textButton(null, 'Load more', () => loadMore(more), 'load-more');
      list.appendChild(more);
    }
  }

  function threadRow(t, index) {
    const row = el('div', 'row');
    row.setAttribute('role', 'listitem');
    row.dataset.id = t.id;
    if (t.unread) row.classList.add('unread');
    if (t.id === state.openId) row.classList.add('selected');
    if (index === state.cursor) row.classList.add('cursor');

    const open = el('button', 'row-open');
    open.type = 'button';
    const line1 = el('span', 'row-line');
    line1.appendChild(el('span', 'row-from', fromOf(t.from)));
    if (Number(t.messageCount) > 1) line1.appendChild(el('span', 'row-count', t.messageCount));
    if (t.hasAttachments) {
      const clip = el('span', 'row-clip');
      clip.title = 'Has attachments';
      clip.appendChild(icon('clip'));
      line1.appendChild(clip);
    }
    line1.appendChild(el('span', 'row-date', shortDate(t.date)));
    open.appendChild(line1);
    open.appendChild(el('span', 'row-subject', subjectOf(t.subject)));
    if (t.snippet) open.appendChild(el('span', 'row-snippet', t.snippet));
    else open.appendChild(el('span', 'row-snippet', '\u00a0'));
    open.setAttribute('aria-label', (t.unread ? 'Unread. ' : '') + fromOf(t.from) + '. ' + subjectOf(t.subject) + '. ' + shortDate(t.date));
    open.addEventListener('click', () => { state.cursor = index; openThread(t.id); });
    row.appendChild(open);

    const check = el('input', 'row-check');
    check.type = 'checkbox';
    check.checked = state.checked.has(t.id);
    check.title = 'Select';
    check.setAttribute('aria-label', 'Select ' + subjectOf(t.subject));
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => toggleChecked(t.id, check.checked));
    if (check.checked) row.classList.add('checked');
    row.appendChild(check);

    // Quick actions on hover: no need to open the email first.
    const actions = el('div', 'row-actions');
    if ((t.labelIds || []).includes('INBOX')) {
      actions.appendChild(iconButton('archive', 'Archive', (e) => { e.stopPropagation(); archiveIds([t.id]); }));
    }
    if (state.labelId !== 'TRASH' || state.q) {
      actions.appendChild(iconButton('trash', 'Delete', (e) => { e.stopPropagation(); trashIds([t.id]); }, { cls: 'danger' }));
    }
    row.appendChild(actions);

    const star = iconButton('star', t.starred ? 'Unstar' : 'Star', (e) => {
      e.stopPropagation();
      toggleStar(t.id);
    }, { cls: 'row-star' + (t.starred ? ' active' : ''), filled: t.starred });
    row.appendChild(star);
    return row;
  }

  function updateRow(id) {
    const i = indexOfThread(id);
    const old = $('thread-list').querySelector('.row[data-id="' + cssEscape(id) + '"]');
    if (i < 0 || !old) return;
    old.replaceWith(threadRow(state.threads[i], i));
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&');
  }

  function markSelectedRows() {
    $('thread-list').querySelectorAll('.row').forEach((r) => {
      r.classList.toggle('selected', r.dataset.id === state.openId);
    });
  }

  function moveCursor(delta) {
    if (!state.threads.length) return;
    const base = state.openId ? indexOfThread(state.openId) : state.cursor;
    let next = base < 0 ? (delta > 0 ? 0 : state.threads.length - 1) : base + delta;
    next = Math.max(0, Math.min(state.threads.length - 1, next));
    state.cursor = next;
    const t = state.threads[next];
    // Conversation open: j/k open the neighbour directly (like Gmail). Otherwise move the cursor.
    if (state.openId && !isNarrowList()) {
      openThread(t.id);
    } else {
      $('thread-list').querySelectorAll('.row').forEach((r, i) => r.classList.toggle('cursor', i === next));
    }
    const row = $('thread-list').querySelectorAll('.row')[next];
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function isNarrowList() { return onePane() && !$('screen-mail').classList.contains('reading'); }

  function openCursor() {
    const t = state.threads[state.cursor];
    if (t) openThread(t.id);
  }

  // ---- Search -------------------------------------------------------------------

  function onSearch(e) {
    e.preventDefault();
    const q = $('search-input').value.trim();
    if (!q && !state.q) return;
    state.q = q;
    renderLabels();
    loadList();
    if (onePane()) showListPane();
  }

  function clearSearch() {
    const input = $('search-input');
    const had = !!state.q;
    input.value = '';
    state.q = '';
    input.blur();
    if (had) { renderLabels(); loadList(); }
  }

  // ---------------------------------------------------------------------------
  // Reader
  // ---------------------------------------------------------------------------

  function renderReaderEmpty(text) {
    const r = $('reader');
    r.textContent = '';
    const box = el('div', 'reader-empty');
    box.appendChild(icon('mail'));
    box.appendChild(el('div', null, text || 'No conversation selected'));
    r.appendChild(box);
  }

  function renderReaderLoading(t) {
    const r = $('reader');
    r.textContent = '';
    r.appendChild(buildToolbar(t || { id: state.openId, labelIds: [] }, true));
    const head = el('div', 'thread-head');
    head.appendChild(el('h1', 'thread-subject', t ? subjectOf(t.subject) : ''));
    r.appendChild(head);
    const box = el('div', 'list-state');
    box.appendChild(el('div', 'spinner'));
    r.appendChild(box);
  }

  function closeReader() {
    state.threadReq++;
    state.openId = null;
    state.openThread = null;
    renderReaderEmpty();
    markSelectedRows();
    $('screen-mail').classList.remove('list-collapsed');
    showListPane();
  }

  async function openThread(id, opts = {}) {
    if (!id) return;
    const req = ++state.threadReq;
    const row = state.threads.find((t) => t.id === id);
    state.openId = id;
    if (!opts.quiet) {
      state.openThread = null;
      const idx = indexOfThread(id);
      if (idx >= 0) state.cursor = idx;
      markSelectedRows();
      renderReaderLoading(row);
      showReaderPane();
      $('reader').scrollTop = 0;
    }
    const r = await call('getThread', { id });
    if (req !== state.threadReq) return; // user moved on
    if (!r.ok || !r.thread) {
      if (opts.quiet) return;
      const reader = $('reader');
      reader.textContent = '';
      reader.appendChild(buildToolbar({ id, labelIds: [] }, true));
      const box = el('div', 'list-state');
      box.appendChild(el('p', null, errText(r)));
      box.appendChild(textButton(null, 'Try again', () => openThread(id)));
      reader.appendChild(box);
      return;
    }
    const thread = r.thread;
    thread.messages = Array.isArray(thread.messages) ? thread.messages.filter(Boolean) : [];
    thread.labelIds = Array.isArray(thread.labelIds) ? thread.labelIds : [];
    const scroll = opts.quiet ? $('reader').scrollTop : 0;
    state.openThread = thread;
    renderThread(thread);
    if (opts.quiet) $('reader').scrollTop = scroll;
    else scrollToLatest();

    const isUnread = (row && row.unread) || thread.labelIds.includes('UNREAD') || thread.messages.some((m) => m.unread);
    if (isUnread) markRead(id);
  }

  function scrollToLatest() {
    const reader = $('reader');
    const cards = reader.querySelectorAll('.msg');
    if (cards.length > 1) {
      const last = cards[cards.length - 1];
      reader.scrollTop = Math.max(0, last.offsetTop - 120);
    } else reader.scrollTop = 0;
  }

  async function markRead(id) {
    setRowFlag(id, 'unread', false);
    const r = await call('modifyThread', { id, add: [], remove: ['UNREAD'] });
    if (!r.ok) {
      setRowFlag(id, 'unread', true);
      return;
    }
    if (state.openThread && state.openThread.id === id) {
      state.openThread.labelIds = state.openThread.labelIds.filter((l) => l !== 'UNREAD');
    }
    refreshLabels();
  }

  function setRowFlag(id, key, value) {
    const t = state.threads.find((x) => x.id === id);
    if (!t) return;
    t[key] = value;
    updateRow(id);
  }

  function threadIsStarred(thread) {
    const row = state.threads.find((t) => t.id === thread.id);
    if (row) return !!row.starred;
    return (thread.labelIds || []).includes('STARRED');
  }

  function threadInInbox(thread) {
    const row = state.threads.find((t) => t.id === thread.id);
    const ids = (thread.labelIds && thread.labelIds.length) ? thread.labelIds : (row && row.labelIds) || [];
    return ids.includes('INBOX');
  }

  function buildToolbar(thread, disabled) {
    const bar = el('div', 'reader-toolbar');
    bar.appendChild(iconButton('back', 'Back to list (u)', () => closeReader(), { cls: 'back-btn' }));
    const add = (b) => { if (disabled) b.disabled = true; bar.appendChild(b); return b; };
    const inInbox = threadInInbox(thread);
    if (inInbox || disabled) add(iconButton('archive', 'Archive (e)', () => archiveOpen()));
    else add(iconButton('inbox', 'Move to Inbox', () => moveOpenToInbox()));
    add(iconButton('trash', 'Delete (#)', () => trashOpen()));
    add(iconButton('unread', 'Mark as unread (⇧U)', () => markOpenUnread()));
    const starred = !disabled && threadIsStarred(thread);
    add(iconButton('star', starred ? 'Unstar (s)' : 'Star (s)', () => toggleStar(thread.id), { cls: starred ? 'active' : '', filled: starred }));
    add(iconButton('sparkle', 'Summarize this conversation', () => summarizeOpen(), { cls: 'ai-summarize-btn', title: 'Summarize (AI)' }));
    bar.appendChild(el('span', 'spacer'));
    if (!onePane()) {
      const collapsed = $('screen-mail').classList.contains('list-collapsed');
      add(iconButton(collapsed ? 'collapse' : 'expand', collapsed ? 'Show the list (\\)' : 'Full view: hide the list (\\)', () => toggleListCollapsed(), { cls: 'view-btn' }));
    }
    add(iconButton('reply', 'Reply (r)', () => startReply('reply')));
    add(iconButton('replyAll', 'Reply all (a)', () => startReply('replyAll')));
    add(iconButton('forward', 'Forward (f)', () => startReply('forward')));
    return bar;
  }

  function rerenderToolbar() {
    const t = state.openThread;
    const old = $('reader').querySelector('.reader-toolbar');
    if (t && old) old.replaceWith(buildToolbar(t, false));
  }

  function renderThread(thread) {
    const reader = $('reader');
    reader.textContent = '';
    reader.appendChild(buildToolbar(thread, false));

    const head = el('div', 'thread-head');
    const subject = subjectOf(thread.subject || (thread.messages[0] && thread.messages[0].subject));
    head.appendChild(el('h1', 'thread-subject', subject));
    const visibleLabels = (thread.labelIds || [])
      .filter((l) => !HIDDEN_LABELS.has(l) && !/^CATEGORY_/.test(l) && l !== 'STARRED')
      .map(labelName);
    const n = thread.messages.length;
    head.appendChild(el('div', 'thread-meta', [n + (n === 1 ? ' message' : ' messages')].concat(visibleLabels).join(' · ')));
    reader.appendChild(head);
    renderSummaryCard(thread);

    const list = el('div', 'messages');
    if (!n) list.appendChild(el('div', 'msg-empty', 'This conversation has no messages.'));
    thread.messages.forEach((m, i) => {
      const expanded = i === n - 1 || !!m.unread;
      list.appendChild(messageCard(m, expanded));
    });
    reader.appendChild(list);

    if (n) {
      const chips = el('div', 'smart-replies');
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', 'Suggested replies');
      chips.hidden = true;
      reader.appendChild(chips);
      loadSmartReplies(thread);
      const bar = el('div', 'reply-bar');
      bar.appendChild(textButton('reply', 'Reply', () => startReply('reply')));
      bar.appendChild(textButton('replyAll', 'Reply all', () => startReply('replyAll')));
      bar.appendChild(textButton('forward', 'Forward', () => startReply('forward')));
      reader.appendChild(bar);
    }
  }

  function messageCard(m, expanded) {
    const card = el('article', 'msg');
    const headBtn = el('button', 'msg-head');
    headBtn.type = 'button';
    headBtn.setAttribute('aria-expanded', String(expanded));

    const name = fromOf(m.from);
    const av = el('span', 'avatar', (name.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase());
    av.style.background = avatarColor(m.fromEmail || name);
    av.setAttribute('aria-hidden', 'true');
    headBtn.appendChild(av);

    const who = el('span', 'msg-who');
    const fromLine = el('span', 'msg-from');
    fromLine.appendChild(el('strong', null, name));
    if (m.fromEmail && m.fromEmail.toLowerCase() !== name.toLowerCase()) {
      fromLine.appendChild(el('span', 'email', '<' + m.fromEmail + '>'));
    }
    who.appendChild(fromLine);
    const toLine = el('span', 'msg-to');
    const snip = el('span', 'msg-snippet');
    who.appendChild(toLine);
    who.appendChild(snip);
    headBtn.appendChild(who);
    headBtn.appendChild(el('span', 'msg-date', expanded ? longDate(m.date) : shortDate(m.date)));
    headBtn.lastChild.title = longDate(m.date);
    card.appendChild(headBtn);

    const body = el('div', 'msg-body');
    card.appendChild(body);

    const parts = [];
    if (m.to) parts.push('to ' + m.to);
    if (m.cc) parts.push('cc ' + m.cc);
    toLine.textContent = parts.join('  ·  ');
    toLine.title = toLine.textContent;

    let built = false;
    const setExpanded = (on) => {
      card.classList.toggle('collapsed', !on);
      headBtn.setAttribute('aria-expanded', String(on));
      toLine.hidden = !on || !parts.length;
      snip.hidden = on;
      body.hidden = !on;
      headBtn.lastChild.textContent = on ? longDate(m.date) : shortDate(m.date);
      if (!on && !snip.textContent) snip.textContent = messageText(m).replace(/\s+/g, ' ').slice(0, 200) || '\u00a0';
      if (on && !built) { built = true; buildMessageBody(m, body); }
    };
    headBtn.addEventListener('click', () => setExpanded(card.classList.contains('collapsed')));
    setExpanded(expanded);
    return card;
  }

  function buildMessageBody(m, body) {
    body.textContent = '';
    if (m.html != null && String(m.html).trim()) {
      renderHtmlBody(m, body, true); // images show by default (scripts stay blocked)
    } else if (m.text != null && String(m.text).trim()) {
      body.appendChild(renderTextBody(String(m.text)));
    } else {
      body.appendChild(el('div', 'msg-empty', '(This message has no text.)'));
    }
    const atts = Array.isArray(m.attachments) ? m.attachments.filter(Boolean) : [];
    if (atts.length) {
      const chips = el('div', 'chips');
      for (const a of atts) chips.appendChild(attachmentChip(m, a));
      body.appendChild(chips);
    }
  }

  function renderTextBody(text) {
    const div = el('div', 'msg-text');
    let last = 0;
    URL_RE.lastIndex = 0;
    let match;
    while ((match = URL_RE.exec(text))) {
      if (match.index > last) div.appendChild(document.createTextNode(text.slice(last, match.index)));
      const url = match[0];
      const a = el('a', null, url);
      a.href = url;
      a.addEventListener('click', (e) => { e.preventDefault(); openExternal(url); });
      div.appendChild(a);
      last = match.index + url.length;
    }
    if (last < text.length) div.appendChild(document.createTextNode(text.slice(last)));
    return div;
  }

  function buildSrcdoc(html, allowImages) {
    const img = allowImages ? 'data: cid: https: http:' : 'data: cid:';
    return '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src ' + img + '; font-src data:">' +
      '<base target="_blank">' +
      '<style>html,body{margin:0;background:#fff;color:#1d1d22;}' +
      'body{padding:16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;word-wrap:break-word;overflow-wrap:break-word;}' +
      'html,body{height:auto !important;min-height:0 !important;}html{overflow-y:hidden !important;}' +
      'img{max-width:100%;height:auto;}table{max-width:100%;}pre{white-space:pre-wrap;}' +
      'blockquote{margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555;}</style>' +
      html;
  }

  function renderHtmlBody(m, body, allowImages) {
    const html = String(m.html);
    const hasRemote = REMOTE_IMG_RE.test(html);
    const holder = el('div');
    if (hasRemote && !allowImages) {
      const bar = el('div', 'images-bar');
      bar.appendChild(el('span', null, 'Images are hidden to protect your privacy.'));
      const btn = el('button', 'link-btn small', 'Show images');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        holder.replaceWith(renderHtmlBody(m, null, true));
      });
      bar.appendChild(btn);
      holder.appendChild(bar);
    }
    const wrap = el('div', 'msg-frame-wrap');
    const frame = document.createElement('iframe');
    frame.className = 'msg-frame';
    frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.setAttribute('title', 'Message from ' + fromOf(m.from));
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.addEventListener('load', () => onFrameLoad(frame));
    frame.srcdoc = buildSrcdoc(html, allowImages);
    wrap.appendChild(frame);
    holder.appendChild(wrap);
    if (body) body.appendChild(holder);
    return holder;
  }

  function measureFrame(frame) {
    // Guard against pages that keep growing with their viewport.
    frame._measures = (frame._measures || 0) + 1;
    if (frame._measures > 40) return;
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.documentElement) return;
      const h = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
      if (h && Math.abs(h - frame.offsetHeight) > 1) frame.style.height = h + 'px';
    } catch (_) { /* ignore */ }
  }

  function onFrameLoad(frame) {
    let doc;
    try { doc = frame.contentDocument; } catch (_) { return; }
    if (!doc) return;
    measureFrame(frame);
    // Re-measure as images and fonts arrive.
    doc.querySelectorAll('img').forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', () => measureFrame(frame));
        img.addEventListener('error', () => measureFrame(frame));
      }
    });
    [100, 400, 1200].forEach((ms) => setTimeout(() => measureFrame(frame), ms));
    try {
      if (window.ResizeObserver && doc.body) new ResizeObserver(() => measureFrame(frame)).observe(doc.body);
    } catch (_) { /* ignore */ }
    // Links: open in the user's browser.
    const onLink = (e) => {
      if (e.type === 'auxclick' && e.button !== 1) return;
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) return;
      e.preventDefault();
      openExternal(a.href);
    };
    doc.addEventListener('click', onLink);
    doc.addEventListener('auxclick', onLink);
    // Shortcuts keep working while the email has focus.
    doc.addEventListener('keydown', onKeyDown);
  }

  window.addEventListener('resize', () => {
    document.querySelectorAll('.msg-frame').forEach((f) => {
      f._measures = 0;
      f.style.height = '60px';
      measureFrame(f);
    });
  });

  function attachmentChip(m, a) {
    const chip = el('button', 'chip');
    chip.type = 'button';
    const name = a.filename || 'attachment';
    chip.title = 'Download ' + name;
    chip.appendChild(icon('download'));
    chip.appendChild(el('span', 'chip-name', name));
    if (a.size) chip.appendChild(el('span', 'chip-size', formatSize(a.size)));
    chip.addEventListener('click', async () => {
      chip.disabled = true;
      const r = await call('downloadAttachment', { messageId: m.id, attachmentId: a.id, filename: name });
      chip.disabled = false;
      if (r.ok) toast('Saved ' + name);
      else if (r.error !== 'cancelled') toast(errText(r), { error: true });
    });
    return chip;
  }

  // ---------------------------------------------------------------------------
  // Thread actions
  // ---------------------------------------------------------------------------

  // Removes the thread row and opens the next one (or the empty view).
  // ---- Many at once: ticked rows, and the quick buttons on each row ---------------

  function toggleChecked(id, on) {
    if (on) state.checked.add(id); else state.checked.delete(id);
    const row = $('thread-list').querySelector('.row[data-id="' + cssEscape(id) + '"]');
    if (row) {
      row.classList.toggle('checked', on);
      const box = row.querySelector('.row-check');
      if (box) box.checked = on;
    }
    renderBulkBar();
  }

  function renderBulkBar() {
    let bar = $('bulk-bar');
    if (!bar) {
      bar = el('div', 'bulk-bar');
      bar.id = 'bulk-bar';
      $('thread-list').parentNode.insertBefore(bar, $('thread-list'));
    }
    const n = state.checked.size;
    $('screen-mail').classList.toggle('checking', n > 0);
    bar.hidden = n === 0;
    bar.textContent = '';
    if (!n) return;
    const all = el('input', 'bulk-all');
    all.type = 'checkbox';
    all.title = 'Select all';
    all.setAttribute('aria-label', 'Select all');
    all.checked = n === state.threads.length;
    all.indeterminate = n > 0 && n < state.threads.length;
    all.addEventListener('change', () => {
      if (all.checked) state.threads.forEach((t) => state.checked.add(t.id)); else state.checked.clear();
      renderList();
    });
    bar.appendChild(all);
    bar.appendChild(el('span', 'bulk-count', n + ' selected'));
    const ids = () => [...state.checked];
    const anyInbox = state.threads.some((t) => state.checked.has(t.id) && (t.labelIds || []).includes('INBOX'));
    if (anyInbox) bar.appendChild(iconButton('archive', 'Archive selected', () => archiveIds(ids())));
    if (state.labelId !== 'TRASH' || state.q) bar.appendChild(iconButton('trash', 'Delete selected', () => trashIds(ids()), { cls: 'danger' }));
    bar.appendChild(iconButton('unread', 'Mark selected as read', () => markReadIds(ids())));
    bar.appendChild(textButton(null, 'Clear', () => { state.checked.clear(); renderList(); }, 'bulk-clear'));
  }

  // Run one call per thread, 5 at a time. Returns the ids that worked.
  async function eachThread(ids, method, args) {
    const done = [];
    let fail = null;
    const queue = ids.slice();
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        const r = await call(method, { id, ...args });
        if (r.ok) done.push(id); else fail = r;
      }
    };
    await Promise.all([0, 1, 2, 3, 4].map(worker));
    if (fail) toast(errText(fail), { error: true });
    return done;
  }

  // Take rows out of the list. If the open email goes, open the next one (or close the reader).
  function dropRows(ids) {
    if (ids.length === 1 && ids[0] === state.openId) { state.checked.delete(ids[0]); removeAndAdvance(ids[0]); return; }
    const gone = new Set(ids);
    const openGone = state.openId && gone.has(state.openId);
    state.threads = state.threads.filter((t) => !gone.has(t.id));
    for (const id of ids) state.checked.delete(id);
    if (openGone) closeReader();
    state.cursor = Math.min(state.cursor, state.threads.length - 1);
    renderList();
  }

  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  async function trashIds(ids) {
    if (!ids.length) return;
    const done = await eachThread(ids, 'trashThread', {});
    if (!done.length) return;
    dropRows(done);
    toast(done.length === 1 ? 'Moved to Trash' : plural(done.length, 'conversation') + ' moved to Trash');
    refreshLabels();
  }

  async function archiveIds(ids) {
    if (!ids.length) return;
    const done = await eachThread(ids, 'modifyThread', { add: [], remove: ['INBOX'] });
    if (!done.length) return;
    if (state.labelId === 'INBOX' && !state.q) dropRows(done);
    else {
      for (const t of state.threads) if (done.includes(t.id)) t.labelIds = (t.labelIds || []).filter((l) => l !== 'INBOX');
      done.forEach((id) => state.checked.delete(id));
      renderList();
    }
    toast(done.length === 1 ? 'Archived' : plural(done.length, 'conversation') + ' archived', {
      action: 'Undo',
      onAction: async () => {
        const back = await eachThread(done, 'modifyThread', { add: ['INBOX'], remove: [] });
        if (back.length) toast('Moved back to Inbox');
        refreshListQuietly();
        refreshLabels();
      },
    });
    refreshLabels();
  }

  async function markReadIds(ids) {
    const done = await eachThread(ids, 'modifyThread', { add: [], remove: ['UNREAD'] });
    for (const t of state.threads) if (done.includes(t.id)) t.unread = false;
    done.forEach((id) => state.checked.delete(id));
    renderList();
    if (done.length) toast(plural(done.length, 'conversation') + ' marked as read');
    refreshLabels();
  }

  function removeAndAdvance(id) {
    const i = indexOfThread(id);
    if (i >= 0) state.threads.splice(i, 1);
    const rowEl = $('thread-list').querySelector('.row[data-id="' + cssEscape(id) + '"]');
    const next = i >= 0 ? state.threads[i] : null;
    const finish = () => {
      renderList();
      if (state.openId === id || state.openId == null) {
        if (next && !onePane()) openThread(next.id);
        else { state.cursor = next ? i : -1; closeReader(); renderList(); }
      }
    };
    if (rowEl) {
      rowEl.classList.add('removing');
      rowEl.style.maxHeight = rowEl.offsetHeight + 'px';
      setTimeout(finish, 180);
    } else finish();
  }

  async function archiveOpen() {
    const t = state.openThread;
    if (!t) return;
    const id = t.id;
    const r = await call('modifyThread', { id, add: [], remove: ['INBOX'] });
    if (!r.ok) return toast(errText(r), { error: true });
    t.labelIds = t.labelIds.filter((l) => l !== 'INBOX');
    const row = state.threads.find((x) => x.id === id);
    if (row && Array.isArray(row.labelIds)) row.labelIds = row.labelIds.filter((l) => l !== 'INBOX');
    if (state.labelId === 'INBOX' && !state.q) removeAndAdvance(id);
    else rerenderToolbar();
    toast('Archived', {
      action: 'Undo',
      onAction: async () => {
        const u = await call('modifyThread', { id, add: ['INBOX'], remove: [] });
        if (!u.ok) return toast(errText(u), { error: true });
        toast('Moved back to Inbox');
        refreshListQuietly();
        refreshLabels();
        if (state.openThread && state.openThread.id === id) {
          state.openThread.labelIds.push('INBOX');
          rerenderToolbar();
        }
      },
    });
    refreshLabels();
  }

  async function trashOpen() {
    const t = state.openThread;
    if (!t) return;
    const id = t.id;
    const r = await call('trashThread', { id });
    if (!r.ok) return toast(errText(r), { error: true });
    if (state.labelId === 'TRASH' && !state.q) rerenderToolbar();
    else removeAndAdvance(id);
    toast('Moved to Trash');
    refreshLabels();
  }

  async function moveOpenToInbox() {
    const t = state.openThread;
    if (!t) return;
    const remove = t.labelIds.includes('SPAM') ? ['SPAM'] : [];
    const r = await call('modifyThread', { id: t.id, add: ['INBOX'], remove });
    if (!r.ok) return toast(errText(r), { error: true });
    t.labelIds = t.labelIds.filter((l) => !remove.includes(l)).concat('INBOX');
    const row = state.threads.find((x) => x.id === t.id);
    if (row) row.labelIds = (row.labelIds || []).filter((l) => !remove.includes(l)).concat('INBOX');
    toast('Moved to Inbox');
    if (state.labelId === 'SPAM' && !state.q) removeAndAdvance(t.id);
    else rerenderToolbar();
    refreshLabels();
  }

  async function markOpenUnread() {
    const t = state.openThread;
    if (!t) return;
    const id = t.id;
    const r = await call('modifyThread', { id, add: ['UNREAD'], remove: [] });
    if (!r.ok) return toast(errText(r), { error: true });
    setRowFlag(id, 'unread', true);
    closeReader();
    state.cursor = indexOfThread(id);
    renderList();
    refreshLabels();
  }

  async function toggleStar(id) {
    const row = state.threads.find((t) => t.id === id);
    const open = state.openThread && state.openThread.id === id ? state.openThread : null;
    const starred = row ? !!row.starred : !!(open && open.labelIds.includes('STARRED'));
    const want = !starred;
    if (row) setRowFlag(id, 'starred', want);
    if (open) {
      open.labelIds = open.labelIds.filter((l) => l !== 'STARRED');
      if (want) open.labelIds.push('STARRED');
      rerenderToolbar();
    }
    const r = await call('modifyThread', want ? { id, add: ['STARRED'], remove: [] } : { id, add: [], remove: ['STARRED'] });
    if (!r.ok) {
      if (row) setRowFlag(id, 'starred', starred);
      if (open) {
        open.labelIds = open.labelIds.filter((l) => l !== 'STARRED');
        if (starred) open.labelIds.push('STARRED');
        rerenderToolbar();
      }
      toast(errText(r), { error: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Compose
  // ---------------------------------------------------------------------------

  function openCompose(opts = {}) {
    const c = {
      mode: opts.mode || 'new',
      threadId: opts.threadId || null,
      inReplyTo: opts.inReplyTo || null,
      references: opts.references || null,
      attachments: [],
      sending: false,
      initialBody: opts.initialBody != null ? opts.initialBody : (opts.body || ''),
      // The quoted / forwarded part that AI tools keep as is (they only touch the text above it).
      quote: opts.mode && opts.mode !== 'new' ? String(opts.initialBody != null ? opts.initialBody : (opts.body || '')).replace(/^\s+/, '') : '',
      thread: opts.thread || null, // conversation context for AI calls
      ai: { seq: 0, busy: false, mode: null },
    };
    closeAiPanel(true);
    state.compose = c;
    $('compose-title').textContent = { new: 'New message', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward' }[c.mode] || 'New message';
    $('compose-to').value = opts.to || '';
    $('compose-cc').value = opts.cc || '';
    $('compose-bcc').value = '';
    $('compose-subject').value = opts.subject || '';
    $('compose-body').value = opts.body || '';
    $('compose-body').readOnly = false;
    const showCc = !!opts.cc;
    $('compose-cc-row').hidden = !showCc;
    $('compose-bcc-row').hidden = !showCc;
    $('compose-error').hidden = true;
    $('compose-send').disabled = false;
    renderComposeAttachments();
    updateAiButton();
    $('compose').hidden = false;
    $('screen-mail').classList.add('composing');
    closeDrawer();
    const focusEl = !opts.to ? $('compose-to') : $('compose-body');
    focusEl.focus();
    if (focusEl === $('compose-body')) {
      const at = opts.cursorAt || 0;
      focusEl.setSelectionRange(at, at);
      focusEl.scrollTop = 0;
    }
  }

  function composeDirty() {
    const c = state.compose;
    if (!c) return false;
    return $('compose-body').value !== c.initialBody || c.attachments.length > 0;
  }

  function closeComposeNow() {
    closeAiPanel(true);
    state.compose = null;
    $('compose-body').readOnly = false;
    $('compose').hidden = true;
    $('screen-mail').classList.remove('composing');
  }

  function discardCompose() {
    if (!state.compose) return;
    if (state.compose.sending) return;
    if (composeDirty() && !window.confirm('Discard this message?')) return;
    closeComposeNow();
  }

  function renderComposeAttachments() {
    const box = $('compose-attachments');
    box.textContent = '';
    const c = state.compose;
    if (!c) return;
    c.attachments.forEach((f, i) => {
      const chip = el('span', 'chip');
      chip.appendChild(icon('clip'));
      chip.appendChild(el('span', 'chip-name', f.name || f.path));
      if (f.size) chip.appendChild(el('span', 'chip-size', formatSize(f.size)));
      const x = el('button', 'chip-remove');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remove ' + (f.name || 'attachment'));
      x.appendChild(icon('x'));
      x.addEventListener('click', () => { c.attachments.splice(i, 1); renderComposeAttachments(); });
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  async function onAttach() {
    const c = state.compose;
    if (!c) return;
    const r = await call('pickAttachments');
    if (state.compose !== c) return;
    if (!r.ok) return toast(errText(r), { error: true });
    const have = new Set(c.attachments.map((f) => f.path));
    for (const f of r.files || []) if (f && f.path && !have.has(f.path)) c.attachments.push(f);
    renderComposeAttachments();
  }

  async function onSend(e) {
    e.preventDefault();
    const c = state.compose;
    if (!c || c.sending) return;
    const err = $('compose-error');
    const to = $('compose-to').value.trim();
    if (!to) {
      err.textContent = 'Add at least one recipient.';
      err.hidden = false;
      $('compose-to').focus();
      return;
    }
    err.hidden = true;
    c.sending = true;
    const sendBtn = $('compose-send');
    sendBtn.disabled = true;
    sendBtn.lastChild.textContent = ' Sending…';
    const args = {
      to,
      cc: $('compose-cc').value.trim(),
      bcc: $('compose-bcc').value.trim(),
      subject: $('compose-subject').value,
      body: $('compose-body').value,
      attachments: c.attachments.map((f) => ({ path: f.path })),
    };
    if (c.threadId) args.threadId = c.threadId;
    if (c.inReplyTo) args.inReplyTo = c.inReplyTo;
    if (c.references) args.references = c.references;
    const r = await call('send', args);
    sendBtn.lastChild.textContent = ' Send';
    if (state.compose !== c) return;
    c.sending = false;
    sendBtn.disabled = false;
    if (!r.ok) {
      err.textContent = errText(r);
      err.hidden = false;
      return;
    }
    closeComposeNow();
    toast('Sent');
    if (c.threadId && state.openId === c.threadId) openThread(c.threadId, { quiet: true });
    refreshListQuietly();
  }

  function quoteText(text) {
    return String(text || '').split(/\r?\n/).map((l) => '> ' + l).join('\n');
  }

  function prefixSubject(prefix, subject, re) {
    const s = String(subject || '').trim();
    return re.test(s) ? s : prefix + s;
  }

  function senderLabel(m) {
    const name = fromOf(m.from);
    if (m.fromEmail && m.fromEmail.toLowerCase() !== name.toLowerCase()) return name + ' <' + m.fromEmail + '>';
    return name;
  }

  function startReply(mode, extra = {}) {
    const t = state.openThread;
    if (!t || !t.messages.length) return;
    const m = t.messages[t.messages.length - 1];
    const me = String(state.email || '').toLowerCase();
    const fromMe = !!me && String(m.fromEmail || '').toLowerCase() === me;
    const subject = m.subject || t.subject || '';
    const text = messageText(m);

    if (mode === 'forward') {
      const body = '\n\n---------- Forwarded message ---------\n' +
        'From: ' + senderLabel(m) + '\n' +
        'Date: ' + longDate(m.date) + '\n' +
        'Subject: ' + subjectOf(subject) + '\n' +
        'To: ' + (m.to || '') + '\n' +
        (m.cc ? 'Cc: ' + m.cc + '\n' : '') +
        '\n' + text;
      openCompose({ mode, subject: prefixSubject('Fwd: ', subject, /^(fwd?|fw):/i), body, thread: threadContext(t) });
      return;
    }

    let to;
    if (mode === 'replyAll') {
      const tokens = [m.fromEmail || m.from].concat(splitAddresses(m.to), splitAddresses(m.cc)).filter(Boolean);
      to = dedupeAddresses(tokens, [me]);
      if (!to.length && fromMe) to = dedupeAddresses(splitAddresses(m.to), []);
    } else if (fromMe) {
      // Replying to my own last message: send to its recipients.
      to = dedupeAddresses(splitAddresses(m.to), [me]);
    } else {
      to = m.fromEmail ? [m.fromEmail] : [];
    }
    const body = '\n\nOn ' + longDate(m.date) + ', ' + senderLabel(m) + ' wrote:\n' + quoteText(text);
    const mid = m.messageIdHeader || '';
    const prefill = extra.prefill ? String(extra.prefill) : '';
    openCompose({
      mode,
      to: to.join(', '),
      subject: prefixSubject('Re: ', subject, /^re:/i),
      body: prefill + body,
      initialBody: body,
      cursorAt: prefill.length,
      thread: threadContext(t),
      threadId: t.id,
      inReplyTo: mid || null,
      references: mid ? (m.references ? m.references + ' ' : '') + mid : (m.references || null),
    });
  }

  // ---------------------------------------------------------------------------
  // AI writing (Help me write, Refine, smart replies, summaries)
  // ---------------------------------------------------------------------------

  const REFINE_STYLES = [
    { style: 'polish', label: 'Polish', done: 'Polished' },
    { style: 'formal', label: 'Formalize', done: 'Made formal' },
    { style: 'casual', label: 'Make casual', done: 'Made casual' },
    { style: 'shorter', label: 'Shorten', done: 'Shortened' },
    { style: 'longer', label: 'Elaborate', done: 'Elaborated' },
    { style: 'proofread', label: 'Proofread', done: 'Proofread' },
    { style: 'bullets', label: 'Bullet points', done: 'Made bullet points' },
  ];

  // Plain-text conversation context for the AI: last 10 messages, each at most 4000 chars.
  function threadContext(t) {
    if (!t || !Array.isArray(t.messages) || !t.messages.length) return null;
    return {
      subject: subjectOf(t.subject || (t.messages[0] && t.messages[0].subject)),
      messages: t.messages.slice(-10).map((m) => ({
        from: senderLabel(m),
        date: longDate(m.date),
        text: messageText(m).slice(0, 4000),
      })),
    };
  }

  function checkAiStatus() {
    if (state.ai.checking) return state.ai.checking;
    const p = call('aiStatus').then((r) => {
      const was = state.ai.configured;
      state.ai.configured = !!(r && r.ok && r.configured);
      if (was !== state.ai.configured) onAiStatusChanged();
      return state.ai.configured;
    }).finally(() => { state.ai.checking = null; });
    state.ai.checking = p;
    return p;
  }

  function markAiNotConfigured() {
    if (state.ai.configured === false) return;
    state.ai.configured = false;
    onAiStatusChanged();
  }

  function onAiStatusChanged() {
    const c = state.compose;
    if (c && !$('ai-panel').hidden && !c.ai.busy) {
      // Panel open: show the right view for the new status.
      if (state.ai.configured && c.ai.mode === 'setup') renderAiPanel(defaultAiMode());
      else if (!state.ai.configured && c.ai.mode !== 'setup') renderAiPanel('setup');
    }
    const t = state.openThread;
    if (t && state.ai.configured) loadSmartReplies(t);
    if (t) {
      const cache = aiCacheFor(t);
      if (cache.summaryOpen && cache.summary && cache.summary.needsKey && state.ai.configured) {
        cache.summary = null;
        summarizeOpen();
      }
    }
  }

  function aiCacheFor(t) {
    const key = t.id + ':' + (t.messages ? t.messages.length : 0);
    let c = state.aiThreads.get(key);
    if (!c) {
      c = { replies: null, repliesLoading: false, summary: null, summaryOpen: false };
      state.aiThreads.set(key, c);
    }
    return c;
  }

  // ---- Compose body: the user's own text vs the quoted part ---------------

  function composeOwnText() {
    const c = state.compose;
    const v = $('compose-body').value;
    if (c && c.quote && v.endsWith(c.quote)) return v.slice(0, v.length - c.quote.length).trim();
    return v.trim();
  }

  function setComposeOwnText(text) {
    const c = state.compose;
    const v = $('compose-body').value;
    const clean = String(text || '').replace(/\s+$/, '');
    const keepQuote = c && c.quote && v.endsWith(c.quote);
    const body = $('compose-body');
    body.value = keepQuote ? clean + '\n\n' + c.quote : clean;
    body.dispatchEvent(new Event('input', { bubbles: true }));
    body.focus();
    body.setSelectionRange(clean.length, clean.length);
    body.scrollTop = 0;
  }

  function composeFields() {
    return {
      to: $('compose-to').value.trim(),
      cc: $('compose-cc').value.trim(),
      bcc: $('compose-bcc').value.trim(),
      subject: $('compose-subject').value,
      body: $('compose-body').value,
    };
  }

  function updateAiButton() {
    const c = state.compose;
    const btn = $('compose-ai');
    const label = $('compose-ai-label');
    if (!c) return;
    const busy = c.ai.busy;
    btn.classList.toggle('busy', busy);
    btn.disabled = busy;
    btn.setAttribute('aria-busy', String(busy));
    label.textContent = busy ? 'Writing…' : composeOwnText() ? 'Refine' : 'Help me write';
    btn.setAttribute('aria-expanded', String(!$('ai-panel').hidden));
  }

  function defaultAiMode() {
    if (state.ai.configured === false) return 'setup';
    return composeOwnText() ? 'refine' : 'write';
  }

  async function onAiButton() {
    const c = state.compose;
    if (!c || c.ai.busy) return;
    if (!$('ai-panel').hidden) { closeAiPanel(); return; }
    if (state.ai.configured !== true) await checkAiStatus();
    if (state.compose !== c) return;
    renderAiPanel(defaultAiMode());
  }

  // ---- Panel -----------------------------------------------------------------

  function closeAiPanel(silent) {
    const panel = $('ai-panel');
    const wasOpen = !panel.hidden;
    panel.hidden = true;
    panel.textContent = '';
    const c = state.compose;
    if (c) c.ai.mode = null;
    $('compose-ai').setAttribute('aria-expanded', 'false');
    if (wasOpen && !silent && c) $('compose-ai').focus();
  }

  function escapeAiPanel() {
    const c = state.compose;
    if (c && c.ai.busy) { cancelAi(); return; }
    closeAiPanel();
  }

  function onAiPanelKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      escapeAiPanel();
      return;
    }
    // Arrow keys move between menu items.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...$('ai-panel').querySelectorAll('.ai-item')];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      next.focus();
    }
  }

  function onAiOutsideClick(e) {
    const panel = $('ai-panel');
    if (panel.hidden) return;
    const c = state.compose;
    if (c && c.ai.busy) return;
    if (panel.contains(e.target) || $('compose-ai').contains(e.target)) return;
    closeAiPanel(true);
  }

  function aiPanelHead(title) {
    const head = el('div', 'ai-head');
    head.appendChild(icon('sparkle'));
    head.appendChild(el('span', 'ai-title', title));
    const x = iconButton('x', 'Close', () => escapeAiPanel());
    x.classList.add('ai-close');
    head.appendChild(x);
    return head;
  }

  function aiPrompt(placeholder, buttonLabel, onSubmit) {
    const wrap = el('div', 'ai-prompt');
    const ta = el('textarea', 'ai-input');
    ta.id = 'ai-input';
    ta.rows = 3;
    ta.placeholder = placeholder;
    ta.setAttribute('aria-label', placeholder);
    const submit = () => {
      const v = ta.value.trim();
      if (!v) { ta.focus(); return; }
      onSubmit(v);
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });
    wrap.appendChild(ta);
    const row = el('div', 'ai-prompt-row');
    row.appendChild(el('span', 'ai-hint', 'Enter to send · ⇧Enter new line · Esc to close'));
    const go = textButton(null, buttonLabel, submit, 'btn-primary btn-small ai-submit');
    go.id = 'ai-submit';
    row.appendChild(go);
    wrap.appendChild(row);
    return { wrap, input: ta };
  }

  function renderAiPanel(mode, opts = {}) {
    const c = state.compose;
    if (!c) return;
    const panel = $('ai-panel');
    panel.textContent = '';
    panel.dataset.mode = mode;
    c.ai.mode = mode;
    let focusEl = null;

    if (mode === 'setup') {
      panel.appendChild(aiPanelHead('Turn on AI writing'));
      panel.appendChild(el('p', 'ai-text', 'Add your Claude key in Roost Settings. Then Help me write, Refine, smart replies and summaries work right here.'));
      const actions = el('div', 'ai-actions');
      const settings = textButton(null, 'Open Roost Settings', async () => {
        const r = await call('openAiSettings');
        if (!r.ok) toast(errText(r), { error: true });
      }, 'btn-primary btn-small');
      settings.id = 'ai-open-settings';
      actions.appendChild(settings);
      const gm = textButton('external', 'Use Gmail’s own AI', () => openComposeInGmail(), 'btn-small');
      gm.id = 'ai-use-gmail';
      gm.title = 'Opens Gmail in your browser with this draft. Google’s Gemini “Help me write” is there.';
      actions.appendChild(gm);
      panel.appendChild(actions);
      panel.appendChild(el('p', 'ai-note', 'Gmail’s own AI opens Gmail in your browser.'));
      focusEl = settings;
    } else if (mode === 'working') {
      panel.appendChild(aiPanelHead(opts.title || 'Help me write'));
      const row = el('div', 'ai-working');
      row.setAttribute('role', 'status');
      row.appendChild(el('div', 'spinner'));
      row.appendChild(el('span', null, opts.text || 'Writing…'));
      row.appendChild(el('span', 'spacer'));
      const cancel = textButton(null, 'Cancel', () => cancelAi(), 'btn-small');
      cancel.id = 'ai-cancel';
      row.appendChild(cancel);
      panel.appendChild(row);
      focusEl = cancel;
    } else if (mode === 'refine') {
      panel.appendChild(aiPanelHead('Refine'));
      const menu = el('div', 'ai-menu');
      menu.setAttribute('role', 'menu');
      for (const s of REFINE_STYLES) {
        const b = el('button', 'ai-item', s.label);
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.dataset.style = s.style;
        b.addEventListener('click', () => runAi('rewrite', { style: s.style }, { title: s.label, done: s.done }));
        menu.appendChild(b);
      }
      menu.appendChild(el('div', 'ai-sep'));
      const subj = el('button', 'ai-item', 'Suggest subject');
      subj.type = 'button';
      subj.setAttribute('role', 'menuitem');
      subj.dataset.task = 'subject';
      subj.addEventListener('click', () => runAi('subject', {}, { title: 'Suggest subject', text: 'Thinking…' }));
      menu.appendChild(subj);
      panel.appendChild(menu);
      const p = aiPrompt('Or tell AI what to change…', 'Update', (prompt) => runAi('write', { prompt }, { title: 'Help me write', done: 'Draft updated' }));
      panel.appendChild(p.wrap);
      focusEl = menu.firstChild;
    } else {
      panel.appendChild(aiPanelHead('Help me write'));
      const p = aiPrompt(c.thread ? 'Describe your reply, e.g. “Say yes and suggest Tuesday”' : 'Describe your email, e.g. “Invite the team to lunch on Friday”',
        'Create', (prompt) => runAi('write', { prompt }, { title: 'Help me write', done: 'Draft written' }));
      if (opts.prompt) p.input.value = opts.prompt;
      panel.appendChild(p.wrap);
      focusEl = p.input;
    }

    if (opts.error) {
      const err = el('p', 'form-error ai-error', opts.error);
      err.setAttribute('role', 'alert');
      panel.appendChild(err);
    }
    panel.hidden = false;
    $('compose-ai').setAttribute('aria-expanded', 'true');
    if (focusEl) focusEl.focus();
  }

  function setAiBusy(c, on) {
    c.ai.busy = on;
    $('compose-body').readOnly = on;
    $('compose-send').disabled = on || c.sending;
    updateAiButton();
  }

  async function runAi(task, extra, ui = {}) {
    const c = state.compose;
    if (!c || c.ai.busy) return;
    const own = composeOwnText();
    const args = Object.assign({ task }, extra);
    if (task === 'rewrite' || task === 'subject') {
      if (!own) { renderAiPanel('write', { error: 'Write something first.' }); return; }
      args.draft = own;
    } else if (own) args.draft = own;
    const f = composeFields();
    if (f.to) args.to = f.to;
    if (f.subject.trim()) args.subject = f.subject.trim();
    if (c.thread) args.thread = c.thread;

    const backMode = c.ai.mode && c.ai.mode !== 'working' ? c.ai.mode : defaultAiMode();
    const seq = ++c.ai.seq;
    c.ai.backMode = backMode;
    c.ai.backPrompt = extra.prompt || '';
    setAiBusy(c, true);
    renderAiPanel('working', { title: ui.title, text: ui.text });

    const r = await call('ai', args);
    if (state.compose !== c || seq !== c.ai.seq) return; // closed or cancelled: ignore the late result
    setAiBusy(c, false);

    if (!r.ok) {
      if (r.needsAiKey) { markAiNotConfigured(); renderAiPanel('setup'); return; }
      renderAiPanel(backMode, { error: errText(r), prompt: extra.prompt });
      return;
    }
    const text = String(r.text || '').trim();
    if (!text) { renderAiPanel(backMode, { error: 'The AI sent back an empty answer. Try again.', prompt: extra.prompt }); return; }

    if (task === 'subject') {
      const subject = text.split(/\r?\n/)[0].replace(/^subject:\s*/i, '').replace(/^["“]|["”]$/g, '').trim();
      const cur = $('compose-subject').value.trim();
      closeAiPanel();
      if (!cur || cur === subject || window.confirm('Replace the subject with “' + subject + '”?')) {
        const prev = $('compose-subject').value;
        $('compose-subject').value = subject;
        toast('Subject added', {
          action: 'Undo',
          onAction: () => { if (state.compose === c) $('compose-subject').value = prev; },
        });
      }
      return;
    }

    const prevBody = $('compose-body').value;
    setComposeOwnText(text);
    closeAiPanel(true);
    toast(ui.done || 'Done', {
      action: 'Undo',
      onAction: () => {
        if (state.compose !== c) return;
        const body = $('compose-body');
        body.value = prevBody;
        body.dispatchEvent(new Event('input', { bubbles: true }));
        body.focus();
      },
    });
  }

  function cancelAi() {
    const c = state.compose;
    if (!c || !c.ai.busy) return;
    c.ai.seq++;
    setAiBusy(c, false);
    renderAiPanel(c.ai.backMode || defaultAiMode(), { prompt: c.ai.backPrompt });
  }

  async function openComposeInGmail() {
    if (!state.compose) return;
    const r = await call('openInGmail', composeFields());
    if (r.ok) toast('Opened this draft in Gmail in your browser');
    else toast(errText(r), { error: true });
  }

  // ---- Reader: smart replies + summary ------------------------------------

  function loadSmartReplies(t) {
    if (!t || !t.messages || !t.messages.length) return;
    if (state.ai.configured !== true) return; // checked again when the status arrives
    const last = t.messages[t.messages.length - 1];
    const me = String(state.email || '').toLowerCase();
    if (me && String(last.fromEmail || '').toLowerCase() === me) return; // my own last message: nothing to answer
    const cache = aiCacheFor(t);
    const fill = () => {
      if (!state.openThread || state.openThread.id !== t.id) return;
      const holder = $('reader').querySelector('.smart-replies');
      if (holder) fillSmartReplies(holder, cache.replies || []);
    };
    if (cache.replies) { fill(); return; }
    if (cache.repliesLoading) return;
    cache.repliesLoading = true;
    call('ai', { task: 'replies', thread: threadContext(t) }).then((r) => {
      cache.repliesLoading = false;
      if (r && r.needsAiKey) markAiNotConfigured();
      const list = r && r.ok && Array.isArray(r.replies) ? r.replies : [];
      cache.replies = list.map((x) => String(x == null ? '' : x).trim()).filter(Boolean).slice(0, 3);
      fill();
    });
  }

  function fillSmartReplies(holder, replies) {
    holder.textContent = '';
    if (!replies.length) { holder.hidden = true; return; }
    for (const text of replies) {
      const b = el('button', 'smart-reply', text);
      b.type = 'button';
      b.title = 'Reply with “' + text + '”';
      b.addEventListener('click', () => startReply('reply', { prefill: text }));
      holder.appendChild(b);
    }
    holder.hidden = false;
  }

  async function summarizeOpen() {
    const t = state.openThread;
    if (!t || !t.messages.length) return;
    const cache = aiCacheFor(t);
    if (cache.summaryOpen && cache.summary && !cache.summary.error && !cache.summary.needsKey) {
      // Already showing: bring it into view.
      const card = $('reader').querySelector('.ai-summary');
      if (card) { card.scrollIntoView({ block: 'nearest' }); return; }
    }
    cache.summaryOpen = true;
    if (state.ai.configured !== true) await checkAiStatus();
    if (state.ai.configured !== true) {
      cache.summary = { needsKey: true };
      renderSummaryCard(state.openThread);
      return;
    }
    if (cache.summary && cache.summary.loading) return;
    if (cache.summary && cache.summary.text) { renderSummaryCard(state.openThread); return; }
    cache.summary = { loading: true };
    renderSummaryCard(state.openThread);
    const r = await call('ai', { task: 'summarize', thread: threadContext(t) });
    if (r.needsAiKey) { markAiNotConfigured(); cache.summary = { needsKey: true }; }
    else if (!r.ok) cache.summary = { error: errText(r) };
    else if (!String(r.text || '').trim()) cache.summary = { error: 'The AI sent back an empty summary.' };
    else cache.summary = { text: String(r.text).trim() };
    if (state.openThread && state.openThread.id === t.id) renderSummaryCard(state.openThread);
  }

  function renderSummaryCard(t) {
    const reader = $('reader');
    const old = reader.querySelector('.ai-summary');
    const cache = t && t.messages ? aiCacheFor(t) : null;
    if (!cache || !cache.summaryOpen || !cache.summary) { if (old) old.remove(); return; }
    const s = cache.summary;
    const card = el('section', 'ai-summary');
    card.setAttribute('aria-label', 'Summary');
    const head = el('div', 'ai-head');
    head.appendChild(icon('sparkle'));
    head.appendChild(el('span', 'ai-title', 'Summary'));
    const x = iconButton('x', 'Close summary', () => { cache.summaryOpen = false; card.remove(); });
    x.classList.add('ai-close');
    head.appendChild(x);
    card.appendChild(head);
    const body = el('div', 'ai-summary-body');
    if (s.loading) {
      body.setAttribute('role', 'status');
      const row = el('div', 'ai-working');
      row.appendChild(el('div', 'spinner'));
      row.appendChild(el('span', null, 'Summarizing…'));
      body.appendChild(row);
    } else if (s.needsKey) {
      body.appendChild(el('p', 'ai-text', 'Turn on AI writing: add your Claude key in Roost Settings.'));
      body.appendChild(textButton(null, 'Open Roost Settings', async () => {
        const r = await call('openAiSettings');
        if (!r.ok) toast(errText(r), { error: true });
      }, 'btn-primary btn-small'));
    } else if (s.error) {
      const err = el('p', 'form-error', s.error);
      err.setAttribute('role', 'alert');
      body.appendChild(err);
      body.appendChild(textButton(null, 'Try again', () => { cache.summary = null; summarizeOpen(); }, 'btn-small'));
    } else {
      let ul = null;
      for (const raw of s.text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) { ul = null; continue; }
        const m = /^(?:[-*•]\s+)(.*)$/.exec(line);
        if (m) {
          if (!ul) { ul = el('ul', 'ai-bullets'); body.appendChild(ul); }
          ul.appendChild(el('li', null, m[1]));
        } else {
          ul = null;
          body.appendChild(el('p', 'ai-text', line));
        }
      }
    }
    card.appendChild(body);
    if (old) old.replaceWith(card);
    else {
      const head2 = reader.querySelector('.thread-head');
      if (head2) head2.after(card);
      else reader.prepend(card);
    }
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
    if (currentScreen !== 'screen-mail') return;
    if (e.key === 'Escape') {
      if (!$('ai-panel').hidden) { e.preventDefault(); escapeAiPanel(); return; }
      if (state.compose) { e.preventDefault(); discardCompose(); return; }
      if ($('screen-mail').classList.contains('drawer-open')) { closeDrawer(); return; }
      if (e.target === $('search-input')) { e.preventDefault(); clearSearch(); return; }
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target) || state.compose) return;
    const k = e.key;
    const handlers = {
      c: () => openCompose(),
      '/': () => { $('search-input').focus(); $('search-input').select(); },
      j: () => moveCursor(1),
      k: () => moveCursor(-1),
      Enter: () => openCursor(),
      o: () => openCursor(),
      u: () => { if (state.openId) closeReader(); },
      e: () => {
        if (state.checked.size) archiveIds([...state.checked]);
        else if (state.openThread) { if (threadInInbox(state.openThread)) archiveOpen(); }
        else if (state.threads[state.cursor]) archiveIds([state.threads[state.cursor].id]);
      },
      '#': () => {
        if (state.checked.size) trashIds([...state.checked]);
        else if (state.openThread) trashOpen();
        else if (state.threads[state.cursor]) trashIds([state.threads[state.cursor].id]);
      },
      x: () => {
        const t = state.threads[state.cursor] || (state.openId && state.threads[indexOfThread(state.openId)]);
        if (t) toggleChecked(t.id, !state.checked.has(t.id));
      },
      r: () => startReply('reply'),
      a: () => startReply('replyAll'),
      f: () => startReply('forward'),
      s: () => {
        const id = state.openId || (state.threads[state.cursor] && state.threads[state.cursor].id);
        if (id) toggleStar(id);
      },
      U: () => markOpenUnread(),
      '?': () => call('showShortcuts'),
      '\\': () => toggleListCollapsed(),
      // Next / previous inbox tab (Primary, Promotions …)
      ']': () => { if (inTabs()) selectCategory(CATEGORIES[(CATEGORIES.findIndex((c) => c.id === state.category) + 1) % CATEGORIES.length].id); },
      '[': () => { if (inTabs()) selectCategory(CATEGORIES[(CATEGORIES.findIndex((c) => c.id === state.category) + CATEGORIES.length - 1) % CATEGORIES.length].id); },
      F: () => call('searchAll'),
    };
    // Enter on a focused button should click it, not open the cursor thread.
    if (k === 'Enter' && e.target && e.target.tagName === 'BUTTON') return;
    const h = handlers[k];
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
      if (currentScreen === 'screen-mail') { refreshLabels(); refreshListQuietly(); }
    } else if (ev.type === 'view') {
      applyView(ev.view);
      rerenderToolbar();
    } else if (ev.type === 'compose') {
      if (currentScreen === 'screen-mail' && !state.compose) openCompose();
    } else if (ev.type === 'open-thread' && ev.threadId) {
      if (currentScreen !== 'screen-mail') { state.pendingOpen = String(ev.threadId); return; }
      openThreadFromNotification(String(ev.threadId));
    } else if (ev.type === 'ai-status') {
      const was = state.ai.configured;
      state.ai.configured = !!ev.configured;
      if (was !== state.ai.configured) onAiStatusChanged();
    } else if (ev.type === 'auth') {
      if (ev.signedIn) {
        if (currentScreen === 'screen-mail' && ev.email === state.email) return;
        init();
      } else {
        resetMailState();
        init();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function wire() {
    hydrateIcons(document);

    // Setup
    document.querySelectorAll('[data-url]').forEach((b) => {
      b.addEventListener('click', () => openExternal(b.getAttribute('data-url')));
    });
    $('setup-form').addEventListener('submit', onSaveSetup);
    $('setup-cancel').addEventListener('click', () => showSignIn());
    $('loading-retry').addEventListener('click', init);

    // Sign-in
    $('signin-btn').addEventListener('click', onSignIn);
    $('signin-cancel').addEventListener('click', onCancelSignIn);
    $('signin-test-users').addEventListener('click', () => {
      window.gmail.call('openExternal', { url: 'https://console.cloud.google.com/auth/audience' });
    });
    $('signin-change-key').addEventListener('click', () => { state.signInSeq++; showSetup(true); });

    // Mail chrome
    $('compose-btn').addEventListener('click', () => openCompose());
    $('signout-btn').addEventListener('click', onSignOut);
    $('menu-btn').addEventListener('click', openDrawer);
    $('drawer-backdrop').addEventListener('click', closeDrawer);
    $('refresh-btn').addEventListener('click', async () => {
      const b = $('refresh-btn');
      b.classList.add('refresh-spin');
      refreshLabels();
      await refreshListQuietly();
      b.classList.remove('refresh-spin');
    });
    $('search-form').addEventListener('submit', onSearch);
    $('search-input').addEventListener('search', () => { if (!$('search-input').value && state.q) clearSearch(); });

    // Compose
    $('compose-form').addEventListener('submit', onSend);
    $('compose-close').addEventListener('click', discardCompose);
    $('compose-discard').addEventListener('click', discardCompose);
    $('compose-attach').addEventListener('click', onAttach);
    $('compose-ai').addEventListener('click', onAiButton);
    $('compose-gmail').addEventListener('click', () => openComposeInGmail());
    $('compose-body').addEventListener('input', updateAiButton);
    $('ai-panel').addEventListener('keydown', onAiPanelKey);
    document.addEventListener('mousedown', onAiOutsideClick, true);
    // The user may have just added the AI key in Roost Settings.
    window.addEventListener('focus', () => { if (currentScreen === 'screen-mail') checkAiStatus(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && currentScreen === 'screen-mail') checkAiStatus(); });
    $('compose-ccbcc').addEventListener('click', () => {
      const show = $('compose-cc-row').hidden;
      $('compose-cc-row').hidden = !show;
      $('compose-bcc-row').hidden = !show;
      if (show) $('compose-cc').focus();
    });

    document.addEventListener('keydown', onKeyDown);

    if (window.gmail && typeof window.gmail.onEvent === 'function') {
      try { window.gmail.onEvent(onEvent); } catch (_) { /* ignore */ }
    }
  }

  wire();
  init();
})();
