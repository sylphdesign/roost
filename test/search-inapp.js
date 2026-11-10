// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for search.e2e.js. Writes search.json and search.png.
const { webContents, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, getState, test, quit }) => {
  const out = { steps: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  const ui = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const until = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await wait(200); } return false; };
  const menuItem = (label, items = Menu.getApplicationMenu().items) => {
    for (const it of items) {
      if (it.label === label) return it;
      const sub = it.submenu && menuItem(label, it.submenu.items);
      if (sub) return sub;
    }
    return null;
  };
  try {
    await wait(2500);
    const mail = getState().services.filter((s) => s.type === 'gmail').map((s) => s.id);
    const wa = getState().services.find((s) => s.type === 'whatsapp').id;
    const gm = (id) => test.viewWc(id);
    await gm(mail[0]).executeJavaScript(`window.gmail.call('saveClientConfig', { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-test' })`);
    for (const id of mail) await gm(id).executeJavaScript(`window.gmail.call('signIn')`);
    step('two inboxes signed in', (await Promise.all(mail.map((id) => gm(id).executeJavaScript(`window.gmail.call('getStatus')`)))).every((s) => s.signedIn));

    win.webContents.focus();
    menuItem('Search All Inboxes…').click();
    step('⌘⇧F opens the search box', await until(() => ui(`return document.getElementById('search-dlg').open && document.activeElement.id === 'sd-input';`)));
    await ui(`const i = document.getElementById('sd-input'); i.value = 'kickoff'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return true;`);
    step('results come from both inboxes', await until(() => ui(`return document.querySelectorAll('#sd-results .sd-group').length === 2 && [...document.querySelectorAll('.sd-row .sd-subj')].filter((n) => /Project kickoff/.test(n.textContent)).length === 2;`)),
      await ui(`return document.getElementById('sd-results').innerText.slice(0, 300);`));
    try { fs.writeFileSync(path.join(dir, 'search.png'), (await win.webContents.capturePage()).toPNG()); } catch { /* no display */ }
    await ui(`const i = document.getElementById('sd-input'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); return true;`);
    await ui(`document.getElementById('sd-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return true;`);
    step('Enter opens the email in its inbox', await until(async () => getState().activeId === mail[1]
      && await gm(mail[1]).executeJavaScript(`!!document.querySelector('#reader article.msg') && /Project kickoff/.test(document.getElementById('reader').textContent)`)), getState().activeId);
    step('search box closes', !(await ui(`return document.getElementById('search-dlg').open;`)));

    test.viewWc(wa); // WhatsApp tile: New Email goes to the last inbox
    win.webContents.executeJavaScript(`document.querySelector('[data-id="${wa}"]').click()`);
    await wait(600);
    menuItem('New Email').click();
    step('⌘N opens a new email in the last inbox', await until(async () => getState().activeId === mail[1]
      && await gm(mail[1]).executeJavaScript(`!!document.querySelector('#compose:not([hidden]), .compose:not([hidden])')`)), getState().activeId);

    menuItem('Keyboard Shortcuts').click();
    step('⌘/ shows the shortcut list', await until(() => ui(`return document.getElementById('keys-dlg').open && document.querySelectorAll('#keys-list .keys-row').length > 15;`)));
    await ui(`document.getElementById('keys-close').click(); return true;`);
    await gm(mail[0]).executeJavaScript(`window.gmail.call('showShortcuts')`);
    step('? in an inbox shows the list too', await until(() => ui(`return document.getElementById('keys-dlg').open;`)));
    await ui(`document.getElementById('keys-close').click(); return true;`);

    const before = getState().activeId;
    menuItem('Next App ').click();
    step('⌘⇧] goes to the next app', getState().activeId !== before);
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(dir, 'search.json'), JSON.stringify(out, null, 2));
  quit();
};
