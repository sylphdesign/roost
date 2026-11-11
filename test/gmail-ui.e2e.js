// Uses the Gmail screen like a person: setup, sign in, reply, archive, compose with rich text and
// recipient autofill, search. Run: node test/gmail-ui.e2e.js
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { startFakeGmail } = require('./fake-gmail-server');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

(async () => {
  const fake = await startFakeGmail();
  // The in-app script reads what was sent from this port.
  const peek = http.createServer((_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ sent: fake.state.sent })); });
  await new Promise((r) => peek.listen(47556, '127.0.0.1', r));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-gmail-ui-e2e-'));
  const env = {
    ...process.env,
    ROOST_USER_DATA: path.join(tmp, 'userdata'), ROOST_SEED: 'gmail',
    ROOST_GOOGLE_AUTH_URL: `${fake.url}/o/oauth2/v2/auth`, ROOST_GOOGLE_TOKEN_URL: `${fake.url}/token`, ROOST_GOOGLE_REVOKE_URL: `${fake.url}/revoke`,
    ROOST_GMAIL_API_BASE: fake.url, ROOST_FAKE_URL: fake.url, ROOST_OAUTH_AUTO: '1', ROOST_PLAIN_TOKENS: '1',
    ROOST_E2E_SCRIPT: path.join(__dirname, 'gmail-ui-inapp.js'), ROOST_E2E_OUT: tmp,
  };
  await new Promise((resolve) => {
    const p = spawn(electron, [root], { env, stdio: 'ignore' });
    const t = setTimeout(() => p.kill(), 180000);
    p.on('exit', () => { clearTimeout(t); resolve(); });
  });
  let failed = 0;
  const file = path.join(tmp, 'ui.json');
  if (!fs.existsSync(file)) { console.log('FAIL no result'); failed++; } else {
    for (const s of JSON.parse(fs.readFileSync(file, 'utf8')).steps) {
      if (!s.ok) failed++;
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name}${s.ok ? '' : `  -> ${JSON.stringify(s.detail).slice(0, 500)}`}`);
    }
  }
  peek.close();
  await fake.close();
  console.log(failed ? `${failed} FAILED (output in ${tmp})` : `all Gmail UI checks passed (screenshots in ${tmp})`);
  process.exit(failed ? 1 : 0);
})();
