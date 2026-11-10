// Sidebar sections, top bar, quiet time and Settings, inside a real Roost window. Run: node test/layout.e2e.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-layout-e2e-'));
  const env = {
    ...process.env,
    ROOST_USER_DATA: path.join(tmp, 'userdata'), ROOST_SEED: 'gmail,telegram,calendar,drive,keep',
    ROOST_NO_WINDOWS: '1', ROOST_NO_CALL_WATCH: '1', ROOST_PLAIN_TOKENS: '1',
    ROOST_E2E_SCRIPT: path.join(__dirname, 'layout-inapp.js'), ROOST_E2E_OUT: tmp,
  };
  await new Promise((resolve) => {
    const p = spawn(electron, [root], { env, stdio: 'ignore' });
    const t = setTimeout(() => p.kill(), 120000);
    p.on('exit', () => { clearTimeout(t); resolve(); });
  });
  let failed = 0;
  const file = path.join(tmp, 'layout.json');
  if (!fs.existsSync(file)) { console.log('FAIL no result'); failed++; } else {
    for (const s of JSON.parse(fs.readFileSync(file, 'utf8')).steps) {
      if (!s.ok) failed++;
      console.log(`${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.ok || !s.detail ? '' : ` — ${JSON.stringify(s.detail)}`}`);
    }
  }
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} (screenshot: ${path.join(tmp, 'layout.png')})`);
  process.exit(failed ? 1 : 0);
})();
