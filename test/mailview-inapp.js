// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for mailview.e2e.js. Writes mailview.json and pictures.
const { webContents } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, quit }) => {
  const out = { steps: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  let wc;
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const ui = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const until = async (code, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await js(code)) return true; await wait(200); } return false; };
  const shot = async (n) => { try { fs.writeFileSync(path.join(dir, `mv-${n}.png`), (await wc.capturePage()).toPNG()); } catch { /* no display */ } };
  const H = `
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden && getComputedStyle(n).display !== 'none' && n.offsetWidth > 0; };
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    const setVal = (id, v) => { const n = document.getElementById(id); n.focus(); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
    const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    const openFirst = () => document.querySelector('#thread-list .row-open').click();
    const cls = () => document.getElementById('screen-mail').className;
  `;
  const setView = (v) => ui(`return await roost.setSettings({ mailView: ${JSON.stringify(v)} });`);
  try {
    for (let i = 0; i < 40 && !wc; i++) { wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/gmail/index.html')); if (!wc) await wait(250); }
    await wait(1500);
    await until(`${H} return vis('screen-setup');`);
    await js(`${H} setVal('setup-client-id','123-abc.apps.googleusercontent.com'); setVal('setup-client-secret','GOCSPX-test'); document.getElementById('setup-save').click(); return true;`);
    await until(`${H} return vis('screen-signin');`);
    await js(`document.getElementById('signin-btn').click(); return true;`);
    await until(`${H} return vis('screen-mail') && document.querySelectorAll('#thread-list .row').length > 5;`, 15000);

    await js(`${H} openFirst(); return true;`);
    step('default: email opens next to the list', await until(`${H} return vis('col-list') && vis('col-reader') && box('col-list').right <= box('col-reader').left + 1 && !!document.querySelector('#reader article.msg');`));
    await js(`${H} key('\\\\'); return true;`);
    step('\\\\ hides the list (full view of the email)', await until(`${H} return !vis('col-list') && vis('col-reader');`), await js(`${H} return cls();`));
    await shot('collapsed');
    await js(`${H} document.querySelector('.view-btn').click(); return true;`);
    step('the ⤢ button shows the list again', await until(`${H} return vis('col-list') && vis('col-reader');`));

    await setView({ listWidth: 'wide' });
    step('List width: Wide', await until(`${H} return Math.round(box('col-list').width) === 500;`), await js(`${H} return box('col-list').width;`));

    await setView({ pane: 'below' });
    step('Open emails: Under the list', await until(`${H} return vis('col-list') && vis('col-reader') && box('col-reader').top >= box('col-list').bottom - 1 && box('col-reader').width > 500;`),
      await js(`${H} return [box('col-list'), box('col-reader')].map((b) => [b.left, b.top, b.width, b.height].map(Math.round));`));
    await shot('below');

    await setView({ pane: 'off' });
    step('Full screen: list hides while reading', await until(`${H} return !vis('col-list') && vis('col-reader') && !!document.querySelector('.back-btn') && document.querySelector('.back-btn').offsetWidth > 0;`), await js(`${H} return cls();`));
    await js(`${H} key('u'); return true;`);
    step('Full screen: u goes back to a full-width list', await until(`${H} return vis('col-list') && !vis('col-reader') && box('col-list').width > 700;`), await js(`${H} return box('col-list').width;`));
    await js(`${H} openFirst(); return true;`);
    step('Full screen: clicking an email fills the screen', await until(`${H} return !vis('col-list') && vis('col-reader');`));
    await js(`${H} key('u'); return true;`);
    await setView({ pane: 'right' });

    const h1 = await js(`return document.querySelector('#thread-list .row').offsetHeight;`);
    await setView({ density: 'compact', preview: false });
    step('Compact rows without preview text are shorter', await until(`return document.querySelector('#thread-list .row').offsetHeight < ${h1} - 15 && getComputedStyle(document.querySelector('.row-snippet')).display === 'none';`),
      { before: h1, after: await js(`return document.querySelector('#thread-list .row').offsetHeight;`) });
    await shot('compact');

    await setView({ labels: false });
    step('labels column can be hidden', await until(`${H} return !vis('col-labels') && document.getElementById('menu-btn').offsetWidth > 0;`));
    await js(`document.getElementById('menu-btn').click(); return true;`);
    step('☰ still opens the labels', await until(`${H} return vis('col-labels');`));
    await js(`${H} key('Escape'); return true;`);

    await ui(`document.getElementById('settings-btn').click(); return true;`);
    await wait(600);
    step('Settings › Email view shows the choices', await ui(`return document.getElementById('s-mv-pane').value === 'right' && document.getElementById('s-mv-density').value === 'compact'
      && !document.getElementById('s-mv-preview').checked && !document.getElementById('s-mv-labels').checked && document.getElementById('s-mv-width').value === 'wide';`));
    await ui(`const s = document.getElementById('s-mv-labels'); s.click(); return true;`);
    step('changing a choice in Settings applies at once', await until(`${H} return vis('col-labels');`));
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(dir, 'mailview.json'), JSON.stringify(out, null, 2));
  quit();
};
