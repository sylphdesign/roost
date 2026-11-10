const {
  app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, session, dialog, clipboard, systemPreferences,
  Tray, nativeImage, desktopCapturer, Notification, safeStorage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const APP_NAME = 'Roost';

if (process.env.ROOST_USER_DATA) app.setPath('userData', process.env.ROOST_USER_DATA);

const store = require('./store');
const { PRESETS, GROUPS } = require('./presets');
const { runAiTask } = require('./ai');
const { spawn, execFile } = require('child_process');
const { parseUnread } = require('./unread');
const { ChromeAccount, findChrome, browserName } = require('./chrome-bridge');
const { GmailAccount, GmailStore, CONTRACT } = require('./gmail-api');
const { CalendarAccount, CALENDAR_CONTRACT } = require('./google-calendar');

const SIDEBAR = 76;
const TOPBAR = 44;
const KEYBAR = 26; // the slim shortcut bar at the bottom
const isMac = process.platform === 'darwin';
const PLATFORM_UA = isMac
  ? 'Macintosh; Intel Mac OS X 10_15_7'
  : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
// A normal Chrome user agent (no "Electron" in it), so WhatsApp, Slack etc. accept us.
const CHROME_UA = `Mozilla/5.0 (${PLATFORM_UA}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;
app.userAgentFallback = CHROME_UA;

const AUTH_HOSTS = [
  'accounts.google.com', 'accounts.youtube.com', 'appleid.apple.com', 'login.microsoftonline.com',
  'login.live.com', 'slack.com', 'discord.com', 'www.facebook.com', 'm.facebook.com',
];
const ALLOWED_PERMISSIONS = new Set([
  'notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen',
  'pointerLock', 'mediaKeySystem', 'speaker-selection', 'window-management',
]);

let win = null;
let config = null;
let overlay = false;
let quitting = false;
let tray = null;
const views = new Map(); // service id -> { view, fromTitle, fromPage, unread, dot, icon, loading }
const byWc = new Map(); // webContents id -> service id
const readySessions = new Set();
const accounts = new Map(); // service id -> ChromeAccount (Google accounts in their own Chrome window)
let chromePath = null;
let gmailStore = null;
const gmailAccounts = new Map(); // service id -> GmailAccount (Gmail inside Roost, via the Gmail API)
// Google apps that Roost shows with its own screen, through Google's official APIs.
const API_APPS = {
  gmail: { dir: 'gmail', Account: GmailAccount, contract: CONTRACT, channel: 'gmail' },
  calendar: { dir: 'calendar', Account: CalendarAccount, contract: CALENDAR_CONTRACT, channel: 'gcal' },
};
const apiPage = (svc) => path.join(__dirname, API_APPS[svc.type].dir, 'index.html');
const DEFAULT_MAIL_VIEW = { pane: 'right', listWidth: 'normal', density: 'comfortable', preview: true, labels: true };
const DEFAULT_SETTINGS = { keyBar: true, sounds: true, callQuiet: true, quietHours: { on: false, from: '22:00', to: '07:00' } };
let inCall = false; // a microphone is in use (Zoom, Meet, Teams, FaceTime, a WhatsApp call …)
let zoomMeeting = false; // Zoom's meeting process is running
const capturing = new Set(); // service ids whose page uses the microphone or camera right now
const API_EXTRA = ['aiStatus', 'ai', 'openAiSettings', 'openInGmail', 'showShortcuts', 'searchAll', 'getView', 'openViewSettings']; // Gmail screen methods handled here

// ---------- helpers ----------

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const isHttp = (url) => /^https?:\/\//i.test(url);
const svcById = (id) => config.services.find((s) => s.id === id);
const svcOfSender = (wc) => svcById(byWc.get(wc.id));

function unwrapRedirect(url) {
  // Gmail and others wrap outgoing links, e.g. https://www.google.com/url?q=REAL
  try {
    const u = new URL(url);
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url') {
      return u.searchParams.get('q') || u.searchParams.get('url') || url;
    }
  } catch { /* keep url */ }
  return url;
}

function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return null;
  if (!/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null;
  } catch { return null; }
}

function openExternal(url) {
  if (isHttp(url) || url.startsWith('mailto:')) shell.openExternal(url);
}

// ---------- groups: email at the top of the sidebar, messages below the line, Google apps in the top bar ----------

const presetGroup = (type) => (PRESETS.find((p) => p.type === type) || {}).group || 'chat';
const groupOf = (svc) => (GROUPS.includes(svc.group) ? svc.group : presetGroup(svc.type));
// The order the user sees: email, then messages, then the top bar. Used for ⌘1–9, Ctrl+Tab and the menu bar list.
const orderedServices = () => GROUPS.flatMap((g) => config.services.filter((s) => groupOf(s) === g));

// ---------- quiet time (Do Not Disturb, calls, quiet hours) ----------

const settings = () => {
  const s = config.settings || {};
  return {
    ...DEFAULT_SETTINGS, ...s,
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(s.quietHours || {}) },
    mailView: { ...DEFAULT_MAIL_VIEW, ...(s.mailView || {}) },
  };
};

function inQuietHours(now = new Date()) {
  const q = settings().quietHours;
  if (!q.on) return false;
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t)); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const from = toMin(q.from);
  const to = toMin(q.to);
  if (from === null || to === null || from === to) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

// Why Roost is quiet right now, or null.
function quietReason() {
  if (config.dnd) return 'dnd';
  if (settings().callQuiet && (inCall || zoomMeeting)) return 'call';
  if (inQuietHours()) return 'hours';
  return null;
}

// What a notification from this app may do now.
function notifyPolicy(svc) {
  const s = settings();
  return {
    show: !!svc && !svc.muted && !quietReason(),
    silent: !s.sounds || svc?.sounds === false,
  };
}

// Sounds that apps play themselves (message dings, ringtones). An app is muted when sounds are off or
// it is quiet time — except the app you are looking at, and an app that is in a call itself.
function applyAudio() {
  if (!config) return;
  const s = settings();
  const quiet = !!quietReason();
  const focused = !!(win && !win.isDestroyed() && win.isFocused());
  for (const svc of config.services) {
    const e = views.get(svc.id);
    if (!e || e.view.webContents.isDestroyed()) continue;
    const looking = focused && svc.id === config.activeId;
    const mute = !capturing.has(svc.id) && !looking && (quiet || !s.sounds || svc.sounds === false);
    if (e.view.webContents.isAudioMuted() !== mute) e.view.webContents.setAudioMuted(mute);
  }
}

let lastQuiet;
function quietChanged() {
  const q = quietReason();
  applyAudio();
  if (q === lastQuiet) return;
  lastQuiet = q;
  buildMenu();
  pushState();
}

// Watch for calls: the microphone helper (any app) plus Zoom's meeting process.
let micWatcher = null;
function micHelperPath() {
  const p = app.isPackaged ? path.join(process.resourcesPath, 'bin', 'mic-watch') : path.join(__dirname, '..', 'build', 'bin', 'mic-watch');
  return isMac && fs.existsSync(p) ? p : null;
}
function startCallWatch() {
  if (process.env.ROOST_NO_CALL_WATCH) return;
  const helper = micHelperPath();
  if (helper && !micWatcher) {
    micWatcher = spawn(helper, [], { stdio: ['ignore', 'pipe', 'ignore'] });
    micWatcher.stdout.on('data', (d) => {
      const last = String(d).trim().split('\n').pop();
      inCall = last === '1';
      quietChanged();
    });
    micWatcher.on('exit', () => { micWatcher = null; });
  }
  if (isMac) {
    setInterval(() => {
      execFile('/usr/bin/pgrep', ['-x', 'CptHost'], (err, out) => {
        const on = !err && !!String(out).trim();
        if (on !== zoomMeeting) { zoomMeeting = on; quietChanged(); }
      });
    }, 5000);
  }
  setInterval(quietChanged, 60000); // quiet hours start and end
}

// ---------- AI writing key (Claude), kept in the macOS Keychain via safeStorage ----------

const aiFile = () => path.join(app.getPath('userData'), 'ai.json');
function getAiKey() {
  try {
    const d = JSON.parse(fs.readFileSync(aiFile(), 'utf8'));
    if (d.plain && process.env.ROOST_PLAIN_TOKENS) return d.plain;
    if (d.enc && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(d.enc, 'base64'));
  } catch { /* no key */ }
  return null;
}
function setAiKey(key) {
  const k = String(key || '').trim();
  if (!k) { fs.rmSync(aiFile(), { force: true }); return; }
  const data = process.env.ROOST_PLAIN_TOKENS ? { plain: k }
    : { enc: safeStorage.encryptString(k).toString('base64') };
  fs.writeFileSync(aiFile(), JSON.stringify(data), { mode: 0o600 });
}
const aiConfigured = () => !!process.env.ROOST_AI_FAKE || !!getAiKey();

function notifyAiStatus() {
  for (const s of config.services) if (s.type === 'gmail') sendToGmailView(s.id, { type: 'ai-status', configured: aiConfigured() });
}

function openSettings(section) {
  showWindow();
  if (win && !win.isDestroyed()) win.webContents.send('ui:settings', section || null);
}

// ---------- tile icons: the app's icon, the first letter of the name, or your own picture ----------

const firstLetter = (name) => (Array.from(String(name || '').trim())[0] || '?').toUpperCase();
const iconDir = () => path.join(app.getPath('userData'), 'icons');
const customIconFile = (id) => path.join(iconDir(), `${id}.png`);
const customIcons = new Map(); // service id -> data URL (cache)

// Gmail tiles look the same, so they show a letter unless you pick something else.
const iconModeOf = (svc) => svc.iconMode || (svc.type === 'gmail' ? 'letter' : 'app');

function customIconUrl(svc) {
  if (customIcons.has(svc.id)) return customIcons.get(svc.id);
  let url = null;
  try { url = `data:image/png;base64,${fs.readFileSync(customIconFile(svc.id)).toString('base64')}`; } catch { /* no picture */ }
  customIcons.set(svc.id, url);
  return url;
}

function setIconMode(svc, mode) {
  svc.iconMode = mode;
  store.save(config);
  pushState();
}

async function pickCustomIcon(svc) {
  let file = process.env.ROOST_TEST_ICON;
  if (!file) {
    const r = await dialog.showOpenDialog(win, {
      title: `Picture for ${svc.name}`, properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tiff', 'bmp', 'ico', 'icns'] }],
    });
    if (r.canceled || !r.filePaths[0]) return;
    file = r.filePaths[0];
  }
  let img = nativeImage.createFromPath(file);
  if (img.isEmpty()) {
    dialog.showMessageBox(win, { type: 'info', message: 'Roost cannot read that picture', detail: 'Pick a PNG or JPG file.' });
    return;
  }
  // Crop to a square from the middle, then make it small.
  const { width, height } = img.getSize();
  const side = Math.min(width, height);
  img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
    .resize({ width: 96, height: 96, quality: 'best' });
  fs.mkdirSync(iconDir(), { recursive: true });
  fs.writeFileSync(customIconFile(svc.id), img.toPNG());
  customIcons.delete(svc.id);
  setIconMode(svc, 'custom');
}

// ---------- search all inboxes, and other app-wide shortcuts ----------

async function searchAllInboxes(q) {
  const query = String(q || '').trim().slice(0, 300);
  if (!query) return { ok: true, groups: [] };
  const groups = await Promise.all(orderedServices().filter((s) => s.type === 'gmail' && s.mode === 'api').map(async (svc) => {
    const acc = startGmail(svc);
    const st = acc.status();
    const base = { id: svc.id, name: svc.name, email: st.email || '' };
    if (!st.signedIn) return { ...base, threads: [], error: 'Not signed in' };
    try {
      const r = await acc.listThreads({ q: query, labelId: 'ALL', max: 10 });
      return { ...base, threads: r.threads, more: !!r.nextPageToken };
    } catch (err) {
      return { ...base, threads: [], error: err.message || 'Search failed' };
    }
  }));
  return { ok: true, groups };
}

// Open one email in its inbox (from the search results).
function openMail(id, threadId) {
  const svc = svcById(id);
  if (!svc || svc.type !== 'gmail' || svc.mode !== 'api' || !threadId) return;
  showWindow();
  select(id);
  sendToGmailView(keyOf(svc), { type: 'open-thread', threadId: String(threadId) });
}

// New email in the inbox you are in (or the Gmail tab you used last).
function composeInInbox() {
  const active = svcById(config.activeId);
  const isMail = (s) => s && s.type === 'gmail' && s.mode === 'api';
  const svc = isMail(active) ? active : svcById(config.mailId) && isMail(svcById(config.mailId)) ? svcById(config.mailId) : mailServices()[0];
  if (!svc) return;
  showWindow();
  select(svc.id);
  sendToGmailView(keyOf(svc), { type: 'compose' });
}

function showUiPanel(channel) {
  showWindow();
  win.webContents.focus();
  win.webContents.send(channel);
}

// ---------- state to the sidebar ----------

function publicState() {
  return {
    activeId: config.activeId,
    dnd: !!config.dnd,
    quiet: quietReason(),
    settings: settings(),
    aiConfigured: aiConfigured(),
    chrome: chromePath ? browserName(chromePath) : null,
    topEmail: config.services.some(linksToMail) ? linkedEmail() || null : null,
    services: config.services.map((s) => {
      const e = views.get(s.id) || {};
      return {
        id: s.id, type: s.type, name: s.name, url: s.url, color: s.color, muted: !!s.muted,
        group: groupOf(s), sounds: s.sounds !== false, badge: s.badge !== false, mode: s.mode || 'inside',
        unread: e.unread || 0, dot: !!e.dot, loading: !!e.loading,
        ...(() => {
          const mode = iconModeOf(s);
          if (mode === 'custom' && customIconUrl(s)) return { icon: customIconUrl(s), iconMode: 'custom' };
          if (mode === 'letter') return { icon: null, iconMode: 'letter' };
          return { icon: e.icon || null, iconMode: 'app' };
        })(),
      };
    }),
  };
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', publicState());
  updateBadge();
  updateTray();
}

// Unread = the higher of what the page title says and what the app's page recipe found.
function recomputeUnread(entry) {
  const count = Math.max(entry.fromTitle.count, entry.fromPage.count);
  const dot = count === 0 && (entry.fromTitle.dot || entry.fromPage.dot);
  if (count === entry.unread && dot === entry.dot) return false;
  entry.unread = count;
  entry.dot = dot;
  return true;
}

function unreadTotals() {
  let total = 0;
  let anyDot = false;
  for (const s of config.services) {
    if (s.muted || s.badge === false) continue;
    const e = views.get(s.id);
    if (!e) continue;
    total += e.unread;
    anyDot = anyDot || e.dot;
  }
  return { total, anyDot };
}

function updateBadge() {
  const { total, anyDot } = unreadTotals();
  if (isMac && app.dock) app.dock.setBadge(total ? String(total) : anyDot ? '•' : '');
  else app.setBadgeCount(total);
}

// ---------- sessions (one per account) ----------

function setupSession(ses) {
  if (readySessions.has(ses)) return;
  readySessions.add(ses);
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.setPermissionRequestHandler(async (_wc, permission, callback, details) => {
    if (!ALLOWED_PERMISSIONS.has(permission)) return callback(false);
    if (permission === 'media' && isMac) {
      const types = details.mediaTypes || [];
      try {
        if (types.includes('video')) await systemPreferences.askForMediaAccess('camera');
        if (types.includes('audio')) await systemPreferences.askForMediaAccess('microphone');
      } catch { /* the page will see the OS answer */ }
    }
    callback(true);
  });
  // Screen sharing in calls (Slack huddles, Discord, Google Meet links, WhatsApp).
  // macOS 15+ shows its own picker. Older systems share the main screen.
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
      .catch(() => callback({}));
  }, { useSystemPicker: true });
}

// ---------- right-click menu inside an app ----------

function attachContextMenu(wc) {
  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      items.push({ label: 'Add to Dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (p.linkURL) {
      const link = unwrapRedirect(p.linkURL);
      items.push({ label: 'Open Link in Browser', click: () => openExternal(link) });
      items.push({ label: 'Copy Link', click: () => clipboard.writeText(link) });
      items.push({ type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) });
      items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ role: 'undo', enabled: p.editFlags.canUndo }, { role: 'redo', enabled: p.editFlags.canRedo }, { type: 'separator' });
      items.push({ role: 'cut', enabled: p.editFlags.canCut });
    }
    if (p.isEditable || p.selectionText) items.push({ role: 'copy', enabled: p.editFlags.canCopy });
    if (p.isEditable) items.push({ role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' });
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
    items.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
    items.push({ label: 'Reload', click: () => reloadWc(wc) });
    items.push({ label: 'Inspect Element', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup();
  });
}

// ---------- links and popups ----------

function attachWindowRules(wc, svc) {
  wc.setWindowOpenHandler(({ url }) => {
    const target = unwrapRedirect(url);
    if (svcById(svc.id)?.mode === 'api') { openExternal(target); return { action: 'deny' }; } // links in emails
    const host = hostOf(target);
    const sameHost = host && host === hostOf(svc.url);
    const auth = AUTH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    if (url === 'about:blank' || sameHost || auth) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 1000, height: 760, autoHideMenuBar: true },
      };
    }
    openExternal(target);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    const cwc = child.webContents;
    cwc.on('did-navigate', (_e, url) => {
      if (hostOf(url) === 'accounts.google.com' && /\/signin\/rejected/.test(url)) {
        const main = views.get(svc.id)?.view.webContents;
        if (main && !main.isDestroyed()) main.loadURL(googleBlockedPage(svcById(svc.id) || svc)).catch(() => {});
        if (!child.isDestroyed()) child.close();
      }
    });
    cwc.setUserAgent(CHROME_UA);
    attachContextMenu(cwc);
    attachWindowRules(cwc, svc);
  });
}

// ---------- service views ----------

function createView(svc) {
  const partition = `persist:svc-${svc.id}`;
  setupSession(session.fromPartition(partition));
  const view = new WebContentsView({
    webPreferences: {
      partition,
      preload: path.join(__dirname, 'preload-service.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor('#ffffff');
  const wc = view.webContents;
  wc.setUserAgent(CHROME_UA);
  const entry = {
    view, fromTitle: { count: 0, dot: false }, fromPage: { count: 0, dot: false },
    unread: 0, dot: false, icon: svc.mode === 'window' || svc.mode === 'api' ? presetOf(svc).icon || null : null, loading: true,
    windowOpen: false,
  };
  views.set(svc.id, entry);
  byWc.set(wc.id, svc.id);

  wc.on('page-title-updated', (_e, title) => {
    if (svc.mode === 'window' || svc.mode === 'api') return; // counts come from the Chrome window / Gmail API
    entry.fromTitle = parseUnread(title);
    if (recomputeUnread(entry)) pushState();
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    if (svc.mode === 'window' || svc.mode === 'api') return;
    if (favicons && favicons[0] && favicons[0] !== entry.icon) { entry.icon = favicons[0]; pushState(); }
  });
  wc.on('did-navigate', (_e, url) => {
    if (capturing.delete(svc.id)) applyAudio(); // a new page has no call running
    // Google can refuse sign-in inside desktop apps like this one. Explain it, don't leave a dead end.
    if (hostOf(url) === 'accounts.google.com' && /\/signin\/rejected/.test(url)) {
      wc.loadURL(googleBlockedPage(svc)).catch(() => {});
      return;
    }
    // Signed-out Gmail/Calendar go to a Google ad page. Send them to Google sign-in instead.
    if (hostOf(url) === 'workspace.google.com' && /(^|\.)google\.com$/.test(hostOf(svc.url))) {
      const login = `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(svc.url)}`;
      wc.loadURL(login).catch(() => {});
    }
  });
  wc.on('will-navigate', (e, url) => {
    // The Gmail screen never navigates away; a link there opens in the browser.
    if (svcById(svc.id)?.mode === 'api' && !url.startsWith('file:')) { e.preventDefault(); openExternal(url); }
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // -3 = aborted (normal during redirects). Anything else on the main page: show our offline page.
    if (!isMainFrame || code === -3 || !isHttp(url)) return;
    wc.loadURL(errorPage(svc, url, desc)).catch(() => {});
  });
  wc.on('did-finish-load', () => { if (svc.zoom) wc.setZoomLevel(svc.zoom); applyAudio(); });
  wc.on('did-start-loading', () => { entry.loading = true; pushState(); });
  wc.on('did-stop-loading', () => { entry.loading = false; pushState(); });
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') setTimeout(() => { if (!wc.isDestroyed()) reloadWc(wc); }, 1500);
  });
  wc.on('will-prevent-unload', (e) => e.preventDefault()); // never block quit/reload with "leave site?"
  attachContextMenu(wc);
  attachWindowRules(wc, svc);

  win.contentView.addChildView(view);
  view.setVisible(false);
  layout();
  if (svc.mode === 'api' && API_APPS[svc.type]) {
    wc.loadFile(apiPage(svc)).catch(() => {});
    startGmail(svc);
  } else if (svc.mode === 'window' && chromePath) {
    wc.loadURL(windowPanelPage(svc, entry)).catch(() => {});
    startAccount(svc, { open: !process.env.ROOST_NO_WINDOWS });
  } else {
    wc.loadURL(svc.url).catch(() => { /* failed loads show our offline page */ });
  }
  return entry;
}

function destroyView(id) {
  const e = views.get(id);
  if (!e) return;
  byWc.delete(e.view.webContents.id);
  win.contentView.removeChildView(e.view);
  e.view.webContents.close();
  views.delete(id);
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const bottom = settings().keyBar ? KEYBAR : 0;
  const bounds = { x: SIDEBAR, y: TOPBAR, width: Math.max(0, w - SIDEBAR), height: Math.max(0, h - TOPBAR - bottom) };
  for (const e of views.values()) e.view.setBounds(bounds);
}

function errorPage(svc, url, reason) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(svc.name)} – offline</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#15151c;color:#ececf1;
font:14px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center}a{display:inline-block;margin-top:14px;
background:#7c6cff;color:#fff;padding:9px 18px;border-radius:9px;text-decoration:none;font-weight:600}
p{color:#9a9aab}</style><div><h2>Can't load ${esc(svc.name)}</h2><p>${esc(reason || 'Network error')}.<br>
Roost tries again when you are back online.</p><a id="retry" href="${esc(url)}">Try again</a></div>
<script>const go=()=>{location.href=document.getElementById('retry').href};
addEventListener('online',go);setTimeout(()=>{if(navigator.onLine)go()},20000);</script>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function googleBlockedPage(svc) {
  const isGoogleSvc = /(^|\.)google\.com$/.test(hostOf(svc.url));
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const login = `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(svc.url)}`;
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(svc.name)} – sign-in blocked</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#15151c;color:#ececf1;
font:14px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center}div{max-width:460px;padding:24px}
p{color:#9a9aab}a,button{display:inline-block;margin:10px 4px 0;border:0;font:inherit;cursor:pointer;
background:#7c6cff;color:#fff;padding:9px 18px;border-radius:9px;text-decoration:none;font-weight:600}
.ghost{background:transparent;border:1px solid #3a3a48;color:#ececf1}</style>
${isGoogleSvc ? `<div><h2>Google blocked sign-in here</h2><p>Google refuses sign-in inside desktop apps.
This is Google's rule, not a problem with your account.</p>
${API_APPS[svc.type] ? `<button data-a="use-api">Show ${esc(svc.name)} inside Roost</button>` : ''}
${chromePath ? `<button class="${API_APPS[svc.type] ? 'ghost' : ''}" data-a="use-window">Use a private ${esc(browserName(chromePath))} window</button>` : ''}
<button class="ghost" data-a="open-browser">Open in your browser</button><a class="ghost" href="${esc(login)}">Try again</a></div>`
    : `<div><h2>“Sign in with Google” does not work here</h2><p>Google refuses its sign-in inside desktop apps.
