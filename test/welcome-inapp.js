// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for welcome.e2e.js. Writes <phase>.json and screenshots.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, getState, test, quit }) => {
  const phase = process.env.ROOST_E2E_PHASE;
  const out = { steps: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const shotsDir = process.env.ROOST_E2E_SHOTS || dir;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  const ui = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const until = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await wait(200); } return false; };
  const shot = async (name) => { try { win.showInactive(); win.webContents.invalidate(); await wait(500); fs.writeFileSync(path.join(shotsDir, `${name}.png`), (await win.webContents.capturePage()).toPNG()); } catch { /* no display */ } };
  const netErrors = [];
  win.webContents.session.webRequest.onErrorOccurred({ urls: ['https://*/*'] }, (d) => netErrors.push(`${d.error} ${d.url}`));
  try {
    win.setContentSize(1100, 720);
    await wait(2000);
    if (phase === 'welcome') {
      const tiles = await ui(`return [...document.querySelectorAll('#welcome .wtile')].map((b) => ({ type: b.dataset.type, name: b.querySelector('b').textContent,
        hint: b.querySelector('small').textContent, pressed: b.getAttribute('aria-pressed'), tag: b.tagName, img: !!b.querySelector('.icon img') }));`);
      step('welcome screen shows', await ui(`return !document.getElementById('welcome').hidden;`));
      step('heading and intro', await ui(`return document.querySelector('#welcome h1').textContent === 'Welcome to Roost'
        && document.querySelector('#welcome .welcome-intro').textContent === 'Pick the apps you use. You can add more later. Each one stays signed in on its own.';`));
      step('one tile per mail and chat app, plus Calendar', tiles.map((t) => t.type).join(',') === 'gmail,whatsapp,slack,telegram,discord,messenger,calendar', tiles);
      step('tiles are buttons with app icons', tiles.every((t) => t.tag === 'BUTTON' && t.img && t.pressed === 'false'), { missing: tiles.filter((t) => !t.img).map((t) => t.type), netErrors });
      step('hints', tiles[0].hint.startsWith('Needs your own Google key') && tiles[1].hint === 'Just sign in' && tiles[6].hint === 'Uses your Gmail key', tiles.map((t) => t.hint));
      const go = () => ui(`const b = document.getElementById('welcome-go'); return { text: b.textContent, disabled: b.disabled };`);
      let g = await go();
      step('button is off until you pick', g.disabled && g.text === 'Pick the apps you use', g);
      await shot('welcome-empty');

      const click = (type) => ui(`document.querySelector('.wtile[data-type="${type}"]').click(); return true;`);
      await click('calendar');
      await click('whatsapp');
      await click('gmail');
      g = await go();
      step('picking 3 apps: "Add 3 apps"', !g.disabled && g.text === 'Add 3 apps', g);
      step('picked tiles are pressed', await ui(`return ['gmail','whatsapp','calendar'].every((t) => document.querySelector('.wtile[data-type="' + t + '"]').getAttribute('aria-pressed') === 'true'
        && document.querySelector('.wtile[data-type="' + t + '"]').classList.contains('picked'));`));
      await ui(`document.querySelector('.wtile[data-type="slack"]').focus(); return true;`);
      await shot('welcome-picked');
      await click('whatsapp');
      g = await go();
      step('click again un-picks: "Add 2 apps"', g.text === 'Add 2 apps', g);
      step('keyboard: tiles take focus', await ui(`const b = document.querySelector('.wtile[data-type="slack"]'); b.focus(); return document.activeElement === b;`));

      await ui(`document.getElementById('welcome-more').click(); return true;`);
      await wait(300);
      const dlg = await ui(`return { open: document.getElementById('dlg').open, url: document.getElementById('f-url').value, sel: (document.querySelector('#presets .preset.selected') || {}).dataset?.type };`);
      step('"Add another website…" opens the Add form for a custom site', dlg.open && dlg.sel === 'custom', dlg);
      await ui(`document.getElementById('dlg').close(); return true;`);

      // Small window: tiles wrap to one column, nothing spills sideways.
      win.setContentSize(620, 520);
      await wait(600);
      const narrow = await ui(`const c = document.getElementById('content'), w = document.getElementById('welcome');
        return { scrollW: c.scrollWidth, clientW: c.clientWidth, cols: getComputedStyle(document.getElementById('welcome-tiles')).gridTemplateColumns.split(' ').length, top: w.getBoundingClientRect().top };`);
      step('small window: no sideways scroll, top stays reachable', narrow.scrollW <= narrow.clientW && narrow.top >= 0, narrow);
      await shot('welcome-small');
      win.setContentSize(1100, 720);
      await wait(400);
      await ui(`document.getElementById('welcome-go').click(); return true;`);
      await until(() => getState().services.length >= 2);
      await wait(800);
      const s = getState().services.map((x) => ({ type: x.type, name: x.name, group: x.group, mode: x.mode }));
      step('adds the picked apps in tile order with preset defaults', JSON.stringify(s) === JSON.stringify([
        { type: 'gmail', name: 'Gmail', group: 'mail', mode: 'api' }, { type: 'calendar', name: 'Google Calendar', group: 'top', mode: 'api' }]), s);
      step('welcome screen goes away', await ui(`return document.getElementById('welcome').hidden;`));
    }

    if (phase === 'badges') {
      const gm = test.viewWc('mailpers');
      await until(async () => !!(await gm.executeJavaScript('!!window.gmail').catch(() => false)));
      const call = (m, a) => gm.executeJavaScript(`window.gmail.call(${JSON.stringify(m)}, ${JSON.stringify(a || {})})`);
      await call('saveClientConfig', { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret' });
      const si = await call('signIn');
      step('Gmail signs in', si && si.ok, si);
      const gmail = () => getState().services.find((x) => x.id === 'mailpers');
      await until(() => gmail().unread > 0);
      // The fake inbox has only Primary mail unread: move two unread threads to Promotions.
      const unreadAll = await call('listThreads', { labelId: 'INBOX', q: 'is:unread', max: 100 });
      for (const t of ((unreadAll && unreadAll.threads) || []).slice(0, 2)) await call('modifyThread', { id: t.id, add: ['CATEGORY_PROMOTIONS'], remove: ['CATEGORY_PERSONAL'] });
      await until(() => gmail().important > 0 && gmail().important <= gmail().unread - 2, 15000); // both moved threads counted
      const g1 = gmail();
      step('Gmail: unread = all inbox, important = Primary only', g1.unread > 0 && g1.important > 0 && g1.important < g1.unread, g1);

      // Chat apps: counts come from the page title.
      test.viewWc('chatwapp').executeJavaScript(`document.title = '(3) WhatsApp'`);
      test.viewWc('chatslck').executeJavaScript(`document.title = '* general - Acme - Slack'`);
      await until(() => getState().services.find((x) => x.id === 'chatwapp').unread === 3);
      const wa = getState().services.find((x) => x.id === 'chatwapp');
      step('chat app: important = unread', wa.unread === 3 && wa.important === 3, wa);
      const badges = () => ui(`return Object.fromEntries([...document.querySelectorAll('.tile')].map((t) => { const b = t.querySelector('.badge');
        return [t.dataset.id, b ? { cls: b.className, text: b.textContent, bg: getComputedStyle(b).backgroundColor } : null]; }));`);
      let b = await badges();
      step('Gmail with Primary unread: red badge with the Primary count', b.mailpers && b.mailpers.cls === 'badge' && b.mailpers.text === String(g1.important), b.mailpers);
      step('WhatsApp: red badge 3', b.chatwapp && b.chatwapp.cls === 'badge' && b.chatwapp.text === '3', b.chatwapp);
      step('Slack: gray dot', b.chatslck && /dot/.test(b.chatslck.cls) && b.chatslck.bg !== 'rgb(255, 59, 78)', b.chatslck);
      step('Telegram: no badge', b.chattele === null, b.chattele);
      if (process.platform === 'darwin') step('Dock counts only red numbers', app.dock.getBadge() === String(g1.important + 3), { dock: app.dock.getBadge(), want: g1.important + 3 });
      const icons = await ui(`return Object.fromEntries(['chatwapp','chatslck','chattele'].map((id) => [id, (document.querySelector('.tile[data-id="' + id + '"] .icon img') || {}).src || '']));`);
      step('chat tiles show the app icon, not initials', ['chatwapp', 'chatslck', 'chattele'].every((k) => /^data:image\/png;base64,/.test(icons[k] || '')), icons);
      await shot('badges-mixed');

      // Read every Primary email: Gmail turns calm (gray number), and leaves the Dock count.
      const prim = await call('listThreads', { labelId: 'INBOX', q: 'is:unread -category:promotions -category:social -category:updates -category:forums', max: 100 });
      for (const t of (prim && prim.threads) || []) await call('modifyThread', { id: t.id, remove: ['UNREAD'] });
      await until(() => gmail().important === 0, 15000);
      const g2 = gmail();
      b = await badges();
      step('Gmail without Primary unread: calm gray badge with all unread', g2.important === 0 && g2.unread > 0 && /calm/.test(b.mailpers?.cls || '') && b.mailpers.text === String(g2.unread), { g2, badge: b.mailpers });
      if (process.platform === 'darwin') step('Dock no longer counts Gmail', app.dock.getBadge() === '3', app.dock.getBadge());
      await shot('badges-calm');
    }
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(dir, `${phase}.json`), JSON.stringify(out, null, 2));
  quit();
};
