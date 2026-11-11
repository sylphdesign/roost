// Settings menu (one section at a time), the Apps filter and the quiet pill end time. Run: node test/settings-menu.e2e.js
// Screenshots go to ROOST_E2E_SHOTS, else the temp folder.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-settings-e2e-'));
const shots = process.env.ROOST_E2E_SHOTS || tmp;
fs.mkdirSync(shots, { recursive: true });
const ud = path.join(tmp, 'userdata');
fs.mkdirSync(ud, { recursive: true });
const svc = (id, type, name, group, color, extra = {}) => ({ id, type, name, url: 'about:blank', color, muted: false, group, ...extra });
fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({
  activeId: 'wa000001',
  services: [
    svc('wa000001', 'whatsapp', 'WhatsApp', 'chat', '#25D366'),
    svc('sl000001', 'slack', 'Slack', 'chat', '#4A154B', { sounds: false }),
    svc('tg000001', 'telegram', 'Telegram', 'chat', '#2AABEE'),
  ],
}));
const env = {
  ...process.env, ROOST_USER_DATA: ud, ROOST_NO_WINDOWS: '1', ROOST_NO_CALL_WATCH: '1', ROOST_PLAIN_TOKENS: '1',
  ROOST_E2E_SCRIPT: path.join(__dirname, 'settings-menu-inapp.js'), ROOST_E2E_OUT: tmp, ROOST_E2E_SHOTS: shots,
};
const p = spawn(electron, [root], { env, stdio: 'ignore' });
const t = setTimeout(() => p.kill(), 90000);
p.on('exit', () => {
  clearTimeout(t);
  let failed = 0;
  const file = path.join(tmp, 'settings-menu.json');
  if (!fs.existsSync(file)) { console.log('FAIL no result'); failed++; } else {
    for (const s of JSON.parse(fs.readFileSync(file, 'utf8')).steps) {
      if (!s.ok) failed++;
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name}${s.ok ? '' : `  -> ${JSON.stringify(s.detail).slice(0, 400)}`}`);
    }
  }
  console.log(failed ? `${failed} FAILED (output in ${tmp})` : `all settings checks passed (screenshots in ${shots})`);
  process.exit(failed ? 1 : 0);
});
