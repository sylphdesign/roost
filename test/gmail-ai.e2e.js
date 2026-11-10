// End-to-end test of the AI writing tools in Gmail inside Roost, against the fake Google server.
// Run: node test/gmail-ai.e2e.js   (phase "fake" uses ROOST_AI_FAKE=1, phase "nokey" has no AI key)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeGmail } = require('./fake-gmail-server');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

(async () => {
  const fake = await startFakeGmail();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-gmail-ai-e2e-'));
  const outDir = path.join(tmp, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const base = {
    ...process.env,
    ROOST_SEED: 'gmail',
    ROOST_GOOGLE_AUTH_URL: `${fake.url}/o/oauth2/v2/auth`,
    ROOST_GOOGLE_TOKEN_URL: `${fake.url}/token`,
    ROOST_GOOGLE_REVOKE_URL: `${fake.url}/revoke`,
    ROOST_GMAIL_API_BASE: fake.url,
    ROOST_FAKE_URL: fake.url,
    ROOST_OAUTH_AUTO: '1',
    ROOST_PLAIN_TOKENS: '1',
    ROOST_GMAIL_POLL_MS: '60000',
    ROOST_E2E_SCRIPT: path.join(__dirname, 'gmail-ai-inapp.js'),
    ROOST_E2E_OUT: outDir,
  };
  delete base.ROOST_AI_FAKE;
  const run = (phase, extra) => new Promise((resolve) => {
    const env = { ...base, ...extra, ROOST_E2E_PHASE: phase, ROOST_USER_DATA: path.join(tmp, `userdata-${phase}`) };
    const p = spawn(electron, [root], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => p.kill(), 120000);
    p.on('exit', () => { clearTimeout(t); resolve(err); });
  });
  let failed = 0;
  let passed = 0;
  for (const [phase, extra] of [['fake', { ROOST_AI_FAKE: '1' }], ['nokey', {}]]) {
    const stderr = await run(phase, extra);
    const file = path.join(outDir, `${phase}.json`);
    if (!fs.existsSync(file)) { console.log(`FAIL ${phase}: no result. stderr:\n${stderr.slice(-2000)}`); failed++; continue; }
    const res = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const s of res.steps) {
      if (s.ok) passed++; else failed++;
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} [${phase}] ${s.name}${s.ok ? '' : `  -> ${JSON.stringify(s.detail).slice(0, 400)}`}`);
    }
    console.log(`   screenshots: ${res.screenshots.join(', ')}`);
  }
  // The AI must never send mail by itself.
  if (fake.state.sent.length) { failed++; console.log(`FAIL [server] unexpected sent mail: ${fake.state.sent.length}`); }
  await fake.close();
  console.log(`${passed} passed, ${failed} failed (output in ${tmp})`);
  process.exit(failed ? 1 : 0);
})();
