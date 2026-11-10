// Gmail inbox tabs (Primary, Promotions, Social, Updates, Forums). Run: node test/tabs.e2e.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeGmail } = require('./fake-gmail-server');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

(async () => {
  const fake = await startFakeGmail();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-tabs-e2e-'));
  const env = {
    ...process.env,
    ROOST_USER_DATA: path.join(tmp, 'userdata'), ROOST_SEED: 'gmail',
    ROOST_GOOGLE_AUTH_URL: `${fake.url}/o/oauth2/v2/auth`, ROOST_GOOGLE_TOKEN_URL: `${fake.url}/token`, ROOST_GOOGLE_REVOKE_URL: `${fake.url}/revoke`,
    ROOST_GMAIL_API_BASE: fake.url, ROOST_FAKE_URL: fake.url, ROOST_OAUTH_AUTO: '1', ROOST_PLAIN_TOKENS: '1',
    ROOST_E2E_SCRIPT: path.join(__dirname, 'tabs-inapp.js'), ROOST_E2E_OUT: tmp,
  };
  await new Promise((resolve) => {
    const p = spawn(electron, [root], { env, stdio: 'ignore' });
    const t = setTimeout(() => p.kill(), 120000);
    p.on('exit', () => { clearTimeout(t); resolve(); });
  });
  let failed = 0;
  const file = path.join(tmp, 'tabs.json');
  if (!fs.existsSync(file)) { console.log('FAIL no result'); failed++; } else {
    for (const s of JSON.parse(fs.readFileSync(file, 'utf8')).steps) {
      if (!s.ok) failed++;
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name}${s.ok ? '' : `  -> ${JSON.stringify(s.detail).slice(0, 500)}`}`);
    }
  }
  await fake.close();
  console.log(failed ? `${failed} FAILED (output in ${tmp})` : `all inbox tab checks passed (screenshot in ${tmp})`);
  process.exit(failed ? 1 : 0);
})();
