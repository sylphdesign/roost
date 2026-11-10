// The top bar follows the Gmail tab in use: Calendar and the Chrome-window apps use that Gmail account.
// Run: node test/linked-topbar.e2e.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeGmail } = require('./fake-gmail-server');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

(async () => {
  const fake = await startFakeGmail(); // every sign-in at the fake Google is test.user@example.com
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-linked-e2e-'));
  const ud = path.join(tmp, 'userdata');
  fs.mkdirSync(ud, { recursive: true });
  const svc = (id, type, group, mode, url) => ({ id, type, name: type, url, color: '#888', muted: false, group, ...(mode ? { mode } : {}) });
  fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({
    activeId: 'gmaila01',
    services: [
      svc('gmaila01', 'gmail', 'mail', 'api', 'https://mail.google.com/mail/'),
      svc('gmailb01', 'gmail', 'mail', 'api', 'https://mail.google.com/mail/'),
      svc('cal00001', 'calendar', 'top', 'api', 'https://calendar.google.com/'),
      svc('keep0001', 'keep', 'top', 'window', 'https://keep.google.com/'),
    ],
  }));
  // Gmail B is "b@example.com" (its key is not valid at the fake Google; only its address matters here).
  // The Calendar has an old single key: Roost must move it to "cal00001|test.user@example.com".
  fs.writeFileSync(path.join(ud, 'gmail-accounts.json'), JSON.stringify({
    client: { id: '123-abc.apps.googleusercontent.com', secret: 'plain:GOCSPX-test' },
    accounts: {
      gmailb01: { email: 'b@example.com', refresh: 'plain:1//not-valid' },
      cal00001: { email: 'test.user@example.com', refresh: 'plain:1//old-cal-key' },
    },
  }));
  const env = {
    ...process.env,
    ROOST_USER_DATA: ud, ROOST_NO_WINDOWS: '1',
    ROOST_GOOGLE_AUTH_URL: `${fake.url}/o/oauth2/v2/auth`, ROOST_GOOGLE_TOKEN_URL: `${fake.url}/token`, ROOST_GOOGLE_REVOKE_URL: `${fake.url}/revoke`,
    ROOST_GMAIL_API_BASE: fake.url, ROOST_CALENDAR_API_BASE: fake.url, ROOST_FAKE_URL: fake.url, ROOST_OAUTH_AUTO: '1', ROOST_PLAIN_TOKENS: '1',
    ROOST_E2E_SCRIPT: path.join(__dirname, 'linked-topbar-inapp.js'), ROOST_E2E_OUT: tmp,
  };
  await new Promise((resolve) => {
    const p = spawn(electron, [root], { env, stdio: 'ignore' });
    const t = setTimeout(() => p.kill(), 120000);
    p.on('exit', () => { clearTimeout(t); resolve(); });
  });
  let failed = 0;
  const file = path.join(tmp, 'linked.json');
  if (!fs.existsSync(file)) { console.log('FAIL no result'); failed++; } else {
    for (const s of JSON.parse(fs.readFileSync(file, 'utf8')).steps) {
      if (!s.ok) failed++;
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name}${s.ok ? '' : `  -> ${JSON.stringify(s.detail).slice(0, 500)}`}`);
    }
  }
  await fake.close();
  console.log(failed ? `${failed} FAILED (output in ${tmp})` : 'all linked top bar checks passed');
  process.exit(failed ? 1 : 0);
})();
