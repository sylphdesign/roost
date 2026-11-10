// Runs INSIDE Roost for scripts/screenshots.js. Clicks through the app like a person and saves pictures.
const { webContents, BrowserWindow, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, getState, test, quit }) => {
  const dir = process.env.ROOST_E2E_OUT;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ui = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const gm = (id) => test.viewWc(id);
  const inView = (id, code) => gm(id).executeJavaScript(`(async () => { ${code} })()`);
  const until = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await wait(200); } return false; };
  const menuItem = (label, items = Menu.getApplicationMenu().items) => {
    for (const it of items) {
      if (it.label === label) return it;
      const sub = it.submenu && menuItem(label, it.submenu.items);
      if (sub) return sub;
    }
    return null;
  };
  const pick = (id) => ui(`document.querySelector('[data-id="${id}"]').click(); return true;`);

  // The window is several web pages on top of each other: the frame (sidebar, top bar) and the app.
  // Capture each one and draw them together.
  async function shot(name) {
    win.show(); win.focus();
    await wait(900);
    const scale = (await ui('return devicePixelRatio;')) || 1;
    win.webContents.invalidate();
    const layers = [{ img: await win.webContents.capturePage(), x: 0, y: 0 }];
    const overlay = await ui(`return [...document.querySelectorAll('dialog')].some((d) => d.open);`);
    const active = getState().activeId;
    const view = active && test.viewWc(active);
    if (!overlay && view) {
      view.invalidate();
      await wait(300);
      const b = test.viewBounds(active);
      layers.push({ img: await view.capturePage(), x: b.x * scale, y: b.y * scale });
    }
    const [w, h] = win.getContentSize();
    const painter = new BrowserWindow({ show: false, width: 200, height: 200 });
    await painter.loadURL('data:text/html,<canvas></canvas>');
    const data = await painter.webContents.executeJavaScript(`(async () => {
      const layers = ${JSON.stringify(layers.map((l) => ({ src: l.img.toDataURL(), x: l.x, y: l.y })))};
      const c = document.querySelector('canvas'); c.width = ${Math.round(w * scale)}; c.height = ${Math.round(h * scale)};
      const g = c.getContext('2d');
      for (const l of layers) { const im = new Image(); im.src = l.src; await im.decode(); g.drawImage(im, l.x, l.y); }
      return c.toDataURL('image/png');
    })()`);
    painter.destroy();
    fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log('saved', name);
  }

  try {
    win.setContentSize(1440, 900);
    await wait(2500);
    const mail = ['mailpers', 'mailwork', 'mailside'];
    await inView(mail[0], `return window.gmail.call('saveClientConfig', { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-test' })`);
    for (const id of mail) await inView(id, `return window.gmail.call('signIn')`);
    await pick('topcalen');
    await until(async () => !!(await gm('topcalen')?.executeJavaScript('!!window.gcal').catch(() => false)));
    await gm('topcalen').executeJavaScript(`window.gcal.call('signIn')`);
    await pick('mailpers');
    await until(() => inView('mailpers', `return document.querySelectorAll('#thread-list .row').length > 5;`), 15000);
    await wait(1500);

    // 1. Inbox with tabs and an open email
    await inView('mailpers', `[...document.querySelectorAll('#thread-list .row-open')].find((b) => /Project kickoff/.test(b.textContent)).click(); return true;`);
    await until(() => inView('mailpers', `return document.querySelectorAll('#reader article.msg').length >= 3;`));
    await shot('01-inbox');

    // 2. Tick boxes: act on many emails at once
    await inView('mailpers', `const r = [...document.querySelectorAll('#thread-list .row')]; for (const i of [2, 3, 5]) { const c = r[i].querySelector('.row-check'); c.checked = true; c.dispatchEvent(new Event('change')); } return true;`);
    await shot('02-select-many');
    await inView('mailpers', `document.querySelector('#bulk-bar .bulk-clear').click(); return true;`);

    // 3. Search all inboxes
    menuItem('Search All Inboxes…').click();
    await wait(400);
    await ui(`const i = document.getElementById('sd-input'); i.value = 'invoice'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return true;`);
    await until(() => ui(`return document.querySelectorAll('#sd-results .sd-row').length >= 3;`));
    await shot('03-search-all-inboxes');
    await ui(`document.getElementById('search-dlg').close(); return true;`);

    // 4. Google Calendar in the top bar
    await pick('topcalen');
    await until(() => gm('topcalen').executeJavaScript(`!!document.querySelector('#view .ev-title')`), 15000);
    await wait(800);
    await shot('04-calendar');

    // 5. Full view of an email (list hidden)
    await pick('mailwork');
    await until(() => inView('mailwork', `return document.querySelectorAll('#thread-list .row').length > 5;`), 15000);
    await inView('mailwork', `[...document.querySelectorAll('#thread-list .row-open')].find((b) => /invoice for October/.test(b.textContent)).click(); return true;`);
    await until(() => inView('mailwork', `return !!document.querySelector('#reader article.msg');`));
    await inView('mailwork', `document.dispatchEvent(new KeyboardEvent('keydown', { key: '\\\\', bubbles: true })); return true;`);
    await wait(500);
    await shot('05-full-view');
    await inView('mailwork', `document.dispatchEvent(new KeyboardEvent('keydown', { key: '\\\\', bubbles: true })); return true;`);

    // 6. Settings: Email view
    win.webContents.send('ui:settings', 'mailview');
    await wait(1500);
    await shot('06-settings-email-view');
    await ui(`document.getElementById('settings').close(); return true;`);

    // 7. Keyboard shortcuts
    menuItem('Keyboard Shortcuts').click();
    await wait(800);
    await shot('07-keyboard-shortcuts');
    await ui(`document.getElementById('keys-dlg').close(); return true;`);
  } catch (err) {
    console.log('screenshot run failed:', err && err.stack || err);
  }
  quit();
};
