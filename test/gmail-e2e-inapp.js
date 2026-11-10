// Runs INSIDE Roost (loaded via ROOST_E2E_SCRIPT by test/gmail.e2e.js). Drives the Gmail screen's
// bridge (window.gmail.call) against the fake Gmail server and writes results to ROOST_E2E_OUT.
const { webContents } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, getState, quit }) => {
  const out = { phase: process.env.ROOST_E2E_PHASE, steps: [], screenshots: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail) => { out.steps.push({ name, ok: !!ok, detail }); };
  const dir = process.env.ROOST_E2E_OUT;
  const shot = async (wc, name) => {
    try { const f = path.join(dir, `${out.phase}-${name}.png`); fs.writeFileSync(f, (await wc.capturePage()).toPNG()); out.screenshots.push(f); } catch (e) { out.screenshots.push(`${name}: ${e.message}`); }
  };
  try {
    let wc = null;
    for (let i = 0; i < 40 && !wc; i++) {
      wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/gmail/index.html'));
      if (!wc) await wait(250);
    }
    if (!wc) throw new Error('Gmail screen did not load');
    await wait(1500);
    const call = (m, a) => wc.executeJavaScript(`window.gmail.call(${JSON.stringify(m)}, ${JSON.stringify(a || {})})`);
    const fake = process.env.ROOST_FAKE_URL;
    const badge = () => (getState().services.find((s) => s.type === 'gmail') || {}).unread;

    if (out.phase === 'first') {
      let st = await call('getStatus');
      step('starts unconfigured', st.ok && !st.configured && !st.signedIn, st);
      await shot(wc, 'setup');
      const bad = await call('listLabels');
      step('calls before setup ask for setup', !bad.ok && bad.needsSetup, bad);
      const sv = await call('saveClientConfig', { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret' });
      step('saves Google key', sv.ok, sv);
      await wait(500);
      await shot(wc, 'signin');
      const si = await call('signIn');
      step('signs in (OAuth loopback + PKCE)', si.ok && si.email === 'test.user@example.com', si);
      await wait(2500);
      await shot(wc, 'inbox');

      const labels = await call('listLabels');
      const inbox = labels.labels && labels.labels.find((l) => l.id === 'INBOX');
      step('lists labels with counts', labels.ok && inbox && inbox.threadsUnread > 0 && labels.labels.some((l) => l.name === 'Work'), labels.labels && labels.labels.map((l) => `${l.id}:${l.threadsUnread}`));
      await wait(500);
      step('sidebar badge = inbox unread', badge() === inbox.threadsUnread, { badge: badge(), inbox: inbox.threadsUnread });

      const p1 = await call('listThreads', { labelId: 'INBOX' });
      step('lists inbox page 1', p1.ok && p1.threads.length > 0 && p1.threads.every((t) => t.id && typeof t.date === 'number'), p1.threads && p1.threads.length);
      const p2 = p1.nextPageToken ? await call('listThreads', { labelId: 'INBOX', pageToken: p1.nextPageToken }) : { ok: false };
      step('lists inbox page 2', p2.ok && p2.threads.length > 0 && !p2.threads.some((t) => p1.threads.find((x) => x.id === t.id)), p2.threads && p2.threads.length);
      const all = [...p1.threads, ...(p2.threads || [])];
      step('decodes non-ASCII sender', all.some((t) => t.from === 'Zoë Müller'), all.map((t) => t.from).filter((f) => /[^\x00-\x7f]/.test(f)));
      step('shows "(no subject)" case as empty subject', all.some((t) => t.subject === ''), null);
      const search = await call('listThreads', { labelId: 'ALL', q: 'is:unread' });
      step('search works', search.ok && search.threads.length > 0 && search.threads.every((t) => t.unread), search.threads && search.threads.length);

      const withFile = all.find((t) => t.hasAttachments);
      const tf = withFile ? await call('getThread', { id: withFile.id }) : { ok: false };
      const att = tf.ok && tf.thread.messages.flatMap((m) => m.attachments.map((a) => ({ ...a, messageId: m.id })))[0];
      step('reads thread with attachment', !!att, att);
      const dl = att ? await call('downloadAttachment', { messageId: att.messageId, attachmentId: att.id, filename: att.filename }) : { ok: false };
      step('downloads attachment', dl.ok && fs.existsSync(dl.path) && fs.statSync(dl.path).size === att.size, dl);
      out.downloaded = dl.path;

      const convo = all.find((t) => t.messageCount >= 3);
      const tc = convo ? await call('getThread', { id: convo.id }) : { ok: false };
      step('reads 3-message conversation', tc.ok && tc.thread.messages.length >= 3 && tc.thread.messages.every((m) => m.html || m.text), tc.thread && tc.thread.messages.length);
      const last = tc.ok && tc.thread.messages[tc.thread.messages.length - 1];

      const news = all.find((t) => /digest/i.test(`${t.subject} ${t.snippet}`));
      const tn = news ? await call('getThread', { id: news.id }) : { ok: false };
      step('reads HTML email', tn.ok && tn.thread.messages.some((m) => m.html && /tracker\.example\.com/.test(m.html)), news && news.subject);

      const unreadOne = all.find((t) => t.unread);
      const before = badge();
      const mr = await call('modifyThread', { id: unreadOne.id, remove: ['UNREAD'] });
      await wait(1000);
      step('mark read lowers badge', mr.ok && badge() === before - 1, { before, after: badge() });

      const rep = last ? await call('send', {
        to: last.fromEmail, subject: `Re: ${tc.thread.subject}`, body: 'Thanks!\n\nOn ... wrote:\n> hi', threadId: tc.thread.id,
        inReplyTo: last.messageIdHeader, references: `${last.references ? `${last.references} ` : ''}${last.messageIdHeader}`,
        attachments: [{ path: process.env.ROOST_TEST_ATTACH }],
      }) : { ok: false };
      step('sends reply with attachment', rep.ok && rep.id, rep);
      const noTo = await call('send', { to: '', subject: 'x', body: 'y' });
      step('refuses email without recipient', !noTo.ok, noTo.error);

      const archive = all.find((t) => !t.unread && t.id !== convo.id && t.id !== withFile.id);
      const ar = await call('modifyThread', { id: archive.id, remove: ['INBOX'] });
      const tr = await call('trashThread', { id: withFile.id });
      const after = await call('listThreads', { labelId: 'INBOX' });
      const after2 = after.nextPageToken ? await call('listThreads', { labelId: 'INBOX', pageToken: after.nextPageToken }) : { threads: [] };
      const ids = [...after.threads, ...after2.threads].map((t) => t.id);
      step('archive and trash remove from inbox', ar.ok && tr.ok && !ids.includes(archive.id) && !ids.includes(withFile.id), null);
      const trash = await call('listThreads', { labelId: 'TRASH' });
      step('trash folder shows trashed mail', trash.ok && trash.threads.some((t) => t.id === withFile.id), null);

      const b0 = badge();
      await fetch(`${fake}/__test/deliver`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'Alerts <alerts@example.com>', subject: 'Brand new mail', text: 'hello there' }) });
      let notified = false;
      for (let i = 0; i < 20 && !notified; i++) { await wait(500); notified = (global.roostE2EEvents || []).some((e) => e.type === 'notification' && /Brand new mail/.test(e.body)); }
      step('new mail: notification + badge', notified && badge() === b0 + 1, { events: global.roostE2EEvents, b0, b1: badge() });

      await fetch(`${fake}/__test/expire`, { method: 'POST' });
      const again = await call('listLabels');
      step('refreshes expired access token', again.ok, again.error);
      await shot(wc, 'end');
    }

    if (out.phase === 'second') {
      const st = await call('getStatus');
      step('still signed in after restart', st.ok && st.signedIn && st.email === 'test.user@example.com', st);
      const labels = await call('listLabels');
      step('works after restart', labels.ok, labels.error);
      await wait(1500);
      await shot(wc, 'restart');
      const so = await call('signOut');
      const st2 = await call('getStatus');
      step('signs out', so.ok && st2.configured && !st2.signedIn, st2);
      const after = await call('listLabels');
      step('after sign-out asks to sign in', !after.ok && after.needsSignIn, after);
      await wait(500);
      step('badge cleared after sign-out', !getState().services.find((s) => s.type === 'gmail').unread, null);
    }
  } catch (err) {
    step('crashed', false, err.stack);
  }
  fs.writeFileSync(path.join(dir, `${out.phase}.json`), JSON.stringify(out, null, 2));
  quit();
};