${esc(svc.name)} has other ways to sign in that work in Roost: use your <b>email address</b>
(${esc(svc.name)} sends you a code or a link) or your password.</p>
<button data-a="start-page">Sign in with email instead</button>
${chromePath ? `<button class="ghost" data-a="use-window">Use a private ${esc(browserName(chromePath))} window</button>` : ''}</div>`}
<script>document.addEventListener('click',(e)=>{const a=e.target.closest('[data-a]');
if(a&&window.__roostBridge)window.__roostBridge.action(a.dataset.a)})</script>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

const presetOf = (svc) => PRESETS.find((p) => p.type === svc.type) || {};
const profileDirOf = (id) => path.join(app.getPath('userData'), 'chrome-profiles', id);

// ---------- the top bar follows the Gmail account you use ----------
// Calendar, Keep, Drive and Docs in the top bar open as the Gmail account of the last Gmail tab you picked.
// Each (app, account) pair has its own sign-in: a Calendar key, or a private Chrome profile.

const linksToMail = (svc) => !!svc && groupOf(svc) === 'top' && (svc.type === 'calendar' || !!presetOf(svc).googleWindow);
const mailServices = () => config.services.filter((s) => s.type === 'gmail' && s.mode === 'api');
const mailEmailOf = (id) => String((gmailStore && gmailStore.getAccount(id)?.email) || '').toLowerCase();

function linkedEmail() {
  const list = mailServices();
  for (const s of [list.find((x) => x.id === config.mailId), ...list]) {
    const email = s && mailEmailOf(s.id);
    if (email) return email;
  }
  return '';
}

// The key of the account a service uses right now: "<id>|<email>" for linked top-bar apps, else "<id>".
const keyOf = (svc, email = linkedEmail()) => (linksToMail(svc) && email ? `${svc.id}|${email}` : svc.id);
const idOfKey = (key) => String(key).split('|')[0];
const emailOfKey = (key) => String(key).split('|')[1] || '';
const keysOf = (map, id) => [...map.keys()].filter((k) => idOfKey(k) === id);
const isCurrentKey = (key) => { const svc = svcById(idOfKey(key)); return !!svc && keyOf(svc) === key; };
const profileNameOf = (key) => (emailOfKey(key) ? `${idOfKey(key)}-${emailOfKey(key).replace(/[^a-z0-9]+/g, '_')}` : key);

function withAuthUser(url, email) {
  if (!email) return url;
  try { const u = new URL(url); u.searchParams.set('authuser', email); return u.toString(); } catch { return url; }
}

// Google accounts signed in to a Chrome profile (Chrome lists them in its Preferences file).
function profileEmails(dir) {
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8'));
    return (prefs.account_info || []).map((a) => String(a.email || '').toLowerCase()).filter(Boolean);
  } catch { return []; }
}

// An app's old single profile is kept for the account that is signed in to it, so that sign-in is not lost.
function adoptOldProfile(svc, key) {
  const email = emailOfKey(key);
  const from = profileDirOf(svc.id);
  const to = profileDirOf(profileNameOf(key));
  if (!email || fs.existsSync(to) || !fs.existsSync(from) || !profileEmails(from).includes(email)) return;
  try { fs.renameSync(from, to); } catch { /* keep the new, empty profile */ }
}

// The Gmail tab in use changed (or its account signed in): move the top bar to that account.
let lastLinked = null;
function mailChanged() {
  const email = linkedEmail();
  if (email === lastLinked) return;
  lastLinked = email;
  for (const svc of config.services) {
    if (!linksToMail(svc)) continue;
    const entry = views.get(svc.id);
    if (!entry) continue;
    if (svc.mode === 'api' && API_APPS[svc.type]) {
      const acc = startGmail(svc);
      sendToGmailView(keyOf(svc), { type: 'auth', ...acc.status() });
    } else if (svc.mode === 'window' && chromePath) {
      const acc = accounts.get(keyOf(svc));
      entry.fromTitle = parseUnread(acc?.lastTitle || '');
      entry.windowOpen = !!acc?.pid;
      recomputeUnread(entry);
      refreshPanel(svc);
    }
  }
  pushState();
}
const BRIDGE_ACTIONS = new Set(['show-window', 'use-window', 'use-inside', 'use-api', 'open-browser', 'start-page']);

function windowPanelPage(svc, entry) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const browser = esc(browserName(chromePath));
  const status = entry?.windowOpen ? 'Its window is open.' : 'Its window is closed.';
  const linked = linksToMail(svc) && linkedEmail();
  const who = linked ? `<p>Account: <b>${esc(linked)}</b> (the Gmail tab you use now).<br>The first time, sign in with this account in the window.</p>` : '';
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(svc.name)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15151c;color:#ececf1;
font:14px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center}div{max-width:480px;padding:24px}
p{color:#9a9aab}.note{font-size:13px}b{color:#ececf1;font-weight:600}
button{display:inline-block;margin:12px 6px 0;border:0;font:inherit;cursor:pointer;background:#7c6cff;color:#fff;
padding:9px 18px;border-radius:9px;font-weight:600}.ghost{background:transparent;border:1px solid #3a3a48;color:#ececf1}
.small{margin-top:28px;font-size:12px}.small button{font-size:12px;padding:6px 12px}</style>
<div><h2>${esc(svc.name)} opens in its own window</h2>
<p>Google only allows sign-in in a real browser, so this account runs in a private ${browser} window.
It is separate from your normal ${browser}: its own sign-in, cookies and settings. ${status}</p>
${who}<button data-a="show-window">Show ${esc(svc.name)} window</button>
<p class="small">Notifications for this account come from ${browser}.<br>
${API_APPS[svc.type] ? `<button class="ghost" data-a="use-api">Show ${esc(svc.name)} inside Roost instead</button>` : '<button class="ghost" data-a="use-inside">Try inside Roost instead</button>'}</p></div>
<script>document.addEventListener('click',(e)=>{const a=e.target.closest('[data-a]');
if(a&&window.__roostBridge)window.__roostBridge.action(a.dataset.a)})</script>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function refreshPanel(svc) {
  const entry = views.get(svc.id);
  if (!entry || svc.mode !== 'window') return;
  entry.view.webContents.loadURL(windowPanelPage(svc, entry)).catch(() => {});
}

function startAccount(svc, { open = true } = {}) {
  const key = keyOf(svc);
  if (!chromePath || accounts.has(key)) return accounts.get(key);
  const entry = views.get(svc.id);
  adoptOldProfile(svc, key);
  const acc = new ChromeAccount({
    id: key, url: withAuthUser(svc.url, emailOfKey(key)), profileDir: profileDirOf(profileNameOf(key)), chromePath,
    titleHint: presetOf(svc).titleHint || hostOf(svc.url),
  });
  accounts.set(key, acc);
  acc.on('title', (title) => {
    if (!entry || !isCurrentKey(key)) return;
    entry.fromTitle = parseUnread(title);
    if (recomputeUnread(entry)) pushState();
  });
  acc.on('state', (st) => {
    if (!entry || !isCurrentKey(key)) return;
    const open = st === 'running';
    if (open !== entry.windowOpen) { entry.windowOpen = open; entry.loading = false; refreshPanel(svc); pushState(); }
  });
  acc.on('error', () => {});
  if (open) acc.isRunning().then((running) => (running ? acc.watch() : acc.open()));
  else acc.watch();
  return acc;
}

// Stop one account window (key "<id>|<email>"), or all of an app's account windows (key "<id>").
async function stopAccount(idOrKey) {
  const keys = String(idOrKey).includes('|') ? [idOrKey] : keysOf(accounts, idOrKey);
  await Promise.all(keys.map(async (key) => {
    const acc = accounts.get(key);
    if (!acc) return;
    accounts.delete(key);
    await acc.stop().catch(() => {});
    acc.dispose();
  }));
}

// ---------- Gmail inside Roost (Gmail API) ----------

const gmailDeps = {
  openExternal: (url) => {
    if (process.env.ROOST_OAUTH_AUTO) { fetch(url).catch(() => {}); return; } // tests: follow the sign-in redirect directly
    shell.openExternal(url);
  },
  showOpenDialog: async () => {
    if (process.env.ROOST_TEST_ATTACH) {
      return process.env.ROOST_TEST_ATTACH.split(',').map((f) => ({ path: f, name: path.basename(f), size: fs.statSync(f).size }));
    }
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    return r.filePaths.map((f) => ({ path: f, name: path.basename(f), size: fs.statSync(f).size }));
  },
  showSaveDialog: async (filename) => {
    const safeName = path.basename(String(filename || 'attachment')) || 'attachment';
    if (process.env.ROOST_TEST_SAVE_DIR) return path.join(process.env.ROOST_TEST_SAVE_DIR, safeName);
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), safeName) });
    return r.canceled ? null : r.filePath;
  },
  readFile: (f) => fs.promises.readFile(f),
};

function sendToGmailView(key, event) {
  if (!isCurrentKey(key)) return; // an account the top bar does not show right now
  const id = idOfKey(key);
  const app_ = API_APPS[svcById(id)?.type];
  const wc = views.get(id)?.view.webContents;
  if (app_ && wc && !wc.isDestroyed()) wc.send(`${app_.channel}:event`, event);
}

function startGmail(svc) {
  const key = keyOf(svc);
  if (gmailAccounts.has(key)) return gmailAccounts.get(key);
  const acc = new API_APPS[svc.type].Account({ serviceId: key, store: gmailStore, deps: gmailDeps, expectEmail: emailOfKey(key) });
  gmailAccounts.set(key, acc);
  acc.on('unread', (n) => {
    const entry = views.get(svc.id);
    if (!entry || !isCurrentKey(key)) return;
    entry.fromTitle = { count: n, dot: false };
    if (recomputeUnread(entry)) pushState();
  });
  acc.on('auth', (st) => {
    sendToGmailView(key, { type: 'auth', ...st });
    if (svc.type === 'gmail') mailChanged(); // a Gmail account signed in or out: the top bar may follow it
  });
  acc.on('changed', () => sendToGmailView(key, { type: 'changed' }));
  acc.on('new-mail', ({ threadId, from, subject }) => {
    const current = svcById(svc.id);
    const policy = notifyPolicy(current);
    if (!current || !policy.show || !Notification.isSupported()) return;
    const n = new Notification({ title: from || 'New email', subtitle: current.name, body: subject, silent: policy.silent });
    if (process.env.ROOST_E2E_SCRIPT) (global.roostE2EEvents ||= []).push({ type: 'notification', title: n.title, body: n.body });
    n.on('click', () => {
      showWindow();
      select(svc.id);
      if (threadId) sendToGmailView(key, { type: 'open-thread', threadId });
    });
    n.show();
  });
  acc.on('reminder', ({ calendarId, id, summary, startMs, location }) => {
    const current = svcById(svc.id);
    const policy = notifyPolicy(current);
    if (!current || !policy.show || !Notification.isSupported()) return;
    const mins = Math.max(0, Math.round((startMs - Date.now()) / 60000));
    const time = new Date(startMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const who = emailOfKey(key);
    const n = new Notification({ title: summary, subtitle: who ? `${current.name} · ${who}` : current.name, body: `${mins ? `In ${mins} min` : 'Now'} · ${time}${location ? ` · ${location}` : ''}`, silent: policy.silent });
    if (process.env.ROOST_E2E_SCRIPT) (global.roostE2EEvents ||= []).push({ type: 'notification', title: n.title, body: n.body });
    n.on('click', () => {
      showWindow();
      const mail = who && mailServices().find((s) => mailEmailOf(s.id) === who);
      if (mail && config.mailId !== mail.id) { config.mailId = mail.id; mailChanged(); }
      select(svc.id);
      sendToGmailView(key, { type: 'open-event', calendarId, id });
    });
    n.show();
  });
  acc.startPolling();
  return acc;
}

// Revoking ends every Roost sign-in of that Google account, so only revoke when no other tile uses it.
function sharedEmail(key) {
  const email = String(gmailStore?.getAccount(key)?.email || '').toLowerCase();
  return !!email && gmailStore.accountIds().some((k) => k !== key && String(gmailStore.getAccount(k)?.email || '').toLowerCase() === email);
}

function stopGmail(id, { signOut = false } = {}) {
  const keys = new Set([...keysOf(gmailAccounts, id), ...(signOut && gmailStore ? gmailStore.accountIds().filter((k) => idOfKey(k) === id) : [])]);
  for (const key of keys) {
    const acc = gmailAccounts.get(key);
    gmailAccounts.delete(key);
    if (!acc) { if (signOut) gmailStore.removeAccount(key); continue; }
    const done = signOut ? acc.signOut({ revoke: !sharedEmail(key) }).catch(() => {}) : Promise.resolve();
    done.finally(() => acc.dispose());
  }
}

async function setMode(svc, mode) {
  const entry = views.get(svc.id);
  if (!entry || (svc.mode || 'inside') === mode) return;
  const before = svc.mode;
  if (mode === 'window' && !chromePath) {
    dialog.showMessageBox(win, { type: 'info', message: 'Google Chrome is needed', detail: 'Install Google Chrome (or Edge or Brave), then try again.' });
    return;
  }
  svc.mode = mode === 'window' || mode === 'api' ? mode : undefined;
  store.save(config);
  if (before === 'api') stopGmail(svc.id); // keep the sign-in, so switching back is instant
  if (before === 'window' && svc.mode !== 'window') await stopAccount(svc.id);
  entry.fromTitle = { count: 0, dot: false };
  entry.fromPage = { count: 0, dot: false };
  recomputeUnread(entry);
  if (svc.mode === 'window') {
    entry.icon = entry.icon || presetOf(svc).icon || null;
    refreshPanel(svc);
    startAccount(svc);
  } else if (svc.mode === 'api') {
    entry.icon = presetOf(svc).icon || entry.icon;
    entry.view.webContents.loadFile(apiPage(svc)).catch(() => {});
    startGmail(svc);
  } else {
    entry.view.webContents.loadURL(svc.url).catch(() => {});
  }
  pushState();
}

function reloadWc(wc) {
  const svc = svcOfSender(wc);
  if (svc && wc.getURL().startsWith('data:')) wc.loadURL(svc.url).catch(() => {});
  else wc.reload();
}

function setZoom(delta) {
  const svc = svcById(config.activeId);
  const e = activeEntry();
  if (!svc || !e) return;
  const level = delta === 0 ? 0 : Math.max(-3, Math.min(4, (svc.zoom || 0) + delta));
  svc.zoom = level;
  e.view.webContents.setZoomLevel(level);
  store.save(config);
}

function showActive() {
  for (const [id, e] of views) e.view.setVisible(!overlay && id === config.activeId);
}

function select(id, { focus = true } = {}) {
  if (!svcById(id)) return;
  config.activeId = id;
  if (svcById(id).type === 'gmail' && svcById(id).mode === 'api' && config.mailId !== id) {
    config.mailId = id;
    mailChanged();
  }
  showActive();
  const e = views.get(id);
  if (focus && e && !overlay) e.view.webContents.focus();
  const svc = svcById(id);
  if (focus && svc.mode === 'window' && !overlay) {
    const acc = accounts.get(keyOf(svc)) || startAccount(svc, { open: false });
    acc?.show().catch(() => {});
  }
  store.save(config);
  applyAudio();
  pushState();
}

function activeEntry() { return views.get(config.activeId); }

function selectOffset(step) {
  const list = orderedServices();
  if (!list.length) return;
  const i = list.findIndex((s) => s.id === config.activeId);
  select(list[(i + step + list.length) % list.length].id);
}

// ---------- service actions ----------

function addService({ type, name, url, group }) {
  const preset = PRESETS.find((p) => p.type === type) || PRESETS.find((p) => p.type === 'custom');
  const finalUrl = normalizeUrl(url || preset.url);
  if (!finalUrl) return { ok: false, error: 'Please enter a valid web address (https://…).' };
  const svc = {
    id: crypto.randomUUID().slice(0, 8),
    type: preset.type,
    name: String(name || '').trim().slice(0, 40) || preset.name,
    url: finalUrl,
    color: preset.color,
    muted: false,
    group: GROUPS.includes(group) ? group : preset.group || 'chat',
    ...(API_APPS[preset.type] ? { mode: 'api' } : preset.googleWindow && chromePath ? { mode: 'window' } : {}),
  };
  config.services.push(svc);
  createView(svc);
  select(svc.id);
  store.save(config);
  return { ok: true, id: svc.id };
}

function updateService({ id, name, url, group }) {
  const svc = svcById(id);
  if (!svc) return { ok: false, error: 'App not found.' };
  if (GROUPS.includes(group)) svc.group = group;
  if (name !== undefined) svc.name = String(name).trim().slice(0, 40) || svc.name;
  if (url !== undefined) {
    const u = normalizeUrl(url);
    if (!u) return { ok: false, error: 'Please enter a valid web address (https://…).' };
    if (u !== svc.url) {
      svc.url = u;
      if (svc.mode === 'window') {
        for (const key of keysOf(accounts, id)) accounts.get(key).url = withAuthUser(u, emailOfKey(key));
      } else {
        views.get(id)?.view.webContents.loadURL(u).catch(() => {});
      }
    }
  }
  store.save(config);
  pushState();
  return { ok: true };
}

async function removeService(id) {
  const svc = svcById(id);
  if (!svc) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Remove', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Remove "${svc.name}"?`,
    detail: 'This signs you out of this account in Roost and deletes its saved data on this computer.',
  });
  if (response !== 0) return;
  const idx = config.services.indexOf(svc);
  destroyView(id);
  config.services.splice(idx, 1);
  const partition = session.fromPartition(`persist:svc-${id}`);
  partition.clearStorageData().catch(() => {});
  partition.clearCache().catch(() => {});
  stopAccount(id).then(async () => {
    const root = path.dirname(profileDirOf(id));
    const names = await fs.promises.readdir(root).catch(() => []);
    await Promise.all(names.filter((n) => n === id || n.startsWith(`${id}-`))
      .map((n) => fs.promises.rm(path.join(root, n), { recursive: true, force: true })));
  }).catch(() => {});
  stopGmail(id, { signOut: true });
  fs.promises.rm(customIconFile(id), { force: true }).catch(() => {});
  customIcons.delete(id);
  if (config.activeId === id) {
    const next = config.services[Math.min(idx, config.services.length - 1)];
    config.activeId = next ? next.id : null;
  }
  showActive();
  store.save(config);
  pushState();
}

