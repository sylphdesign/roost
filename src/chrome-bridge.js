// Runs a Google account in a real Chrome window with its own private profile.
//
// Why: Google refuses sign-in inside embedded browsers, and also inside a Chrome that another program
// controls (remote debugging / automation). So Roost starts plain Chrome with no control link at all:
// that is exactly what Google allows. The profile is separate from your normal Chrome.
//
// What Roost still does: start the window, bring it to the front, read its title for the unread count,
// and close it when Roost quits. The title comes from Chrome's own session file in that private profile
// (Chrome saves each window's title there and updates it live), so no extra permission is needed.
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

function candidatePaths() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const apps = [
      ['Google Chrome', 'Google Chrome'],
      ['Chromium', 'Chromium'],
      ['Microsoft Edge', 'Microsoft Edge'],
      ['Brave Browser', 'Brave Browser'],
    ];
    return apps.flatMap(([bundle, bin]) => [
      `/Applications/${bundle}.app/Contents/MacOS/${bin}`,
      path.join(home, 'Applications', `${bundle}.app`, 'Contents', 'MacOS', bin),
    ]);
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((r) => [
      path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(r, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ]);
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/snap/bin/chromium', '/usr/bin/microsoft-edge', '/usr/bin/brave-browser'];
}

function findChrome() {
  return candidatePaths().find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

function browserName(exe) {
  if (!exe) return 'Chrome';
  const base = String(exe).split(/[\\/]/).pop().replace(/\.exe$/i, '');
  return { chrome: 'Google Chrome', msedge: 'Microsoft Edge', brave: 'Brave', 'google-chrome': 'Google Chrome', 'google-chrome-stable': 'Google Chrome' }[base.toLowerCase()] || base;
}

// From `ps -axo pid=,command=` output, find the main browser process for this profile folder.
function findMainPid(psOutput, profileDir) {
  const flag = `--user-data-dir=${profileDir}`;
  for (const line of String(psOutput).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const cmd = m[2];
    if (cmd.includes(flag) && !/\s--type=/.test(cmd)) return Number(m[1]);
  }
  return null;
}

// Pick the title of the window that shows this account's site (e.g. "Inbox (3) - me@gmail.com - Gmail").
function pickTitle(titles, hint) {
  const list = (titles || []).filter(Boolean);
  if (!list.length) return '';
  const h = String(hint || '').toLowerCase();
  return list.find((t) => h && t.toLowerCase().includes(h)) || list[0];
}

// Chrome on macOS stores window state as base64 "bplist" blobs in Sessions/Apps_* and Session_* files.
// Each blob holds the window title (NSTitle). Read every string object out of a binary plist.
function bplistStrings(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const marker = buf[i];
    const kind = marker >> 4; // 5 = ASCII string, 6 = UTF-16BE string
    if (kind !== 5 && kind !== 6) continue;
    let len = marker & 0x0f;
    let start = i + 1;
    if (len === 0x0f) {
      const intMarker = buf[i + 1];
      if (intMarker === 0x10) { len = buf[i + 2]; start = i + 3; }
      else if (intMarker === 0x11) { len = buf.readUInt16BE(i + 2); start = i + 4; }
      else continue;
    }
    if (len < 4) continue;
    const bytes = kind === 5 ? len : len * 2;
    if (start + bytes > buf.length) continue;
    const raw = buf.subarray(start, start + bytes);
    let text;
    if (kind === 5) {
      if (raw.some((b) => b < 0x20 || b > 0x7e)) continue;
      text = raw.toString('latin1');
    } else {
      const le = Buffer.from(raw);
      le.swap16();
      text = le.toString('utf16le');
      if (/[\u0000-\u001F\uFFFD]/.test(text)) continue;
    }
    out.push(text);
  }
  return out;
}

// From the text of a Chrome session file, find the newest window title that matches the hint.
function titleFromSessionText(text, hint) {
  const blobs = String(text).match(/YnBsaXN0MDD[A-Za-z0-9+/=]+/g) || [];
  const h = String(hint || '').toLowerCase();
  for (let i = blobs.length - 1; i >= 0; i--) {
    let buf;
    try { buf = Buffer.from(blobs[i], 'base64'); } catch { continue; }
    const hit = bplistStrings(buf).find((t) => h && t.toLowerCase().includes(h));
    if (hit) return hit;
  }
  return null;
}

