// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for icons.e2e.js. Writes icons.json and icons.png.
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, test, quit }) => {
  const out = { steps: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  const tile = (id) => win.webContents.executeJavaScript(`(() => { const i = document.querySelector('.tile[data-id="${id}"] .icon');
    return i && { cls: i.className, text: i.textContent.trim(), bg: i.style.background, img: (i.querySelector('img') || {}).src || '' }; })()`);
  try {
    await wait(2500);
    const a = await tile('gmaila01');
    const b = await tile('gmailb01');
    step('Gmail tile shows its first letter', a && /letter/.test(a.cls) && a.text === 'P', a);
    step('lowercase name gives a capital letter', b && b.text === 'W', b);
    step('letter tiles get different colors', a && b && a.bg !== b.bg, [a && a.bg, b && b.bg]);
    const w = await tile('wa000001');
    step('other apps keep their normal icon', w && !/letter/.test(w.cls), w);

    await test.pickIcon('gmailb01');
    await wait(500);
    const c = await tile('gmailb01');
    step('a chosen picture shows as the icon', c && /custom/.test(c.cls) && c.img.startsWith('data:image/png'), c && { cls: c.cls, img: c.img.slice(0, 30) });
    step('the picture is saved', fs.existsSync(path.join(process.env.ROOST_USER_DATA, 'icons', 'gmailb01.png')));
    step('the choice is saved', await wait(600).then(() => JSON.parse(fs.readFileSync(path.join(process.env.ROOST_USER_DATA, 'config.json'), 'utf8')).services.find((s) => s.id === 'gmailb01').iconMode === 'custom'));
    try { fs.writeFileSync(path.join(dir, 'icons.png'), (await win.webContents.capturePage()).toPNG()); } catch { /* no display */ }

    test.setIconMode('gmaila01', 'app');
    await wait(400);
    const d = await tile('gmaila01');
    step('App Icon brings the Gmail icon back', d && !/letter|custom/.test(d.cls) && /gmail/.test(d.img), d);
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(dir, 'icons.json'), JSON.stringify(out, null, 2));
  quit();
};