function toggleMute(id) {
  const svc = svcById(id);
  if (!svc) return;
  svc.muted = !svc.muted;
  store.save(config);
  pushState();
}

function toggleDnd() {
  config.dnd = !config.dnd;
  store.save(config);
  quietChanged();
  buildMenu();
  pushState();
}

// Per-app notification settings (from the Settings dialog).
function setAppNotify({ id, muted, sounds, badge, group }) {
  const svc = svcById(id);
  if (!svc) return { ok: false };
  if (typeof muted === 'boolean') svc.muted = muted;
  if (typeof sounds === 'boolean') svc.sounds = sounds;
  if (typeof badge === 'boolean') svc.badge = badge;
  if (GROUPS.includes(group)) svc.group = group;
  store.save(config);
  applyAudio();
  pushState();
  return { ok: true };
}

function setSettings(patch) {
  const cur = settings();
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...cur };
  if (typeof p.sounds === 'boolean') next.sounds = p.sounds;
  if (typeof p.callQuiet === 'boolean') next.callQuiet = p.callQuiet;
  if (p.mailView && typeof p.mailView === 'object') {
    const v = { ...cur.mailView };
    const pick = (k, allowed) => { if (allowed.includes(p.mailView[k])) v[k] = p.mailView[k]; };
    pick('pane', ['right', 'below', 'off']);
    pick('listWidth', ['narrow', 'normal', 'wide']);
    pick('density', ['comfortable', 'compact']);
    if (typeof p.mailView.preview === 'boolean') v.preview = p.mailView.preview;
    if (typeof p.mailView.labels === 'boolean') v.labels = p.mailView.labels;
    next.mailView = v;
    // Tell every inbox screen at once.
    for (const svc of config.services) if (svc.type === 'gmail' && svc.mode === 'api') sendToGmailView(keyOf(svc), { type: 'view', view: v });
  }
  if (typeof p.keyBar === 'boolean' && p.keyBar !== cur.keyBar) {
    next.keyBar = p.keyBar;
    config.settings = next;
    layout();
    buildMenu();
  }
  if (p.quietHours && typeof p.quietHours === 'object') {
    const okTime = (t) => /^\d{1,2}:\d{2}$/.test(String(t));
    next.quietHours = {
      on: typeof p.quietHours.on === 'boolean' ? p.quietHours.on : cur.quietHours.on,
      from: okTime(p.quietHours.from) ? p.quietHours.from : cur.quietHours.from,
      to: okTime(p.quietHours.to) ? p.quietHours.to : cur.quietHours.to,
    };
  }
  if (typeof p.dnd === 'boolean') config.dnd = p.dnd;
  config.settings = next;
  store.save(config);
  quietChanged();
  pushState();
  return { ok: true };
}

