// Runs INSIDE Roost (ROOST_E2E_SCRIPT). Checks sidebar sections, the top bar, quiet time and Settings. Writes layout.json.
const { webContents } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, getState, test, quit }) => {
  const out = { steps: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  const ui = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await wait(200); } return false; };
  const byType = (t) => getState().services.find((s) => s.type === t);
  try {
    await until(async () => (await ui('return document.querySelectorAll(".tile").length')) >= 5);
    const g = byType('gmail'); const tg = byType('telegram'); const cal = byType('calendar'); const drive = byType('drive'); const keep = byType('keep');
    const ids = (sel) => ui(`return [...document.querySelectorAll('${sel} .tile')].map((n) => n.dataset.id)`);
    step('email section holds Gmail', JSON.stringify(await ids('#list-mail')) === JSON.stringify([g.id]));
    step('messages section holds Telegram', JSON.stringify(await ids('#list-chat')) === JSON.stringify([tg.id]));
    step('divider shows between them', await ui(`const d=document.getElementById('divider'); return !d.hidden && d.offsetHeight > 0 && d.getBoundingClientRect().top > document.querySelector('#list-mail .tile').getBoundingClientRect().bottom - 1`));
    step('top bar holds Calendar, Drive, Keep', JSON.stringify(await ids('#list-top')) === JSON.stringify([cal.id, drive.id, keep.id]), await ids('#list-top'));
    step('top bar sits right of the sidebar, at the top', await ui(`const r=document.getElementById('topbar').getBoundingClientRect(); return r.top === 0 && r.left === 76 && r.height === 44`));
    const b = test.viewBounds(g.id);
    step('app views start below the top bar', b.x === 76 && b.y === 44, b);
    step('⌘1–9 order follows the screen', JSON.stringify(test.orderedIds()) === JSON.stringify([g.id, tg.id, cal.id, drive.id, keep.id]));

    // quiet during calls
    step('not quiet at start', getState().quiet === null && test.notifyPolicy(tg.id).show === true);
    test.setInCall(true);
    await wait(300);
    step('in a call: Roost is quiet', getState().quiet === 'call' && test.notifyPolicy(tg.id).show === false);
    step('in a call: top bar shows the quiet pill', await ui(`const p=document.getElementById('quiet-pill'); return !p.hidden && /in a call/.test(p.textContent)`));
    step('in a call: background app sound is muted', test.isAudioMuted(tg.id) === true);
    const tgWc = test.viewWc(tg.id);
    await until(async () => { try { return await tgWc.executeJavaScript('!!window.__roostBridge'); } catch { return false; } }, 15000);
    if (tgWc) {
      step('in-page notifications are blocked while quiet', (await tgWc.executeJavaScript('window.__roostBridge.policy().show')) === false);
      await tgWc.executeJavaScript('window.__roostBridge.capture(1)');
      await wait(200);
      step('an app in its own call is never muted', test.isAudioMuted(tg.id) === false);
      await tgWc.executeJavaScript('window.__roostBridge.capture(0)');
      await wait(200);
    } else step('telegram page found', false);
    test.setInCall(false);
    await wait(300);
    step('call ends: not quiet', getState().quiet === null && test.notifyPolicy(tg.id).show === true);

    // settings dialog
    win.webContents.send('ui:settings', 'apps');
    step('settings opens', await until(() => ui(`return document.getElementById('settings').open`)));
    step('settings lists every app', (await ui(`return document.querySelectorAll('#s-apps .app-row:not(.app-head)').length`)) === 5);
    await ui(`document.querySelector('[aria-label="Sounds for ${tg.name}"]').click(); return true`);
    step('turn off Telegram sounds', await until(() => test.notifyPolicy(tg.id).silent === true));
    await ui(`document.querySelector('[aria-label="Notifications for ${tg.name}"]').click(); return true`);
    step('turn off Telegram notifications', await until(() => test.notifyPolicy(tg.id).show === false && getState().services.find((s) => s.id === tg.id).muted));
    await ui(`document.querySelector('[aria-label="Badge for ${tg.name}"]').click(); return true`);
    step('turn off Telegram badge', await until(() => getState().services.find((s) => s.id === tg.id).badge === false));
    await ui(`document.getElementById('s-call').click(); return true`);
    step('turn off quiet during calls', await until(() => getState().settings.callQuiet === false));
    test.setInCall(true);
    step('…then a call does not make Roost quiet', getState().quiet === null);
    test.setInCall(false);
    await ui(`document.getElementById('s-call').click(); return true`);
    // quiet hours around now
    const now = new Date();
    const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const from = hm(new Date(now.getTime() - 30 * 60000)); const to = hm(new Date(now.getTime() + 30 * 60000));
    await ui(`const f=document.getElementById('s-from'), t=document.getElementById('s-to'); f.value='${from}'; t.value='${to}'; document.getElementById('s-hours').click(); return true`);
    step('quiet hours around now make Roost quiet', await until(() => getState().quiet === 'hours'), getState().settings.quietHours);
    await ui(`document.getElementById('s-hours').click(); return true`);
    step('quiet hours off', await until(() => getState().quiet === null));
    await ui(`document.getElementById('s-dnd').click(); return true`);
    step('Do Not Disturb from settings', await until(() => getState().quiet === 'dnd'));
    await ui(`document.getElementById('s-dnd').click(); return true`);
    await ui(`document.getElementById('s-sounds').click(); return true`);
    step('all sounds off', await until(() => getState().settings.sounds === false && test.notifyPolicy(g.id).silent === true));
    await ui(`document.getElementById('s-sounds').click(); return true`);

    // AI key
    await ui(`const k=document.getElementById('s-ai-key'); k.value='not-a-key'; document.getElementById('s-ai-save').click(); return true`);
    step('bad AI key is refused', await until(() => ui(`return /does not look like/.test(document.getElementById('s-ai-state').textContent)`)));
    await ui(`const k=document.getElementById('s-ai-key'); k.value='sk-ant-TEST-not-a-real-key-0000000000000'; document.getElementById('s-ai-save').click(); return true`);
    step('AI key is saved', await until(() => getState().aiConfigured === true && test.getAiKey() === 'sk-ant-TEST-not-a-real-key-0000000000000'));
    await ui(`document.getElementById('s-ai-remove').click(); return true`);
    step('AI key is removed', await until(() => getState().aiConfigured === false && test.getAiKey() === null));
    await ui(`document.getElementById('s-close').click(); return true`);
    step('settings closes', await until(() => ui(`return !document.getElementById('settings').open && !document.body.classList.contains('modal-open')`)));

    // move Gmail below the line, then back
    await ui(`return roost.reorder(${JSON.stringify([tg.id, g.id, cal.id, drive.id, keep.id])}, { id: '${g.id}', group: 'chat' })`);
    step('drag Gmail into messages', await until(async () => JSON.stringify(await ids('#list-chat')) === JSON.stringify([tg.id, g.id]) && (await ui(`return document.getElementById('divider').hidden`))));
    await ui(`return roost.reorder(${JSON.stringify([g.id, tg.id, cal.id, drive.id, keep.id])}, { id: '${g.id}', group: 'mail' })`);
    step('drag Gmail back to email', await until(async () => JSON.stringify(await ids('#list-mail')) === JSON.stringify([g.id])));

    // add dialog: Drive preset defaults to the top bar
    win.webContents.send('ui:add');
    await until(() => ui(`return document.getElementById('dlg').open`));
    await ui(`document.querySelector('.preset[data-type="docs"]').click(); return true`);
    step('Docs preset goes to the top bar', (await ui(`return document.getElementById('f-group').value`)) === 'top');
    await ui(`document.querySelector('.preset[data-type="whatsapp"]').click(); return true`);
    step('WhatsApp preset goes to messages', (await ui(`return document.getElementById('f-group').value`)) === 'chat');
    await ui(`document.getElementById('f-cancel').click(); return true`);
    if (process.env.ROOST_E2E_OUT) {
      await wait(400);
      try { fs.writeFileSync(path.join(process.env.ROOST_E2E_OUT, 'layout.png'), (await win.webContents.capturePage()).toPNG()); } catch { /* no display */ }
    }
  } catch (err) {
    step('no crash', false, String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(process.env.ROOST_E2E_OUT, 'layout.json'), JSON.stringify(out, null, 2));
  quit();
};
