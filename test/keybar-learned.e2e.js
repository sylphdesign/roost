// The inbox shortcut bar steps back as keys are learned (config.keysLearned). Run: node test/keybar-learned.e2e.js
// Screenshots go to ROOST_E2E_SHOTS, else the temp folder.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-keybar-learned-e2e-'));
  const shots = process.env.ROOST_E2E_SHOTS || tmp;
  fs.mkdirSync(shots, { recursive: true });
  const svc = (id, type, name, group, mode, url, color) => ({ id, type, name, url, color, muted: false, group, ...(mode ? { mode } : {}) });
  const services = [
    svc('gmaila01', 'gmail', 'Personal', 'mail', 'api', 'https://mail.google.com/mail/', '#EA4335'),
    svc('wa000001', 'whatsapp', 'WhatsApp', 'chat', null, 'about:blank', '#25D366'),
  ];
  const all = Object.fromEntries(['c', '/', 'F', 'j', 'k', 'x', 'e', '#', 'r', 's', '[', ']', 'u'].map((k) => [k, 5]));
  const phases = {
    some: { j: 5, k: 7, e: 5, '#': 9, F: 5, r: 4, c: 1 },
    all,
  };
  const run = (phase) => new Promise((resolve) => {
    const ud = path.join(tmp, `ud-${phase}`);
    fs.mkdirSync(ud, { recursive: true });
    fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({ activeId: 'gmaila01', services, keysLearned: phases[phase] }));
    const env = {
      ...process.env, ROOST_USER_DATA: ud, ROOST_NO_WINDOWS: '1', ROOST_NO_CALL_WATCH: '1', ROOST_PLAIN_TOKENS: '1',
      ROOST_E2E_SCRIPT: path.join(__dirname, 'keybar-learned-inapp.js'), ROOST_E2E_OUT: tmp, ROOST_E2E_SHOTS: shots, ROOST_E2E_PHASE: phase,
    };
    const p = spawn(electron, [root], { env, stdio: 'ignore' });
    const t = setTimeout(() => p.kill(), 60000);
    p.on('exit', () => { clearTimeout(t); resolve(); });
  });
  let failed = 0;
  for (const phase of Object.keys(phases)) {
    await run(phase);
    const file = path.join(tmp, `${phase}.json`);
    if (!fs.existsSync(file)) { console.log(`FAIL [${phase}] no result`); failed++; continue; }
    for (const s of JSON.parse(fs.readFileSync(file, 'utf8')).steps) {
      if (!s.ok) failed++;
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} [${phase}] ${s.name}${s.ok ? '' : `  -> ${JSON.stringify(s.detail).slice(0, 400)}`}`);
    }
  }
  console.log(failed ? `${failed} FAILED (output in ${tmp})` : `all learned-shortcut checks passed (screenshots in ${shots})`);
  process.exit(failed ? 1 : 0);
})();
