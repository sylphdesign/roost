// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for gmail-bulk.e2e.js. Writes bulk.json and bulk.png.
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
    const rows = () => [...document.querySelectorAll('#thread-list .row')];
    const subj = (r) => r.querySelector('.row-subject').textContent;
  `;
  try {
    for (let i = 0; i < 40 && !wc; i++) { wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/gmail/index.html')); if (!wc) await wait(250); }
    await wait(1500);
    await until(`${H} return vis('screen-setup');`);
    await js(`${H} setVal('setup-client-id','123-abc.apps.googleusercontent.com'); setVal('setup-client-secret','GOCSPX-test'); document.getElementById('setup-save').click(); return true;`);
    await until(`${H} return vis('screen-signin');`);
    await js(`document.getElementById('signin-btn').click(); return true;`);
    step('mailbox opens', await until(`${H} return vis('screen-mail') && rows().length > 5;`, 15000));
    await wait(500);

    const n0 = await js(`${H} return rows().length;`);
    const first = await js(`${H} return subj(rows()[0]);`);
    step('each row has Delete and Archive buttons', await js(`${H} return rows().every((r) => r.querySelector('.row-actions [aria-label="Delete"]')) && !!rows()[0].querySelector('.row-actions [aria-label="Archive"]');`));
    await js(`${H} rows()[0].querySelector('.row-actions [aria-label="Delete"]').click(); return true;`);
    step('Delete on a row removes it without opening it', await until(`${H} return rows().length === ${n0} - 1 && !rows().some((r) => subj(r) === ${JSON.stringify(first)});`)
      && await js(`return !document.querySelector('#reader article.msg');`), await js(`${H} return rows().map(subj);`));

    await js(`${H} const r = rows(); for (const i of [0, 1, 2]) { const c = r[i].querySelector('.row-check'); c.checked = true; c.dispatchEvent(new Event('change')); } return true;`);
    step('ticking 3 rows shows "3 selected"', await until(`return !document.getElementById('bulk-bar').hidden && /3 selected/.test(document.getElementById('bulk-bar').textContent);`));
    step('the bar and tick boxes are drawn on screen', await js(`${H} const b = document.getElementById('bulk-bar');
      return b.offsetHeight > 20 && b.getBoundingClientRect().top < rows()[0].getBoundingClientRect().top
        && rows().every((r) => getComputedStyle(r.querySelector('.row-check')).opacity === '1') && rows()[0].querySelector('.row-check').offsetWidth > 10;`),
      await js(`${H} const b = document.getElementById('bulk-bar'); return { h: b.offsetHeight, op: getComputedStyle(rows()[5].querySelector('.row-check')).opacity };`));
    await wait(400);
    try { fs.writeFileSync(path.join(dir, 'bulk.png'), (await wc.capturePage()).toPNG()); } catch { /* no display */ }
    const n1 = await js(`${H} return rows().length;`);
    await js(`document.querySelector('#bulk-bar [aria-label="Delete selected"]').click(); return true;`);
    step('Delete selected removes all 3', await until(`${H} return rows().length === ${n1} - 3 && document.getElementById('bulk-bar').hidden;`), await js(`${H} return rows().length;`));

    await js(`${H} const r = rows(); for (const i of [0, 1]) { const c = r[i].querySelector('.row-check'); c.checked = true; c.dispatchEvent(new Event('change')); } return true;`);
    const n2 = await js(`${H} return rows().length;`);
    await js(`document.querySelector('#bulk-bar [aria-label="Archive selected"]').click(); return true;`);
    step('Archive selected removes 2 from Inbox', await until(`${H} return rows().length === ${n2} - 2;`));

    const t = await js(`return await window.gmail.call('listThreads', { labelId: 'TRASH' });`);
    const inTrash = (t.threads || []).map((x) => x.subject);
    step('Google got the deletes (4 more in Trash)', t.ok && inTrash.includes(first) && inTrash.length >= 5, inTrash);
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(dir, 'bulk.json'), JSON.stringify(out, null, 2));
  quit();
};
