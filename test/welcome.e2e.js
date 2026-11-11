// Welcome screen (one-click app tiles) and calm sidebar badges, inside a real Roost window.
// Phase "welcome": a new Roost with no apps. Phase "badges": Gmail (fake Google server) + chat apps.
// Run: node test/welcome.e2e.js   (screenshots go to ROOST_E2E_SHOTS, else the temp folder)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeGmail } = require('./fake-gmail-server');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

(async () => {
  const fake = await startFakeGmail();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-welcome-e2e-'));
  const shots = process.env.ROOST_E2E_SHOTS || tmp;
  fs.mkdirSync(shots, { recursive: true });
  const base = {
    ...process.env,
    ROOST_NO_WINDOWS: '1', ROOST_NO_CALL_WATCH: '1', ROOST_PLAIN_TOKENS: '1',
    ROOST_GOOGLE_AUTH_URL: `${fake.url}/o/oauth2/v2/auth`, ROOST_GOOGLE_TOKEN_URL: `${fake.url}/token`, ROOST_GOOGLE_REVOKE_URL: `${fake.url}/revoke`,
    ROOST_GMAIL_API_BASE: fake.url, ROOST_FAKE_URL: fake.url, ROOST_OAUTH_AUTO: '1', ROOST_GMAIL_POLL_MS: '1500',
    ROOST_E2E_SCRIPT: path.join(__dirname, 'welcome-inapp.js'), ROOST_E2E_OUT: tmp, ROOST_E2E_SHOTS: shots,
  };
  // Badges phase: Gmail inside Roost plus chat apps that show a blank page (no network).
  const badgesUd = path.join(tmp, 'ud-badges');
  fs.mkdirSync(badgesUd, { recursive: true });
  const svc = (id, type, name, group, mode, url, color) => ({ id, type, name, url, color, muted: false, group, ...(mode ? { mode } : {}) });
  fs.writeFileSync(path.join(badgesUd, 'config.json'), JSON.stringify({
    activeId: 'mailpers',
    services: [
      svc('mailpers', 'gmail', 'Personal', 'mail', 'api', 'https://mail.google.com/mail/', '#EA4335'),
      svc('chatwapp', 'whatsapp', 'WhatsApp', 'chat', null, 'about:blank', '#25D366'),
      svc('chatslck', 'slack', 'Slack', 'chat', null, 'about:blank', '#4A154B'),
      svc('chattele', 'telegram', 'Telegram', 'chat', null, 'about:blank', '#2AABEE'),
    ],
  }));
  const run = (phase, ud) => new Promise((resolve) => {
    const p = spawn(electron, [root], { env: { ...base, ROOST_USER_DATA: ud, ROOST_E2E_PHASE: phase }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => p.kill(), 120000);
    p.on('exit', () => { clearTimeout(t); resolve(err); });
  });
  let failed = 0;
  for (const [phase, ud] of [['welcome', path.join(tmp, 'ud-welcome')], ['badges', badgesUd]]) {
    const stderr = await run(phase, ud);
    const file = path.join(tmp, `${phase}.json`);
    if (!fs.existsSync(file)) { console.log(`FAIL [${phase}] no result. stderr:\n${stderr.slice(-2000)}`); failed++; continue; }
    for (const s of JSON.parse(fs.readFileSync(file, 'utf8')).steps) {
      if (!s.ok) failed++;
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} [${phase}] ${s.name}${s.ok ? '' : `  -> ${JSON.stringify(s.detail).slice(0, 400)}`}`);
    }
  }
  await fake.close();
  console.log(failed ? `${failed} FAILED (output in ${tmp})` : `all welcome/badge checks passed (screenshots in ${shots})`);
  process.exit(failed ? 1 : 0);
})();
