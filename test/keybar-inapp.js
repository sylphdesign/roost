// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for keybar.e2e.js. Writes keybar.json and keybar.png.
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, getState, test, quit }) => {
  const out = { steps: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  const ui = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const barText = () => ui(`return document.getElementById('keybar').hidden ? null : document.getElementById('keybar-keys').textContent;`);
  try {
    await wait(2500);
    const [h] = [win.getContentSize()[1]];
    step('bar shows at the bottom', await ui(`const b = document.getElementById('keybar').getBoundingClientRect(); return b.height > 20 && Math.abs(b.bottom - innerHeight) < 1;`));
    step('in an inbox it shows inbox keys', /Archive/.test(await barText()) && /Delete/.test(await barText()), await barText());
    const vb = test.viewBounds('gmaila01');
    step('the app area stops above the bar', vb.y + vb.height === h - 26, { vb, h });
    try { fs.writeFileSync(path.join(dir, 'keybar.png'), (await win.webContents.capturePage()).toPNG()); } catch { /* no display */ }

    await ui(`document.querySelector('[data-id="wa000001"]').click(); return true;`);
    await wait(500);
    step('in another app it shows app keys', /Search all inboxes/.test(await barText()), await barText());
    await ui(`document.getElementById('keybar-all').click(); return true;`);
    step('"All shortcuts" opens the full list', await ui(`return document.getElementById('keys-dlg').open;`));
    await ui(`document.getElementById('keys-close').click(); return true;`);

    await ui(`document.getElementById('keybar-hide').click(); return true;`);
    await wait(500);
    step('× hides the bar', (await barText()) === null);
    const vb2 = test.viewBounds('wa000001');
    step('the app area grows back to the bottom', vb2.y + vb2.height === h, { vb2, h });
    await wait(500);
    step('hidden stays saved', JSON.parse(fs.readFileSync(path.join(process.env.ROOST_USER_DATA, 'config.json'), 'utf8')).settings.keyBar === false);
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(dir, 'keybar.json'), JSON.stringify(out, null, 2));
  quit();
};
