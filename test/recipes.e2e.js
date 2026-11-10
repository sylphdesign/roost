// Runs the real preload (src/preload-service.js) on sample pages that copy each app's markup
// (as documented in Ferdium recipes and the Telegram Web A source) and checks the unread counts.
// Run: npm run test:e2e
const { app, BrowserWindow, ipcMain, session } = require('electron');
const http = require('http');
const path = require('path');
const os = require('os');

app.setPath('userData', path.join(os.tmpdir(), 'roost-recipes-e2e')); // never touch real app data

const WHATSAPP_DB = `<script>
const req = indexedDB.open('model-storage', 1);
req.onupgradeneeded = () => req.result.createObjectStore('chat', { keyPath: 'id' });
req.onsuccess = () => {
  const tx = req.result.transaction('chat', 'readwrite');
  const st = tx.objectStore('chat');
  st.put({ id: 1, unreadCount: 3, muteExpiration: 0 });
  st.put({ id: 2, unreadCount: 4, muteExpiration: 0 });
  st.put({ id: 3, unreadCount: 9, muteExpiration: -1 });           // muted
  st.put({ id: 4, unreadCount: 5, muteExpiration: 0, archive: true }); // archived
  st.put({ id: 5, unreadCount: 0, muteExpiration: 0 });
};
</script>`;

const CASES = [
  { type: 'slack', want: { count: 2, dot: true }, html: `
    <div class="p-channel_sidebar__channel--unread">general <span class="p-channel_sidebar__badge">1</span></div>
    <div class="p-channel_sidebar__channel--unread">random</div>
    <div class="p-channel_sidebar__channel--unread p-channel_sidebar__channel--muted">muted <span class="p-channel_sidebar__badge">4</span></div>
    <a class="p-channel_sidebar__link--unread" data-sidebar-link-id="Punreads">All unreads</a>
    <a class="p-channel_sidebar__link--unread" data-sidebar-link-id="Pthreads">Threads</a>` },
  { type: 'slack', want: { count: 0, dot: false }, html: '<div class="p-channel_sidebar__channel">general</div>' },
  { type: 'telegram', want: { count: 12, dot: false }, html: `
    <div class="chat-list custom-scroll">
      <div class="ListItem Chat chat-item-clickable private"><div class="subtitle">hi<div class="chat-badge-transition"><div class="a1B2c3D4">10</div></div></div></div>
      <div class="ListItem Chat chat-item-clickable group"><div class="subtitle">yo<div class="chat-badge-transition"><div class="x9Y8z7W6">2</div></div></div></div>
      <div class="ListItem Chat chat-item-clickable group"><div class="subtitle">old<div class="chat-badge-transition"></div></div></div>
    </div>` },
  { type: 'telegram', want: { count: 0, dot: true }, html: `
    <div class="chat-list"><div class="ListItem Chat private"><div class="subtitle">x<div class="chat-badge-transition"><div class="q1"></div></div></div></div></div>` },
  { type: 'telegram', want: { count: 5, dot: false }, html: `
    <ul class="chatlist"><li class="rp" data-peer-id="7"><span class="dialog-subtitle-badge">5</span></li>
    <li class="rp is-muted" data-peer-id="-9"><span class="dialog-subtitle-badge">9</span></li></ul>` },
  { type: 'whatsapp', host: 'localhost', wait: 3500, want: { count: 7, dot: false }, html: WHATSAPP_DB },
  { type: 'whatsapp', want: null, html: '<p>No chat database yet (not signed in).</p>', checkNoDb: true },
  { type: 'discord', want: { count: 7, dot: false }, html: `
    <nav><div class="listItem_x"><div class="lowerBadge_ab"><div class="numberBadge_cd">7</div></div></div>
    <div class="listItem_y"><div class="upperBadge_q"><div class="numberBadge_cd">3</div></div></div></nav>` },
  { type: 'gmail', want: null, html: '<p>Gmail uses the page title, no recipe.</p>' },
];

app.whenReady().then(async () => {
  await session.defaultSession.clearStorageData();
  const server = http.createServer((req, res) => {
    const c = CASES[Number(req.url.split('/')[2])];
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>t</title><body>${c ? c.html : ''}</body>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let current = null;
  let got = [];
  ipcMain.on('svc:info', (e) => { e.returnValue = { type: current.type }; });
  ipcMain.on('svc:is-muted', (e) => { e.returnValue = false; });
  ipcMain.on('svc:unread', (_e, data) => got.push(data));
  let failed = 0;
  for (const [i, c] of CASES.entries()) {
    current = c;
    got = [];
    const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload-service.js'), sandbox: true, contextIsolation: true } });
    await w.loadURL(`http://${c.host || '127.0.0.1'}:${port}/case/${i}`);
    await new Promise((r) => setTimeout(r, c.wait || 900));
    const last = got[got.length - 1] || null;
    let ok = JSON.stringify(last) === JSON.stringify(c.want);
    let note = '';
    if (c.checkNoDb) {
      const dbs = await w.webContents.executeJavaScript('indexedDB.databases().then((d) => d.map((x) => x.name))');
      if (dbs.length) { ok = false; note = ` (created databases: ${dbs})`; } else note = ' (no database created)';
    }
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.type.padEnd(9)} want ${JSON.stringify(c.want)} got ${JSON.stringify(last)}${note}`);
    w.destroy();
  }
  server.close();
  console.log(failed ? `${failed} failed` : 'all recipe checks passed');
  app.exit(failed ? 1 : 0);
});
app.on('window-all-closed', () => {});