function newestSessionFile(profileDir) {
  const dir = path.join(profileDir, 'Default', 'Sessions');
  let best = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^(Apps|Session)_\d+$/.test(name)) continue;
      const full = path.join(dir, name);
      const { mtimeMs, size } = fs.statSync(full);
      if (!best || mtimeMs > best.mtimeMs) best = { full, mtimeMs, size };
    }
  } catch { return null; }
  return best;
}

function readSessionTitle(profileDir, hint) {
  const f = newestSessionFile(profileDir);
  if (!f) return null;
  const max = 1024 * 1024; // the newest state is at the end of the file
  const fd = fs.openSync(f.full, 'r');
  try {
    const len = Math.min(f.size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, f.size - len);
    return titleFromSessionText(buf.toString('latin1'), hint);
  } finally { fs.closeSync(fd); }
}

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
});

const JXA_ACTIVATE = (pid) => `
ObjC.import('AppKit');
const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${Number(pid)});
app.isNil() ? 'none' : (app.unhide, app.activateWithOptions($.NSApplicationActivateAllWindows), 'ok');`;

// Does this process own an on-screen window? (CGWindowList needs no permission for this.)
const JXA_HAS_WINDOW = (pid) => `
ObjC.import('CoreGraphics');
const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0));
let found = false;
for (let i = 0; i < list.count; i++) {
  const w = list.objectAtIndex(i);
  if (w.objectForKey('kCGWindowOwnerPID').js === ${Number(pid)} && w.objectForKey('kCGWindowLayer').js === 0) { found = true; break; }
}
found ? 'some' : 'none';`;

class ChromeAccount extends EventEmitter {
  constructor({ id, url, profileDir, chromePath, titleHint }) {
    super();
    this.id = id;
    this.url = url;
    this.profileDir = profileDir;
    this.chromePath = chromePath;
    this.titleHint = titleHint || '';
    this.pid = null;
    this.timer = null;
    this.lastTitle = null;
  }

  args() {
    return [`--user-data-dir=${this.profileDir}`, '--no-first-run', '--no-default-browser-check', `--app=${this.url}`];
  }

  async findPid() {
    if (process.platform === 'win32') return null;
    const out = await run('/bin/ps', ['-axo', 'pid=,command=']);
    this.pid = out ? findMainPid(out, this.profileDir) : null;
    return this.pid;
  }

  async isRunning() { return !!(await this.findPid()); }

  // Open the window. If this profile's Chrome already runs, Chrome opens a new window in it.
  open() {
    fs.mkdirSync(this.profileDir, { recursive: true });
    const child = spawn(this.chromePath, this.args(), { stdio: 'ignore', detached: true });
    child.on('error', (err) => this.emit('error', err));
    child.unref();
    this.watch();
  }

  watch() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), 4000);
    setTimeout(() => this.poll(), 2500);
  }

  async poll() {
    const pid = await this.findPid();
    if (!pid) { this.setTitle(''); this.emit('state', 'closed'); return; }
    this.emit('state', 'running');
    let title = null;
    try { title = readSessionTitle(this.profileDir, this.titleHint); } catch { /* file busy */ }
    if (title !== null) this.setTitle(title);
  }

  setTitle(title) {
    if (title === this.lastTitle) return;
    this.lastTitle = title;
    this.emit('title', title);
  }

  // Bring the account's window to the front, or open it if it is closed.
  async show() {
    const pid = await this.findPid();
    if (!pid) { this.open(); return 'opened'; }
    if (process.platform === 'darwin') {
      const out = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA_ACTIVATE(pid)]);
      if (out && out.trim() === 'ok') {
        // If the user closed the account's window, Chrome is still running with no window: open one.
        const visible = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA_HAS_WINDOW(pid)]);
        if (visible && visible.trim() === 'none') this.open();
        this.watch();
        return 'focused';
      }
    }
    this.open(); // other systems: Chrome brings the existing app window forward or opens one
    return 'opened';
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    const pid = await this.findPid();
    if (!pid) return;
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 20 && (await this.findPid()); i++) await new Promise((r) => setTimeout(r, 200));
  }

  dispose() { clearInterval(this.timer); this.timer = null; this.removeAllListeners(); }
}

module.exports = { ChromeAccount, findChrome, browserName, findMainPid, pickTitle, titleFromSessionText, readSessionTitle };
