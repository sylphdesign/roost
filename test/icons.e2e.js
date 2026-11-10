// Tile icons: Gmail tiles show a letter, any tile can show your own picture or the app icon. Run: node test/icons.e2e.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-icons-e2e-'));
const ud = path.join(tmp, 'userdata');
fs.mkdirSync(ud, { recursive: true });
const svc = (id, type, name, group, mode, url) => ({ id, type, name, url, color: '#EA4335', muted: false, group, ...(mode ? { mode } : {}) });
fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({
  activeId: 'gmaila01',
  services: [
    svc('gmaila01', 'gmail', 'Personal', 'mail', 'api', 'https://mail.google.com/mail/'),
    svc('gmailb01', 'gmail', 'work', 'mail', 'api', 'https://mail.google.com/mail/'),
    svc('wa000001', 'whatsapp', 'WhatsApp', 'chat', null, 'about:blank'),
  ],
}));
const env = {
  ...process.env, ROOST_USER_DATA: ud, ROOST_NO_WINDOWS: '1', ROOST_PLAIN_TOKENS: '1',
  ROOST_TEST_ICON: path.join(root, 'src', 'assets', 'icon.png'),
  ROOST_E2E_SCRIPT: path.join(__dirname, 'icons-inapp.js'), ROOST_E2E_OUT: tmp,
};
const p = spawn(electron, [root], { env, stdio: 'ignore' });
const t = setTimeout(() => p.kill(), 60000);
p.on('exit', () => {
  clearTimeout(t);
  let failed = 0;
  const file = path.join(tmp, 'icons.json');
  if (!fs.existsSync(file)) { console.log('FAIL no result'); failed++; } else {
    for (const s of JSON.parse(fs.readFileSync(file, 'utf8')).steps) {
      if (!s.ok) failed++;
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name}${s.ok ? '' : `  -> ${JSON.stringify(s.detail).slice(0, 400)}`}`);
    }
  }
  console.log(failed ? `${failed} FAILED (output in ${tmp})` : `all icon checks passed (screenshot ${path.join(tmp, 'icons.png')})`);
  process.exit(failed ? 1 : 0);
});
