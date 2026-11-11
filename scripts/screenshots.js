// Makes the README screenshots and the animated tour with fake data (no real accounts).
// Starts Roost against the fake Google server in test/. Needs a display and ffmpeg (for the tour).
// Run: npm run screenshots   → docs/screenshots/*.png and docs/screenshots/tour.gif
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeGmail } = require('../test/fake-gmail-server');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const outDir = path.join(root, 'docs', 'screenshots');

(async () => {
  const fake = await startFakeGmail({ email: 'alex.rivera@example.com' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-shots-'));
  const ud = path.join(tmp, 'userdata');
  fs.mkdirSync(ud, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const svc = (id, type, name, group, mode, url, color) => ({ id, type, name, url, color, muted: false, group, ...(mode ? { mode } : {}) });
  fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({
    activeId: 'mailpers', mailId: 'mailpers',
    bounds: { x: 60, y: 40, width: 1440, height: 900 },
    services: [
      svc('mailpers', 'gmail', 'Personal', 'mail', 'api', 'https://mail.google.com/mail/', '#EA4335'),
      svc('mailwork', 'gmail', 'Work', 'mail', 'api', 'https://mail.google.com/mail/', '#EA4335'),
      svc('mailside', 'gmail', 'Side project', 'mail', 'api', 'https://mail.google.com/mail/', '#EA4335'),
      svc('chatwapp', 'whatsapp', 'WhatsApp', 'chat', null, 'about:blank', '#25D366'),
      svc('chatslck', 'slack', 'Slack', 'chat', null, 'about:blank', '#4A154B'),
      svc('chattele', 'telegram', 'Telegram', 'chat', null, 'about:blank', '#2AABEE'),
      svc('chatdisc', 'discord', 'Discord', 'chat', null, 'about:blank', '#5865F2'),
      svc('topcalen', 'calendar', 'Google Calendar', 'top', 'api', 'https://calendar.google.com/', '#4285F4'),
      svc('topkeepx', 'keep', 'Google Keep', 'top', 'window', 'https://keep.google.com/', '#FBBC04'),
      svc('topdrive', 'drive', 'Google Drive', 'top', 'window', 'https://drive.google.com/', '#1FA463'),
      svc('topdocsx', 'docs', 'Google Docs', 'top', 'window', 'https://docs.google.com/document/', '#4285F4'),
    ],
    settings: { keyBar: true },
  }));
  const env = {
    ...process.env,
    ROOST_USER_DATA: ud, ROOST_NO_WINDOWS: '1',
    ROOST_GOOGLE_AUTH_URL: `${fake.url}/o/oauth2/v2/auth`, ROOST_GOOGLE_TOKEN_URL: `${fake.url}/token`, ROOST_GOOGLE_REVOKE_URL: `${fake.url}/revoke`,
    ROOST_GMAIL_API_BASE: fake.url, ROOST_CALENDAR_API_BASE: fake.url, ROOST_FAKE_URL: fake.url, ROOST_OAUTH_AUTO: '1', ROOST_PLAIN_TOKENS: '1',
    ROOST_E2E_SCRIPT: path.join(__dirname, 'screenshots-inapp.js'), ROOST_E2E_OUT: outDir,
  };
  const launch = (extra) => new Promise((resolve) => {
    const p = spawn(electron, [root], { env: { ...env, ...extra }, stdio: 'inherit' });
    const t = setTimeout(() => p.kill(), 180000);
    p.on('exit', () => { clearTimeout(t); resolve(); });
  });
  await launch({});
  // First run (welcome screen): a fresh profile with no apps.
  const ud0 = path.join(tmp, 'userdata-welcome');
  fs.mkdirSync(ud0, { recursive: true });
  fs.writeFileSync(path.join(ud0, 'config.json'), JSON.stringify({ bounds: { x: 60, y: 40, width: 1440, height: 900 }, services: [], settings: { keyBar: true } }));
  await launch({ ROOST_USER_DATA: ud0, ROOST_SHOTS_PHASE: 'welcome' });
  await fake.close();
  const shots = fs.readdirSync(outDir).filter((f) => /^\d\d-.*\.png$/.test(f)).sort();
  console.log('screenshots:', shots.join(', ') || 'none');
  if (!shots.length) process.exit(1);
  try {
    // Animated tour: each screenshot for 2.5 s, 1200 px wide, one shared palette for clean colors.
    const list = path.join(tmp, 'frames.txt');
    fs.writeFileSync(list, shots.map((f) => `file '${path.join(outDir, f)}'\nduration 2.5`).join('\n') + `\nfile '${path.join(outDir, shots[shots.length - 1])}'\n`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200[p];[b][p]paletteuse=dither=sierra2_4a',
      '-loop', '0', path.join(outDir, 'tour.gif')]);
    console.log('tour.gif written');
  } catch (err) {
    console.log('tour.gif skipped (ffmpeg missing or failed):', err.message);
  }
  process.exit(0);
})();