const loginItemSupported = () => app.isPackaged && (isMac || process.platform === 'win32');
function toggleOpenAtLogin() {
  const on = !app.getLoginItemSettings().openAtLogin;
  app.setLoginItemSettings({ openAtLogin: on });
  buildMenu();
  updateTray();
}

function reorder(ids, moved) {
  if (moved && svcById(moved.id) && GROUPS.includes(moved.group)) svcById(moved.id).group = moved.group;
  if (!Array.isArray(ids)) return;
  const map = new Map(config.services.map((s) => [s.id, s]));
  const next = ids.map((id) => map.get(id)).filter(Boolean);
  if (next.length !== config.services.length) return;
  config.services = next;
  store.save(config);
  pushState();
}

function tileMenu(id) {
  const svc = svcById(id);
  if (!svc) return;
  const wc = views.get(id)?.view.webContents;
  Menu.buildFromTemplate([
    ...(svc.mode === 'api' ? [
      { label: 'Reload', click: () => wc && wc.reload() },
      { label: 'Open Gmail in Browser', click: () => openExternal('https://mail.google.com/') },
    ] : svc.mode === 'window' ? [
      { label: 'Show Window', click: () => (accounts.get(keyOf(svc)) || startAccount(svc, { open: false }))?.show() },
      { label: 'Close Window', click: () => accounts.get(keyOf(svc))?.stop() },
    ] : [
      { label: 'Reload', click: () => wc && reloadWc(wc) },
      { label: 'Open in Browser', click: () => wc && openExternal(wc.getURL()) },
      { label: 'Copy Address', click: () => wc && clipboard.writeText(wc.getURL()) },
    ]),
    { label: 'Go to Start Page', click: () => wc?.loadURL(svc.url).catch(() => {}) },
    { label: 'Edit Name / Address…', click: () => win.webContents.send('ui:edit', id) },
    {
      label: 'Icon',
      submenu: [
        { label: 'App Icon', type: 'radio', checked: iconModeOf(svc) === 'app', click: () => setIconMode(svc, 'app') },
        { label: `First Letter (${firstLetter(svc.name)})`, type: 'radio', checked: iconModeOf(svc) === 'letter', click: () => setIconMode(svc, 'letter') },
        { label: 'My Picture', type: 'radio', checked: iconModeOf(svc) === 'custom', enabled: !!customIconUrl(svc), click: () => setIconMode(svc, 'custom') },
        { type: 'separator' },
        { label: 'Choose Picture…', click: () => pickCustomIcon(svc).catch(() => {}) },
      ],
    },
    {
      label: 'Move To',
      submenu: [['mail', 'Email (top of the sidebar)'], ['chat', 'Messages (below the line)'], ['top', 'Top Bar']].map(([g, label]) => ({
        label, type: 'radio', checked: groupOf(svc) === g, click: () => setAppNotify({ id, group: g }),
      })),
    },
    { label: 'Notification Settings…', click: () => openSettings('apps') },
    { label: svc.muted ? 'Unmute Notifications' : 'Mute Notifications', click: () => toggleMute(id), enabled: svc.mode !== 'window' },
    ...(svc.mode === 'api' && gmailAccounts.get(keyOf(svc))?.status().signedIn ? [{
      label: `Sign Out of ${gmailAccounts.get(keyOf(svc)).status().email || 'Gmail'}`,
      click: () => { const k = keyOf(svc); gmailAccounts.get(k)?.signOut({ revoke: !sharedEmail(k) }); },
    }] : []),
    ...(API_APPS[svc.type] ? [
      { label: `${presetOf(svc).name || svc.name} Inside Roost`, type: 'radio', checked: svc.mode === 'api', click: () => setMode(svc, 'api') },
      { label: `${presetOf(svc).name || svc.name} in a Private ${browserName(chromePath)} Window`, type: 'radio', checked: svc.mode === 'window', enabled: !!chromePath, click: () => setMode(svc, 'window') },
    ] : [svc.mode === 'window'
      ? { label: 'Open Inside Roost Instead', click: () => setMode(svc, 'inside') }
      : { label: `Open in a Private ${browserName(chromePath)} Window`, click: () => setMode(svc, 'window'), enabled: !!chromePath }]),
    { type: 'separator' },
    { label: 'Open Developer Tools', click: () => wc?.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: 'Remove…', click: () => removeService(id) },
  ]).popup({ window: win });
}

