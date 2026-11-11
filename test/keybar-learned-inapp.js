// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for keybar-learned.e2e.js. Phase "some": a few inbox keys learned.
// Phase "all": every inbox key learned: one last line, then the bar steps back in inboxes.
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, test, quit }) => {
  const phase = process.env.ROOST_E2E_PHASE;
  const out = { steps: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const shots = process.env.ROOST_E2E_SHOTS || dir;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  const ui = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await wait(200); } return false; };
  const shot = async (name) => { try { win.showInactive(); win.webContents.invalidate(); await wait(500); fs.writeFileSync(path.join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG()); } catch { /* no display */ } };
  const items = () => ui(`return document.getElementById('keybar').hidden ? null : [...document.querySelectorAll('#keybar-keys .keybar-item')].map((i) => i.lastChild.textContent);`);
  const barText = () => ui(`return document.getElementById('keybar').hidden ? null : document.getElementById('keybar-keys').textContent;`);
  const select = (id) => ui(`document.querySelector('[data-id="${id}"]').click(); return true;`);
  const saved = () => JSON.parse(fs.readFileSync(path.join(process.env.ROOST_USER_DATA, 'config.json'), 'utf8')).settings || {};
  try {
    win.setContentSize(1100, 720);
    await wait(2500);
    const h = win.getContentSize()[1];
    if (phase === 'some') {
      const it = await items();
      step('learned keys left the inbox bar', it && !it.includes('Move') && !it.includes('Archive') && !it.includes('Delete') && !it.includes('All inboxes'), it);
      step('keys not learned yet stay', it && it.includes('New email') && it.includes('Search') && it.includes('Tick') && it.includes('Tabs'), it);
      step('an item with one key under 5 stays (Reply: r used 4 times)', it && it.includes('Reply'), it);
      await shot('keybar-some-learned');
      await select('wa000001');
      await wait(400);
      step('the app bar is unchanged', /Search all inboxes/.test(await barText()) && /Add app/.test(await barText()), await barText());
    } else {
      step('all learned: the line shows instead of keys', (await barText()) === 'You know the shortcuts. ⌘/ shows them all.', await barText());
      step('"All shortcuts" button is still there', await ui(`const b = document.getElementById('keybar-all'); return b.offsetWidth > 0;`));
      step('inbox keeps room for the bar while the line shows', test.viewBounds('gmaila01').y + test.viewBounds('gmaila01').height === h - 26, test.viewBounds('gmaila01'));
      await shot('keybar-all-learned');
      await select('wa000001');
      step('leaving the inbox remembers the line was shown', await until(() => saved().keyBarDoneSeen === true), saved());
      step('the app bar still shows', /Search all inboxes/.test(await barText()), await barText());
      await select('gmaila01');
      step('back in the inbox: the bar is gone', await until(async () => (await barText()) === null));
      const vb = test.viewBounds('gmaila01');
      step('the inbox fills the window to the bottom', vb.y + vb.height === h, { vb, h });
      await select('wa000001');
      step('other apps still show their bar', await until(async () => /Search all inboxes/.test(await barText() || '')));
      const vb2 = test.viewBounds('wa000001');
      step('other apps keep room for the bar', vb2.y + vb2.height === h - 26, { vb2, h });
    }
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(dir, `${phase}.json`), JSON.stringify(out, null, 2));
  quit();
};
