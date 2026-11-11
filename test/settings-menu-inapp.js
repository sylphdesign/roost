// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for settings-menu.e2e.js. Settings menu, Apps filter, quiet pill end time.
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, getState, quit }) => {
  const out = { steps: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const shots = process.env.ROOST_E2E_SHOTS || dir;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  const ui = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await wait(200); } return false; };
  const shot = async (name) => { try { win.showInactive(); win.webContents.invalidate(); await wait(500); fs.writeFileSync(path.join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG()); } catch { /* no display */ } };
  const view = () => ui(`return { cur: [...document.querySelectorAll('#s-nav [aria-current="true"]')].map((b) => b.dataset.sec),
    shown: [...document.querySelectorAll('#settings .s-sec')].filter((s) => !s.hidden).map((s) => s.id), focus: document.activeElement && document.activeElement.dataset.sec || null };`);
  try {
    win.setContentSize(1100, 720);
    await wait(2000);

    await ui(`document.getElementById('settings-btn').click(); return true;`);
    await until(() => ui(`return document.getElementById('settings').open;`));
    let v = await view();
    step('Settings opens on Quiet time, one section shown', v.cur.join() === 'quiet' && v.shown.join() === 'sec-quiet', v);
    step('the menu lists every section', (await ui(`return [...document.querySelectorAll('#s-nav .s-nav-btn')].map((b) => b.textContent).join('|');`)) === 'Quiet time|Email view|Sounds|Apps|AI writing');
    await shot('settings-quiet');

    await ui(`document.querySelector('#s-nav [data-sec="mailview"]').click(); return true;`);
    v = await view();
    step('click "Email view": it shows, aria-current moves', v.cur.join() === 'mailview' && v.shown.join() === 'sec-mailview', v);

    await ui(`const b = document.querySelector('#s-nav [data-sec="mailview"]'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); return true;`);
    v = await view();
    step('keyboard: ArrowDown goes to Sounds and moves focus', v.cur.join() === 'sound' && v.shown.join() === 'sec-sound' && v.focus === 'sound', v);
    await ui(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); return true;`);
    v = await view();
    step('keyboard: End goes to AI writing', v.cur.join() === 'ai', v);
    await ui(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); return true;`);
    step('keyboard: ArrowDown on the last item wraps to the first', (await view()).cur.join() === 'quiet');

    await ui(`document.querySelector('#s-nav [data-sec="apps"]').click(); return true;`);
    const apps = await ui(`return { rows: [...document.querySelectorAll('#s-apps .app-row:not(.app-head)')].map((r) => r.querySelector('.app-name span').firstChild.textContent),
      note: !document.getElementById('s-apps-default').hidden, all: !!document.getElementById('s-apps-all') };`);
    step('Apps: only the app that differs from the default', apps.rows.join() === 'Slack' && !apps.note && apps.all, apps);
    await shot('settings-apps');
    await ui(`document.getElementById('s-apps-all').click(); return true;`);
    step('Apps: "Show all apps" lists all 3', (await ui(`return document.querySelectorAll('#s-apps .app-row:not(.app-head)').length;`)) === 3);
    await ui(`document.getElementById('s-close').click(); return true;`);
    await wait(300);

    // main.js sends a section name: it must land there
    win.webContents.send('ui:settings', 'mailview');
    await until(() => ui(`return document.getElementById('settings').open;`));
    v = await view();
    step('openSettings("mailview") lands on Email view', v.cur.join() === 'mailview' && v.shown.join() === 'sec-mailview', v);
    win.webContents.send('ui:settings', 'ai');
    await wait(400);
    v = await view();
    step('openSettings("ai") lands on AI writing, key field focused', v.cur.join() === 'ai' && v.shown.join() === 'sec-ai'
      && await ui(`return document.activeElement === document.getElementById('s-ai-key');`), v);

    // narrow window: the menu is a row on top
    win.setContentSize(620, 600);
    await wait(600);
    const narrow = await ui(`const n = document.getElementById('s-nav').getBoundingClientRect(), b = document.querySelector('#settings .s-body').getBoundingClientRect(), d = document.getElementById('settings');
      return { dir: getComputedStyle(document.getElementById('s-nav')).flexDirection, navBottom: n.bottom, bodyTop: b.top, sw: d.scrollWidth, cw: d.clientWidth };`);
    step('narrow window: menu is a row above the section', narrow.dir === 'row' && narrow.navBottom <= narrow.bodyTop + 1 && narrow.sw <= narrow.cw + 1, narrow);
    await shot('settings-narrow');
    win.setContentSize(1100, 720);
    await ui(`document.getElementById('s-close').click(); return true;`);
    await wait(300);

    // quiet pill shows when quiet ends
    const now = new Date();
    const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const to = new Date(now.getTime() + 30 * 60000);
    await ui(`return roost.setSettings({ quietHours: { on: true, from: '${hm(new Date(now.getTime() - 30 * 60000))}', to: '${hm(to)}' } });`);
    await until(() => getState().quiet === 'hours');
    const want = await ui(`const d = new Date(); d.setHours(${to.getHours()}, ${to.getMinutes()}, 0, 0); return d.toLocaleTimeString([], { timeStyle: 'short' });`);
    const pill = () => ui(`const p = document.getElementById('quiet-pill'); return p.hidden ? null : p.textContent;`);
    step('quiet hours: pill says "Quiet until <end>"', (await pill()) === `🔕 Quiet until ${want}`, await pill());
    step('quiet hours: DnD button title has the end time', (await ui(`return document.getElementById('dnd').title;`)).includes(`until ${want}`));
    await shot('quiet-until');
    await ui(`return roost.setSettings({ quietHours: { on: false }, dnd: true });`);
    await until(() => getState().quiet === 'dnd');
    step('Do Not Disturb: pill says until you turn it off', (await pill()) === '🔕 Do Not Disturb · until you turn it off', await pill());
    step('Do Not Disturb: button title says until you turn it off', /until you turn it off/.test(await ui(`return document.getElementById('dnd').title;`)));
    await ui(`return roost.setSettings({ dnd: false });`);
    step('not quiet: no pill', await until(async () => (await pill()) === null));
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(dir, 'settings-menu.json'), JSON.stringify(out, null, 2));
  quit();
};