// ---------- window ----------

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function saveBounds() {
  if (win && !win.isDestroyed() && !win.isFullScreen()) {
    config.bounds = win.getNormalBounds();
    store.save(config);
  }
}

function createWindow() {
  const b = config.bounds || { width: 1280, height: 820 };
  win = new BrowserWindow({
    ...b,
    minWidth: 640,
    minHeight: 420,
    title: 'Roost',
    show: false,
    backgroundColor: '#15151c',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    icon: isMac ? undefined : path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  const atLogin = isMac && app.getLoginItemSettings().wasOpenedAtLogin;
  win.once('ready-to-show', () => { if (!process.env.ROOST_HIDDEN && !atLogin) win.show(); });
  win.on('resize', () => { layout(); saveBounds(); });
  win.on('move', saveBounds);
  win.on('close', (e) => {
    saveBounds();
    if (isMac && !quitting) {
      e.preventDefault();
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide());
        win.setFullScreen(false);
      } else {
        win.hide();
      }
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  for (const svc of config.services) createView(svc);
  if (!svcById(config.activeId)) config.activeId = config.services[0]?.id || null;
  showActive();
}

// ---------- menu bar (tray) ----------

function createTray() {
  const file = path.join(__dirname, 'assets', isMac ? 'trayTemplate.png' : 'tray.png');
  const image = nativeImage.createFromPath(file);
  if (isMac) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Roost');
  if (!isMac) tray.on('click', showWindow);
  updateTray();
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const { total, anyDot } = unreadTotals();
  if (isMac) tray.setTitle(total ? ` ${total}` : anyDot ? ' •' : '', { fontType: 'monospacedDigit' });
  tray.setToolTip(total ? `Roost – ${total} unread` : 'Roost');
  const appItems = orderedServices().map((s) => {
    const e = views.get(s.id);
    const n = e?.unread ? ` (${e.unread})` : e?.dot ? ' •' : '';
    return { label: `${s.name}${n}`, click: () => { showWindow(); select(s.id); } };
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Roost', click: showWindow },
    ...(appItems.length ? [{ type: 'separator' }, ...appItems] : []),
    { type: 'separator' },
    { label: 'Do Not Disturb', type: 'checkbox', checked: !!config.dnd, click: toggleDnd },
    ...(quietReason() === 'call' ? [{ label: 'Quiet: you are in a call', enabled: false }] : quietReason() === 'hours' ? [{ label: 'Quiet hours', enabled: false }] : []),
    { label: 'Settings…', click: () => openSettings() },
    ...(loginItemSupported() ? [{ label: 'Open at Login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: toggleOpenAtLogin }] : []),
    { type: 'separator' },
    { label: 'Quit Roost', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- menu ----------

function buildMenu() {
  const forActive = (fn) => () => { const e = activeEntry(); if (e) fn(e.view.webContents); };
  const numberItems = Array.from({ length: 9 }, (_, i) => ({
    label: `App ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => { const s = orderedServices()[i]; if (s) select(s.id); },
  }));
  const template = [
    ...(isMac ? [{
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `About ${APP_NAME}` },
        { type: 'separator' },
        ...(loginItemSupported() ? [{ label: 'Open at Login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: toggleOpenAtLogin }] : []),
        { label: 'Do Not Disturb', type: 'checkbox', checked: !!config.dnd, accelerator: 'CmdOrCtrl+Shift+D', click: toggleDnd },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${APP_NAME}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${APP_NAME}` },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Email', accelerator: 'CmdOrCtrl+N', click: composeInInbox },
        { label: 'Search All Inboxes…', accelerator: 'CmdOrCtrl+Shift+F', click: () => showUiPanel('ui:search') },
        { type: 'separator' },
        { label: 'Add App…', accelerator: 'CmdOrCtrl+T', click: () => { showWindow(); win.webContents.send('ui:add'); } },
        ...(isMac ? [] : [
          { label: 'Do Not Disturb', type: 'checkbox', checked: !!config.dnd, accelerator: 'Ctrl+Shift+D', click: toggleDnd },
          { label: 'Settings…', accelerator: 'Ctrl+,', click: () => openSettings() },
        ]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload App', accelerator: 'CmdOrCtrl+R', click: forActive(reloadWc) },
        { label: 'Hard Reload App', accelerator: 'CmdOrCtrl+Shift+R', click: forActive((wc) => wc.reloadIgnoringCache()) },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: forActive((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: forActive((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => setZoom(0.5) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => setZoom(-0.5) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => setZoom(0) },
        { type: 'separator' },
        { label: 'Shortcut Bar', type: 'checkbox', checked: settings().keyBar, click: () => setSettings({ keyBar: !settings().keyBar }) },
        { type: 'separator' },
        { label: 'App Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: forActive((wc) => wc.openDevTools({ mode: 'detach' })) },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Apps',
      submenu: [
        { label: 'Next App', accelerator: 'Ctrl+Tab', click: () => selectOffset(1) },
        { label: 'Previous App', accelerator: 'Ctrl+Shift+Tab', click: () => selectOffset(-1) },
        { label: 'Next App ', accelerator: 'CmdOrCtrl+Shift+]', click: () => selectOffset(1) },
        { label: 'Previous App ', accelerator: 'CmdOrCtrl+Shift+[', click: () => selectOffset(-1) },
        { type: 'separator' },
        ...numberItems,
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: () => showUiPanel('ui:shortcuts') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

const fromUi = (e) => win && e.sender === win.webContents;

ipcMain.handle('ui:get-state', (e) => (fromUi(e) ? { state: publicState(), presets: PRESETS } : null));
ipcMain.handle('ui:add', (e, data) => (fromUi(e) ? addService(data || {}) : { ok: false }));
ipcMain.handle('ui:update', (e, data) => (fromUi(e) ? updateService(data || {}) : { ok: false }));
ipcMain.on('ui:select', (e, id) => { if (fromUi(e)) select(id); });
ipcMain.handle('ui:search-all', (e, q) => (fromUi(e) ? searchAllInboxes(q) : { ok: false }));
ipcMain.on('ui:open-mail', (e, id, threadId) => { if (fromUi(e)) openMail(String(id), threadId); });
ipcMain.on('ui:context', (e, id) => { if (fromUi(e)) tileMenu(id); });
ipcMain.on('ui:reorder', (e, ids, moved) => { if (fromUi(e)) reorder(ids, moved); });
ipcMain.handle('ui:set-settings', (e, patch) => (fromUi(e) ? setSettings(patch) : { ok: false }));
ipcMain.handle('ui:set-app', (e, data) => (fromUi(e) ? setAppNotify(data || {}) : { ok: false }));
ipcMain.handle('ui:set-ai-key', (e, key) => {
  if (!fromUi(e)) return { ok: false };
  const k = String(key || '').trim();
  if (k && !/^sk-ant-[\w-]{20,}$/.test(k)) return { ok: false, error: 'That does not look like a Claude API key (it starts with sk-ant-).' };
  try { setAiKey(k); } catch (err) { return { ok: false, error: err.message }; }
  notifyAiStatus();
  pushState();
  return { ok: true };
});
ipcMain.on('ui:open-url', (e, url) => { if (fromUi(e)) openExternal(String(url || '')); });
ipcMain.on('ui:toggle-dnd', (e) => { if (fromUi(e)) toggleDnd(); });
ipcMain.on('ui:overlay', (e, on) => {
  if (!fromUi(e)) return;
  overlay = !!on;
  showActive();
  if (!overlay) activeEntry()?.view.webContents.focus();
});

ipcMain.on('svc:is-muted', (e) => { e.returnValue = !notifyPolicy(svcOfSender(e.sender)).show; });
ipcMain.on('svc:notify-policy', (e) => { e.returnValue = notifyPolicy(svcOfSender(e.sender)); });
ipcMain.on('svc:capture', (e, n) => {
  const id = byWc.get(e.sender.id);
  if (!id) return;
  if (Number(n) > 0) capturing.add(id); else capturing.delete(id);
  applyAudio();
});
async function handleApiCall(channel, e, method, args) {
  const svc = svcOfSender(e.sender);
  const appDef = svc && API_APPS[svc.type];
  const url = e.sender.getURL();
  if (!svc || !appDef || appDef.channel !== channel || svc.mode !== 'api' || !url.startsWith('file:')
    || !url.includes(`/${appDef.dir}/index.html`) || !(appDef.contract.includes(method) || (channel === 'gmail' && API_EXTRA.includes(method)))) {
    return { ok: false, error: 'Not allowed.' };
  }
  const acc = startGmail(svc);
  const a = args && typeof args === 'object' ? args : {};
  try {
    let data;
    if (method === 'getStatus') data = acc.status();
    else if (method === 'saveClientConfig') {
      const clientId = String(a.clientId || '').trim();
      const clientSecret = String(a.clientSecret || '').trim();
      if (!clientId || !clientSecret) throw new Error('Paste both the Client ID and the Client secret.');
      if (!/\.apps\.googleusercontent\.com$/.test(clientId) && !process.env.ROOST_GOOGLE_AUTH_URL) {
        throw new Error('That does not look like a Google Client ID (it ends with .apps.googleusercontent.com).');
      }
      gmailStore.setClient(clientId, clientSecret);
      for (const [key, other] of gmailAccounts) sendToGmailView(key, { type: 'auth', ...other.status() });
      data = {};
    } else if (method === 'aiStatus') {
      data = { configured: aiConfigured() };
    } else if (method === 'ai') {
      data = await runAiTask(a, { getKey: getAiKey });
    } else if (method === 'getView') {
      data = { view: settings().mailView };
    } else if (method === 'openViewSettings') {
      openSettings('mailview');
      data = {};
    } else if (method === 'showShortcuts') {
      showUiPanel('ui:shortcuts');
      data = {};
    } else if (method === 'searchAll') {
      showUiPanel('ui:search');
      data = {};
    } else if (method === 'openAiSettings') {
      openSettings('ai');
      data = {};
    } else if (method === 'openInGmail') {
      // Google's own AI ("Help me write" with Gemini) only exists in real Gmail. Open its compose window.
      const q = new URLSearchParams({ view: 'cm', fs: '1' });
      const email = acc.status().email;
      if (email) q.set('authuser', email);
      for (const [k, key] of [['to', 'to'], ['cc', 'cc'], ['bcc', 'bcc'], ['su', 'subject'], ['body', 'body']]) {
        if (a[key]) q.set(k, String(a[key]).slice(0, key === 'body' ? 6000 : 1000));
      }
      openExternal(`https://mail.google.com/mail/?${q}`);
      data = {};
    } else if (method === 'openExternal') {
      openExternal(String(a.url || ''));
      data = {};
    } else if (method === 'signOut') {
      data = await acc.signOut({ revoke: !sharedEmail(acc.serviceId) }); // keep other tiles of this account signed in
    } else {
      data = await acc[method](a);
    }
    return { ok: true, ...(data || {}) };
  } catch (err) {
    return {
      ok: false, error: err.message || String(err), needsSignIn: !!err.needsSignIn, needsSetup: !!err.needsSetup, apiDisabled: !!err.apiDisabled, needsAiKey: !!err.needsAiKey,
    };
  }
}
ipcMain.handle('gmail:call', (e, method, args) => handleApiCall('gmail', e, method, args));
ipcMain.handle('gcal:call', (e, method, args) => handleApiCall('gcal', e, method, args));

ipcMain.on('svc:action', (e, action) => {
  const svc = svcOfSender(e.sender);
  if (!svc || !BRIDGE_ACTIONS.has(action)) return;
  if (action === 'open-browser') openExternal(svc.url);
  if (action === 'start-page') views.get(svc.id)?.view.webContents.loadURL(svc.url).catch(() => {});
  if (action === 'use-window') setMode(svc, 'window');
  if (action === 'use-inside') setMode(svc, 'inside');
  if (action === 'use-api' && API_APPS[svc.type]) setMode(svc, 'api');
  if (action === 'show-window') (accounts.get(keyOf(svc)) || startAccount(svc, { open: false }))?.show();
});
ipcMain.on('svc:info', (e) => {
  const svc = svcOfSender(e.sender);
  e.returnValue = svc ? { type: svc.type } : null;
});
ipcMain.on('svc:unread', (e, data) => {
  const id = byWc.get(e.sender.id);
  const entry = views.get(id);
  if (!entry || !data) return;
  const count = Math.max(0, Math.min(99999, parseInt(data.count, 10) || 0));
  entry.fromPage = { count, dot: !!data.dot };
  if (recomputeUnread(entry)) pushState();
});
ipcMain.on('svc:notification-click', (e) => {
  const svc = svcOfSender(e.sender);
  showWindow();
  if (svc) select(svc.id);
});

// ---------- app lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    app.setAboutPanelOptions({ applicationName: APP_NAME });
    chromePath = findChrome();
    config = store.load();
    for (const s of config.services) if (!GROUPS.includes(s.group)) s.group = presetGroup(s.type);
    gmailStore = new GmailStore(path.join(app.getPath('userData'), 'gmail-accounts.json'), safeStorage);
    for (const s of config.services) {
      const old = s.type === 'calendar' && linksToMail(s) && gmailStore.getAccount(s.id);
      if (!old || !old.email) continue;
      const key = `${s.id}|${old.email.toLowerCase()}`;
      if (!gmailStore.getAccount(key)) gmailStore.setAccount(key, old);
      gmailStore.removeAccount(s.id);
    }
    lastLinked = null;
    if (process.env.ROOST_SEED && !config.services.length) {
      for (const type of String(process.env.ROOST_SEED).split(',')) {
        const p = PRESETS.find((x) => x.type === type);
        if (p) config.services.push({ id: crypto.randomUUID().slice(0, 8), type: p.type, name: p.name, url: p.url, color: p.color, muted: false, group: p.group, ...(API_APPS[p.type] ? { mode: 'api' } : p.googleWindow && chromePath ? { mode: 'window' } : {}) });
      }
      config.activeId = config.services[0]?.id || null;
    }
    buildMenu();
    createWindow();
    createTray();
    startCallWatch();
    win.on('focus', applyAudio);
    win.on('blur', applyAudio);
    // Google account windows may open on start; keep Roost in front of them.
    if (config.services.some((s) => s.mode === 'window')) {
      setTimeout(() => { if (win && win.isVisible()) { app.focus({ steal: true }); win.focus(); } }, 2500);
    }
    if (process.env.ROOST_SMOKE) runSmoke(process.env.ROOST_SMOKE);
    if (process.env.ROOST_E2E_SCRIPT) require(process.env.ROOST_E2E_SCRIPT)({ app, win, getState: publicState, test: { setInCall: (v) => { inCall = !!v; quietChanged(); }, notifyPolicy: (id) => notifyPolicy(svcById(id)), isAudioMuted: (id) => views.get(id)?.view.webContents.isAudioMuted(), viewBounds: (id) => views.get(id)?.view.getBounds(), viewWc: (id) => views.get(id)?.view.webContents, getAiKey, orderedIds: () => orderedServices().map((s) => s.id), pickIcon: (id) => pickCustomIcon(svcById(id)), setIconMode: (id, m) => setIconMode(svcById(id), m) }, quit: () => { quitting = true; app.quit(); } });
  });
  app.on('activate', showWindow);
  let accountsClosed = false;
  app.on('before-quit', (e) => {
    quitting = true;
    saveBounds();
    if (config) store.writeNow(config);
    if (!accountsClosed && accounts.size) {
      // Close the private Chrome windows too, then quit for real.
      e.preventDefault();
      accountsClosed = true;
      Promise.all([...accounts.keys()].map(stopAccount)).finally(() => app.quit());
    }
  });
  app.on('will-quit', () => {
    if (micWatcher) micWatcher.kill();
    if (tray && !tray.isDestroyed()) tray.destroy();
    for (const acc of gmailAccounts.values()) acc.dispose();
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}

// Test hook: ROOST_SMOKE=<dir> takes screenshots of the UI and each app, writes a report, then quits.
async function safeShot(wc, file) {
  try { fs.writeFileSync(file, (await wc.capturePage()).toPNG()); } catch { /* no display available */ }
}

async function runSmoke(dir) {
  fs.mkdirSync(dir, { recursive: true });
  await new Promise((r) => setTimeout(r, Number(process.env.ROOST_SMOKE_WAIT || 12000)));
  const report = { services: [] };
  await safeShot(win.webContents, path.join(dir, 'ui.png'));
  for (const s of config.services) {
    select(s.id);
    await new Promise((r) => setTimeout(r, 800));
    const e = views.get(s.id);
    const wc = e.view.webContents;
    await safeShot(wc, path.join(dir, `${s.type}-${s.id}.png`));
    report.services.push({
      name: s.name, url: wc.getURL(), title: wc.getTitle(), ua: await wc.executeJavaScript('navigator.userAgent'),
      notificationPatched: await wc.executeJavaScript('!!(window.Notification && window.Notification.__roost)'),
      partition: wc.session.storagePath,
    });
  }
  report.tray = tray ? { title: isMac ? tray.getTitle() : '' } : null;
  report.accounts = await Promise.all([...accounts].map(async ([id, a]) => ({
    name: svcById(id)?.name, running: await a.isRunning(), pid: a.pid, title: a.lastTitle,
    entry: { windowOpen: views.get(id)?.windowOpen, unread: views.get(id)?.unread },
  })));
  toggleDnd();
  await new Promise((r) => setTimeout(r, 500));
  const anyWc = views.get(config.services[0].id).view.webContents;
  report.dndMutes = await anyWc.executeJavaScript('window.__roostBridge.isMuted()');
  await safeShot(win.webContents, path.join(dir, 'ui-dnd.png'));
  toggleDnd();
  report.dndOffAgain = !(await anyWc.executeJavaScript('window.__roostBridge.isMuted()'));
  const off = addService({ type: 'custom', name: 'Offline test', url: 'https://roost-offline-test.invalid/' });
  await new Promise((r) => setTimeout(r, 4000));
  const offWc = views.get(off.id).view.webContents;
  report.offlinePage = offWc.getURL().startsWith('data:');
  await safeShot(offWc, path.join(dir, 'offline.png'));
  destroyView(off.id);
  config.services = config.services.filter((x) => x.id !== off.id);
  const g = config.services.find((x) => x.type === 'gmail');
  if (g) {
    const gwc = views.get(g.id).view.webContents;
    await gwc.loadURL(googleBlockedPage(g));
    select(g.id);
    await new Promise((r) => setTimeout(r, 600));
    await safeShot(gwc, path.join(dir, 'google-blocked.png'));
  }
  select(config.services[0].id);
  win.webContents.send('ui:add');
  await new Promise((r) => setTimeout(r, 800));
  await safeShot(win.webContents, path.join(dir, 'ui-add-dialog.png'));
  const slack = config.services.find((x) => x.type === 'slack');
  if (slack) {
    const swc = views.get(slack.id).view.webContents;
    select(slack.id);
    await swc.loadURL(googleBlockedPage(slack));
    await new Promise((r) => setTimeout(r, 600));
    await safeShot(swc, path.join(dir, 'slack-google-blocked.png'));
    report.slackBlockedText = await swc.executeJavaScript('document.body.innerText');
    await swc.executeJavaScript('document.querySelector("[data-a=start-page]").click()');
    await new Promise((r) => setTimeout(r, 4000));
    report.slackAfterEmailButton = swc.getURL();
  }
  report.state = publicState();
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  quitting = true;
  app.quit();
}

