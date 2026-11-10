// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for tabs.e2e.js. Writes tabs.json and tabs.png.
const { webContents } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ quit }) => {
  const out = { steps: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  let wc;
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const until = async (code, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await js(code)) return true; await wait(200); } return false; };
  const H = `
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden && getComputedStyle(n).display !== 'none'; };
    const setVal = (id, v) => { const n = document.getElementById(id); n.focus(); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
    const subjects = () => [...document.querySelectorAll('#thread-list .row .row-subject')].map((n) => n.textContent);
    const tab = (id) => document.querySelector('.cat-tab[data-cat="' + id + '"]');
    const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  `;
  try {
    for (let i = 0; i < 40 && !wc; i++) { wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/gmail/index.html')); if (!wc) await wait(250); }
    await wait(1500);
    await until(`${H} return vis('screen-setup');`);
    await js(`${H} setVal('setup-client-id','123-abc.apps.googleusercontent.com'); setVal('setup-client-secret','GOCSPX-test'); document.getElementById('setup-save').click(); return true;`);
    await until(`${H} return vis('screen-signin');`);
    await js(`document.getElementById('signin-btn').click(); return true;`);
    step('inbox opens on the Primary tab', await until(`${H} return vis('cat-tabs') && tab('primary').classList.contains('on') && subjects().length > 5;`, 15000));
    step('Primary has no Promotions or Updates mail', await js(`${H} const s = subjects(); return s.includes('Project kickoff') && !s.includes('Quick question') && !s.includes('Holiday schedule');`), await js(`${H} return subjects();`));
    await js(`${H} tab('promotions').click(); return true;`);
    step('Promotions tab shows only promotions', await until(`${H} const s = subjects(); return tab('promotions').classList.contains('on') && s.length === 1 && s[0] === 'Quick question';`), await js(`${H} return subjects();`));
    try { fs.writeFileSync(path.join(dir, 'tabs.png'), (await wc.capturePage()).toPNG()); } catch { /* no display */ }
    await js(`${H} key(']'); return true;`);
    step('] goes to the Social tab', await until(`${H} return tab('social').classList.contains('on') && subjects()[0] === 'New feature announcement';`), await js(`${H} return subjects();`));
    await js(`${H} key(']'); return true;`);
    step('Updates tab', await until(`${H} return tab('updates').classList.contains('on') && subjects().length === 1 && subjects()[0] === 'Holiday schedule';`), await js(`${H} return subjects();`));
    await js(`${H} key('['); key('['); key('['); return true;`);
    step('[ goes back to Primary', await until(`${H} return tab('primary').classList.contains('on') && subjects().includes('Project kickoff');`));
    await js(`${H} [...document.querySelectorAll('.label-item')].find((b) => /Starred/.test(b.textContent)).click(); return true;`);
    step('tabs hide outside the Inbox', await until(`${H} return !vis('cat-tabs');`));
    await js(`${H} [...document.querySelectorAll('.label-item')].find((b) => /Inbox/.test(b.textContent)).click(); return true;`);
    await js(`${H} tab('updates').click(); return true;`);
    await until(`${H} return tab('updates').classList.contains('on') && subjects().length === 1;`);
    await js(`location.reload(); return true;`).catch(() => {});
    await wait(3000);
    step('the chosen tab is remembered', await until(`${H} return vis('cat-tabs') && tab('updates').classList.contains('on');`, 10000));
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(dir, 'tabs.json'), JSON.stringify(out, null, 2));
  quit();
};
