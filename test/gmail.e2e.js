// End-to-end test of "Gmail inside Roost" against a fake Google server. Run: node test/gmail.e2e.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeGmail } = require('./fake-gmail-server');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

(async () => {
  const fake = await startFakeGmail();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-gmail-e2e-'));
  const outDir = path.join(tmp, 'out');
  const saveDir = path.join(tmp, 'downloads');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(saveDir, { recursive: true });
  const attach = path.join(tmp, 'notes.txt');
  fs.writeFileSync(attach, 'attachment from the e2e test\n');
  const env = {
    ...process.env,
    ROOST_USER_DATA: path.join(tmp, 'userdata'),
    ROOST_SEED: 'gmail',
    ROOST_GOOGLE_AUTH_URL: `${fake.url}/o/oauth2/v2/auth`,
    ROOST_GOOGLE_TOKEN_URL: `${fake.url}/token`,
    ROOST_GOOGLE_REVOKE_URL: `${fake.url}/revoke`,
    ROOST_GMAIL_API_BASE: fake.url,
    ROOST_FAKE_URL: fake.url,
    ROOST_OAUTH_AUTO: '1',
    ROOST_PLAIN_TOKENS: '1',
    ROOST_GMAIL_POLL_MS: '1500',
    ROOST_TEST_SAVE_DIR: saveDir,
    ROOST_TEST_ATTACH: attach,
    ROOST_E2E_SCRIPT: path.join(__dirname, 'gmail-e2e-inapp.js'),
    ROOST_E2E_OUT: outDir,
  };
  const run = (phase) => new Promise((resolve) => {
    const p = spawn(electron, [root], { env: { ...env, ROOST_E2E_PHASE: phase }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => p.kill(), 120000);
    p.on('exit', () => { clearTimeout(t); resolve(err); });
  });
  let failed = 0;
  for (const phase of ['first', 'second']) {
    const stderr = await run(phase);
    const file = path.join(outDir, `${phase}.json`);
    if (!fs.existsSync(file)) { console.log(`FAIL ${phase}: no result. stderr:\n${stderr.slice(-2000)}`); failed++; continue; }
    const res = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const s of res.steps) {
      if (!s.ok) failed++;
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} [${phase}] ${s.name}${s.ok ? '' : `  -> ${JSON.stringify(s.detail).slice(0, 400)}`}`);
    }
    console.log(`   screenshots: ${res.screenshots.join(', ')}`);
  }
  // Check what the fake Google server received.
  const sent = fake.state.sent[fake.state.sent.length - 1];
  const sentOk = sent && /notes\.txt/.test(JSON.stringify(sent.attachments)) && sent.headers['in-reply-to'] && /Thanks!/.test(sent.text || '');
  if (!sentOk) failed++;
  console.log(`${sentOk ? 'ok  ' : 'FAIL'} [server] reply arrived with In-Reply-To, text and attachment${sentOk ? '' : `  -> ${JSON.stringify(sent).slice(0, 400)}`}`);
  const revoked = fake.state.requests.some((r) => r.path.startsWith('/revoke'));
  if (!revoked) failed++;
  console.log(`${revoked ? 'ok  ' : 'FAIL'} [server] sign-out revoked the token at Google`);
  await fake.close();
  console.log(failed ? `${failed} FAILED (output in ${tmp})` : `all Gmail e2e checks passed (output in ${tmp})`);
  process.exit(failed ? 1 : 0);
})();
