// Runs INSIDE Roost (ROOST_E2E_SCRIPT) for linked-topbar.e2e.js. Writes linked.json.
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, getState, test, quit }) => {
  const out = { steps: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  const store = () => JSON.parse(fs.readFileSync(path.join(process.env.ROOST_USER_DATA, 'gmail-accounts.json'), 'utf8')).accounts;
  const call = (id, ch, method) => test.viewWc(id).executeJavaScript(`window.${ch}.call(${JSON.stringify(method)})`);
  const pick = async (id) => { await win.webContents.executeJavaScript(`document.querySelector('[data-id="${id}"]').click(); true`); await wait(800); };
  const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await wait(200); } return false; };
  try {
    await wait(3000);
    step('old Calendar key moved to the account key', !!store()['cal00001|test.user@example.com'] && !store().cal00001, Object.keys(store()));

    const a = await call('gmaila01', 'gmail', 'signIn');
    step('Gmail A signs in', a.ok && a.email === 'test.user@example.com', a);
    step('top bar uses Gmail A', await until(() => getState().topEmail === 'test.user@example.com'), getState().topEmail);
    const c1 = await call('cal00001', 'gcal', 'signIn');
    step('Calendar signs in as Gmail A', c1.ok && c1.email === 'test.user@example.com', c1);

    await pick('gmailb01');
    step('top bar follows Gmail B', getState().topEmail === 'b@example.com', getState().topEmail);
    const s2 = await call('cal00001', 'gcal', 'getStatus');
    step('Calendar wants Gmail B now', s2.ok && !s2.signedIn && s2.expectEmail === 'b@example.com', s2);
    step('Calendar screen asks to sign in as Gmail B', await until(() => test.viewWc('cal00001').executeJavaScript(
      `!document.getElementById('signin-expect').hidden && /b@example\\.com/.test(document.getElementById('signin-expect').textContent)`)));
    const c2 = await call('cal00001', 'gcal', 'signIn');
    step('signing in with another account is refused', !c2.ok && /signed in as test\.user@example\.com.*b@example\.com/.test(c2.error), c2);
    step('no key kept for the wrong account', !store()['cal00001|b@example.com'], Object.keys(store()));
    const keepPage = decodeURIComponent(test.viewWc('keep0001').getURL());
    step('Keep panel names Gmail B', /Account: <b>b@example\.com<\/b>/.test(keepPage));
    step('top bar label shows Gmail B', await win.webContents.executeJavaScript(`document.getElementById('top-account').textContent`) === 'b@example.com');

    await pick('gmaila01');
    step('top bar goes back to Gmail A', getState().topEmail === 'test.user@example.com', getState().topEmail);
    const s3 = await call('cal00001', 'gcal', 'getStatus');
    step('Calendar is signed in again as Gmail A', s3.ok && s3.signedIn && s3.email === 'test.user@example.com', s3);
    const keepPage2 = decodeURIComponent(test.viewWc('keep0001').getURL());
    step('Keep panel names Gmail A', /Account: <b>test\.user@example\.com<\/b>/.test(keepPage2));
    const out1 = await call('cal00001', 'gcal', 'signOut');
    const g = await call('gmaila01', 'gmail', 'getStatus');
    step('Calendar sign-out keeps Gmail A signed in', out1.ok && g.ok && g.signedIn, g);
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(process.env.ROOST_E2E_OUT, 'linked.json'), JSON.stringify(out, null, 2));
  quit();
};
