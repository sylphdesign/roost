// Runs inside each app (Gmail, WhatsApp, ...).
// 1. Wraps web notifications: muted apps / Do Not Disturb stay quiet; a click opens that app.
// 2. Runs a small "recipe" that counts unread items, for apps whose page title does not show them.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('__roostBridge', {
  isMuted: () => ipcRenderer.sendSync('svc:is-muted'),
  policy: () => ipcRenderer.sendSync('svc:notify-policy'),
  capture: (n) => ipcRenderer.send('svc:capture', Number(n) || 0),
  clicked: () => ipcRenderer.send('svc:notification-click'),
  action: (name) => ipcRenderer.send('svc:action', String(name)),
});

const patch = () => {
  const Orig = window.Notification;
  const bridge = window.__roostBridge;
  if (!Orig || !bridge || Orig.__roost) return;
  function Notification(title, options) {
    const policy = bridge.policy() || {};
    if (!policy.show) {
      const quiet = new EventTarget();
      quiet.close = () => {};
      quiet.title = title;
      return quiet;
    }
    const n = new Orig(title, policy.silent ? { ...(options || {}), silent: true } : options);
    n.addEventListener('click', () => bridge.clicked());
    return n;
  }
  Notification.prototype = Orig.prototype;
  Notification.__roost = true;
  Object.defineProperty(Notification, 'permission', { get: () => Orig.permission });
  Object.defineProperty(Notification, 'maxActions', { get: () => Orig.maxActions });
  Notification.requestPermission = (...args) => Orig.requestPermission(...args);
  window.Notification = Notification;

  // Tell Roost while this app uses the microphone or camera (a call), so Roost never mutes it then.
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia && !md.getUserMedia.__roost) {
    const live = new Set();
    const report = () => bridge.capture(live.size);
    const track = (stream) => {
      for (const t of stream.getTracks()) {
        if (t.readyState === 'ended') continue;
        live.add(t);
        t.addEventListener('ended', () => { live.delete(t); report(); });
      }
      report();
      return stream;
    };
    const origStop = MediaStreamTrack.prototype.stop;
    MediaStreamTrack.prototype.stop = function stop() {
      const r = origStop.call(this);
      if (live.delete(this)) report();
      return r;
    };
    const orig = md.getUserMedia.bind(md);
    const gum = (c) => orig(c).then(track);
    gum.__roost = true;
    md.getUserMedia = gum;
  }
};

webFrame.executeJavaScript(`(${patch.toString()})()`).catch(() => {});

// ---------- Gmail inside Roost: bridge for src/gmail/index.html only ----------
if (location.protocol === 'file:' && location.pathname.endsWith('/gmail/index.html')) {
  contextBridge.exposeInMainWorld('gmail', {
    call: (method, args) => ipcRenderer.invoke('gmail:call', String(method), args ?? {}),
    onEvent: (cb) => ipcRenderer.on('gmail:event', (_e, ev) => cb(ev)),
  });
}

if (location.protocol === 'file:' && location.pathname.endsWith('/calendar/index.html')) {
  contextBridge.exposeInMainWorld('gcal', {
    call: (method, args) => ipcRenderer.invoke('gcal:call', String(method), args ?? {}),
    onEvent: (cb) => ipcRenderer.on('gcal:event', (_e, ev) => cb(ev)),
  });
}

// ---------- unread recipes ----------

const num = (el) => parseInt(String(el.textContent || '').replace(/[^\d]/g, ''), 10) || 0;
const sum = (selector) => [...document.querySelectorAll(selector)].reduce((n, el) => n + num(el), 0);
const any = (selector) => !!document.querySelector(selector);

// Sources: Ferdium recipes (github.com/ferdium/ferdium-recipes) and Telegram Web A source
// (github.com/Ajaxy/telegram-tt), read in Nov 2026. The page title is also parsed in main.js.
const SLACK_UNREAD_CHANNEL = '.p-channel_sidebar__channel--unread:not(.p-channel_sidebar__channel--muted)';
const SLACK_UNREAD_LINK = '.p-channel_sidebar__link--unread'
  + ':not([data-sidebar-link-id="Punreads"]):not([data-sidebar-link-id="Pdrafts"])'
  + ':not([data-sidebar-link-id="Pdms"]):not([data-sidebar-link-id="Ppaid-benefits"])';

async function whatsappFromIndexedDb() {
  // WhatsApp keeps its chat list in IndexedDB "model-storage" / "chat" (same as Ferdium reads it).
  // Only read it if WhatsApp already created it, so Roost never creates or changes the database.
  if (!indexedDB.databases) return null;
  const dbs = await indexedDB.databases();
  if (!dbs.some((d) => d.name === 'model-storage')) return null;
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('model-storage');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => { req.transaction.abort(); };
  });
  try {
    if (!db.objectStoreNames.contains('chat')) return null;
    const chats = await new Promise((resolve, reject) => {
      const req = db.transaction('chat', 'readonly').objectStore('chat').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    let count = 0;
    let muted = 0;
    for (const chat of chats) {
      if (!(chat.unreadCount > 0) || chat.archive) continue;
      if (chat.muteExpiration !== 0 && chat.muteExpiration !== undefined) muted += chat.unreadCount;
      else if (chat.isAutoMuted) muted += chat.unreadCount;
      else count += chat.unreadCount;
    }
    return { count, dot: count === 0 && muted > 0 };
  } finally { db.close(); }
}

const RECIPES = {
  // Slack: one per unread DM/mention badge in an unread, not-muted channel; dot for other unread channels.
  slack: () => {
    const direct = document.querySelectorAll(`${SLACK_UNREAD_CHANNEL} .p-channel_sidebar__badge, ${SLACK_UNREAD_LINK}`).length;
    const all = document.querySelectorAll(SLACK_UNREAD_CHANNEL).length;
    return { count: direct, dot: all - direct > 0 || any(SLACK_UNREAD_LINK) };
  },
  // Telegram Web A: badge class names are hashed per release, so read the plain badge wrapper
  // (".chat-badge-transition" in each chat's subtitle). Web K: ".rp:not(.is-muted) .dialog-subtitle-badge".
  telegram: () => {
    let count = 0;
    let dot = false;
    for (const el of document.querySelectorAll('.chat-list .ListItem.Chat .subtitle .chat-badge-transition')) {
      const n = num(el);
      if (n > 0) count += n;
      else if (el.childElementCount > 0) dot = true; // marked unread, mention or reaction badge
    }
    count += sum('.rp:not(.is-muted) .dialog-subtitle-badge');
    if (any('.rp.is-muted .dialog-subtitle-badge')) dot = dot || count === 0;
    return { count, dot: dot && count === 0 };
  },
  // WhatsApp: chat list in IndexedDB (title "(N) WhatsApp" is also parsed in main.js).
  whatsapp: whatsappFromIndexedDb,
  // Discord: number badges under server icons; "• Discord" in the title gives the dot (main.js).
  discord: () => ({ count: sum('[class*="lowerBadge_"] [class*="numberBadge_"]'), dot: false }),
  // Messenger, Gmail, Calendar: page title.
};

const info = (() => { try { return ipcRenderer.sendSync('svc:info'); } catch { return null; } })();
const recipe = info && RECIPES[info.type];

if (recipe && window.top === window) {
  let last = '';
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    let result;
    try { result = await recipe(); } catch { result = null; } finally { busy = false; }
    if (!result) return;
    const key = `${result.count}|${result.dot}`;
    if (key === last) return;
    last = key;
    ipcRenderer.send('svc:unread', result);
  };
  const start = () => { run(); setInterval(run, 2500); };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
