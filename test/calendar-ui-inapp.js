// Runs INSIDE Roost (ROOST_E2E_SCRIPT). Uses the Calendar SCREEN like a person: setup, sign-in, open events,
// RSVP, create / edit / delete an event, month view. Writes calendar-ui.json.
const { webContents } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ quit }) => {
  const out = { steps: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const fake = process.env.ROOST_FAKE_URL;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  let wc;
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const until = async (code, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await js(code)) return true; await wait(200); } return false; };
  const H = `
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden && getComputedStyle(n).display !== 'none' && n.offsetWidth > 0; };
    const setVal = (id, v) => { const n = document.getElementById(id); n.focus(); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
    const evEl = (title) => [...document.querySelectorAll('#view .ev-title')].find((n) => n.textContent.trim() === title);
    const btn = (root, re) => [...(root || document).querySelectorAll('button')].find((b) => re.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')) && b.offsetWidth > 0);
    const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  `;
  const log = async () => (await (await fetch(`${fake}/__test/calendar-log`)).json());
  try {
    for (let i = 0; i < 40 && !wc; i++) { wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/calendar/index.html')); if (!wc) await wait(250); }
    if (!wc) throw new Error('Calendar screen did not load');
    step('setup screen shows first', await until(`${H} return vis('screen-setup');`));
    await js(`${H} setVal('setup-client-id','123-abc.apps.googleusercontent.com'); setVal('setup-client-secret','GOCSPX-test'); document.getElementById('setup-save').click(); return true;`);
    step('setup saves, sign-in shows the Calendar checklist', await until(`${H} return vis('screen-signin') && /calendar-json|Calendar API/i.test(document.getElementById('screen-signin').textContent);`));
    await js(`document.getElementById('signin-btn').click(); return true;`);
    step('sign in opens the calendar', await until(`${H} return vis('screen-cal') && /test.user@example.com/.test(document.getElementById('account-email').textContent);`, 15000));
    step('week view shows overlapping events from two calendars', await until(`${H} return !!evEl('Standup') && !!evEl('Design review');`, 8000),
      await js(`return [...document.querySelectorAll('#view .ev-title')].map((n) => n.textContent).slice(0, 12);`));
    step('calendar list shows 3 calendars', await js(`return document.getElementById('cal-list').querySelectorAll('input[type=checkbox]').length === 3;`));

    await js(`${H} evEl('Standup').click(); return true;`);
    step('event details show Meet button and guests', await until(`${H} const d=document.getElementById('details'); return vis('details') && /Standup/.test(d.textContent) && !!btn(d, /Meet/) && /bob@example.com/.test(d.textContent);`));
    await js(`${H} key('Escape'); return true;`);
    await wait(300);

    let found = await js(`${H} return !!evEl('Lunch with Alice');`);
    if (!found) { await js(`document.getElementById('next-btn').click(); return true;`); found = await until(`${H} return !!evEl('Lunch with Alice');`); }
    await js(`${H} evEl('Lunch with Alice').click(); return true;`);
    await until(`${H} return vis('details') && /Lunch with Alice/.test(document.getElementById('details').textContent);`);
    const canEditInvite = await js(`${H} return !!btn(document.getElementById('details'), /^\\s*Edit/);`);
    await js(`${H} btn(document.getElementById('details'), /^\\s*Yes\\b/).click(); return true;`);
    await wait(1200);
    const l1 = await log();
    const rsvp = l1.find((x) => x.op === 'patch' && x.id === 'ev_lunch');
    step('RSVP Yes is sent to Google (invite is not editable)', rsvp && rsvp.body.attendees.some((a) => a.self && a.responseStatus === 'accepted') && !canEditInvite, { rsvp: !!rsvp, canEditInvite });
    await js(`${H} key('Escape'); document.getElementById('today-btn').click(); return true;`);
    await wait(500);

    await js(`document.getElementById('new-btn').click(); return true;`);
    await until(`${H} return vis('editor');`);
    await js(`${H} setVal('ed-title','UI made event'); setVal('ed-location','Cafe'); setVal('ed-guests','pal@example.com'); document.getElementById('ed-meet').checked = true; document.getElementById('ed-meet').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('editor-save').click(); return true;`);
    await until(`${H} return !vis('editor');`, 8000);
    await wait(800);
    const ins = (await log()).find((x) => x.op === 'insert' && x.body.summary === 'UI made event');
    step('create event from the editor (guests + Meet)', ins && ins.body.location === 'Cafe' && ins.body.attendees[0].email === 'pal@example.com' && ins.body.conferenceData && ins.sendUpdates === 'all', ins && ins.body);
    step('new event appears in the view', await until(`${H} return !!evEl('UI made event');`));

    await js(`${H} evEl('UI made event').click(); return true;`);
    await until(`${H} return vis('details');`);
    await js(`${H} btn(document.getElementById('details'), /^\\s*Edit/).click(); return true;`);
    await until(`${H} return vis('editor');`);
    await js(`${H} setVal('ed-title','UI edited event'); document.getElementById('editor-save').click(); return true;`);
    await until(`${H} return !vis('editor');`, 8000);
    await wait(800);
    const pat = (await log()).find((x) => x.op === 'patch' && x.body.summary === 'UI edited event');
    step('edit event saves the change', !!pat, pat && pat.body);

    await until(`${H} return !!evEl('UI edited event');`);
    await js(`${H} evEl('UI edited event').click(); return true;`);
    await until(`${H} return vis('details');`);
    await js(`${H} btn(document.getElementById('details'), /Delete/).click(); return true;`);
    await until(`${H} return vis('confirm-ok');`);
    await js(`document.getElementById('confirm-ok').click(); return true;`);
    await wait(1200);
    const del = (await log()).find((x) => x.op === 'delete' && x.id === pat?.id);
    step('delete event (with confirm)', !!del && !(await js(`${H} return !!evEl('UI edited event');`)), del);

    await js(`${H} key('m'); return true;`);
    step('month view shows events', await until(`return /\\d{4}/.test(document.getElementById('range-title').textContent) && document.querySelectorAll('#view .ev-title').length > 3;`),
      await js(`return document.getElementById('range-title').textContent;`));
    const notes = (global.roostE2EEvents || []).filter((e) => e.type === 'notification');
    step('reminder notification for the event starting soon', notes.some((n) => n.title === 'Starts soon'), notes);
  } catch (err) {
    step('crashed', false, err.stack);
  }
  fs.writeFileSync(path.join(dir, 'calendar-ui.json'), JSON.stringify(out, null, 2));
  quit();
};
