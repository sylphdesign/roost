'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startFakeGmail } = require('./fake-gmail-server');

const REDIRECT = 'http://127.0.0.1:54321/callback';

async function boot(t) {
  const srv = await startFakeGmail();
  t.after(() => srv.close());
  return srv;
}

async function login(srv) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({
    client_id: 'cid', redirect_uri: REDIRECT, response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.modify',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'st123', access_type: 'offline', prompt: 'consent',
  });
  const r = await fetch(`${srv.url}/o/oauth2/v2/auth?${q}`, { redirect: 'manual' });
  const loc = new URL(r.headers.get('location'));
  return { r, loc, verifier };
}

async function token(srv, params) {
  const r = await fetch(`${srv.url}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return { status: r.status, body: await r.json() };
}

async function getTokens(srv) {
  const { loc, verifier } = await login(srv);
  const res = await token(srv, {
    grant_type: 'authorization_code', code: loc.searchParams.get('code'), code_verifier: verifier,
    client_id: 'cid', client_secret: 'sec', redirect_uri: REDIRECT,
  });
  assert.equal(res.status, 200);
  return res.body;
}

function api(srv, access) {
  return async (path, opts = {}) => {
    const r = await fetch(`${srv.url}/gmail/v1/users/me/${path}`, {
      ...opts,
      headers: { authorization: `Bearer ${access}`, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
}

const dec = (s) => Buffer.from(s, 'base64url').toString('utf8');

test('OAuth code + PKCE flow', async (t) => {
  const srv = await boot(t);
  const { r, loc, verifier } = await login(srv);
  assert.equal(r.status, 302);
  assert.equal(loc.origin + loc.pathname, REDIRECT);
  assert.equal(loc.searchParams.get('state'), 'st123');
  const code = loc.searchParams.get('code');
  assert.ok(code);

  const bad = await token(srv, { grant_type: 'authorization_code', code, code_verifier: 'wrong', client_id: 'cid', redirect_uri: REDIRECT });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_grant');

  const ok = await token(srv, { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: 'cid', client_secret: 's', redirect_uri: REDIRECT });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.token_type, 'Bearer');
  assert.equal(ok.body.expires_in, 3599);
  assert.ok(ok.body.access_token && ok.body.refresh_token);

  const p = await api(srv, ok.body.access_token)('profile');
  assert.equal(p.status, 200);
  assert.equal(p.body.emailAddress, 'test.user@example.com');
  assert.equal(typeof p.body.historyId, 'string');

  const badRedirect = await fetch(`${srv.url}/o/oauth2/v2/auth?client_id=c&redirect_uri=${encodeURIComponent('https://evil.example.com/cb')}&response_type=code&code_challenge=x&code_challenge_method=S256`, { redirect: 'manual' });
  assert.equal(badRedirect.status, 400);
});

test('refresh, expireAll, revoke, 401 without token', async (t) => {
  const srv = await boot(t);
  const tk = await getTokens(srv);
  const call = api(srv, tk.access_token);

  const noAuth = await fetch(`${srv.url}/gmail/v1/users/me/profile`);
  assert.equal(noAuth.status, 401);
  assert.deepEqual(await noAuth.json(), {
    error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' },
  });

  srv.state.expireAll();
  assert.equal((await call('profile')).status, 401);

  const rf = await token(srv, { grant_type: 'refresh_token', refresh_token: tk.refresh_token, client_id: 'cid' });
  assert.equal(rf.status, 200);
  assert.equal(rf.body.refresh_token, undefined);
  assert.equal((await api(srv, rf.body.access_token)('profile')).status, 200);

  const unknown = await token(srv, { grant_type: 'refresh_token', refresh_token: 'nope' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'invalid_grant');

  await fetch(`${srv.url}/__test/expire`, { method: 'POST' });
  assert.equal((await api(srv, rf.body.access_token)('profile')).status, 401);

  const rv = await fetch(`${srv.url}/revoke?token=${tk.refresh_token}`, { method: 'POST' });
  assert.equal(rv.status, 200);
  assert.equal((await token(srv, { grant_type: 'refresh_token', refresh_token: tk.refresh_token })).status, 400);
});

test('labels list has no counts; label get has live counts', async (t) => {
  const srv = await boot(t);
  const call = api(srv, (await getTokens(srv)).access_token);
  const list = await call('labels');
  assert.equal(list.status, 200);
  const ids = list.body.labels.map((l) => l.id);
  for (const id of ['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'STARRED', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL', 'Label_1']) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(list.body.labels[0].messagesTotal, undefined);
  assert.equal(list.body.labels.find((l) => l.id === 'Label_1').type, 'user');

  const inbox = (await call('labels/INBOX')).body;
  assert.equal(inbox.threadsTotal, 27);
  assert.equal(inbox.messagesTotal, 28);
  assert.equal(inbox.threadsUnread, 6);
  assert.equal(inbox.messagesUnread, 6);
  assert.equal((await call('labels/Label_1')).body.threadsTotal, 1);
  assert.equal((await call('labels/NOPE')).status, 404);
});

test('thread paging with maxResults=20 gives 2 pages, newest first', async (t) => {
  const srv = await boot(t);
  const call = api(srv, (await getTokens(srv)).access_token);
  const p1 = (await call('threads?labelIds=INBOX&maxResults=20')).body;
  assert.equal(p1.threads.length, 20);
  assert.ok(p1.nextPageToken);
  assert.equal(p1.threads[0].id, 'thr_welcome');
  const p2 = (await call(`threads?labelIds=INBOX&maxResults=20&pageToken=${p1.nextPageToken}`)).body;
  assert.equal(p2.threads.length, 7);
  assert.equal(p2.nextPageToken, undefined);
  assert.equal(p1.resultSizeEstimate, 27);

  // spam/trash hidden by default, visible with includeSpamTrash
  const all = (await call('threads?maxResults=100')).body.threads.map((x) => x.id);
  assert.ok(!all.includes('thr_spam') && !all.includes('thr_trash'));
  const withAll = (await call('threads?includeSpamTrash=true&maxResults=100')).body.threads.map((x) => x.id);
  assert.ok(withAll.includes('thr_spam') && withAll.includes('thr_trash'));

  // q subset
  const unread = (await call('threads?q=is:unread in:inbox')).body.threads;
  assert.equal(unread.length, 6);
  const att = (await call('threads?q=has:attachment')).body.threads;
  assert.deepEqual(att.map((x) => x.id), ['thr_attachment']);
  const from = (await call('threads?q=from:alice')).body.threads;
  assert.deepEqual(from.map((x) => x.id), ['thr_conversation']);
  const word = (await call('threads?q=digest')).body.threads;
  assert.deepEqual(word.map((x) => x.id), ['thr_newsletter']);
});

test('thread get: format=full decodes text, html, attachments, conversation', async (t) => {
  const srv = await boot(t);
  const call = api(srv, (await getTokens(srv)).access_token);

  const w = (await call('threads/thr_welcome?format=full')).body;
  assert.equal(w.messages.length, 1);
  const wm = w.messages[0];
  assert.equal(wm.payload.mimeType, 'text/plain');
  assert.match(dec(wm.payload.body.data), /Welcome to Roost!/);
  assert.equal(typeof wm.internalDate, 'string');
  assert.ok(wm.labelIds.includes('UNREAD'));

  const n = (await call('threads/thr_newsletter?format=full')).body.messages[0];
  assert.equal(n.payload.mimeType, 'multipart/alternative');
  assert.deepEqual(n.payload.parts.map((p) => p.mimeType), ['text/plain', 'text/html']);
  assert.match(dec(n.payload.parts[1].body.data), /tracker\.example\.com\/pixel\.gif/);

  const a = (await call('threads/thr_attachment?format=full')).body.messages[0];
  assert.equal(a.payload.mimeType, 'multipart/mixed');
  const att = a.payload.parts[1];
  assert.equal(att.filename, 'invoice.pdf');
  assert.ok(att.body.attachmentId && att.body.size > 100);
  const got = (await call(`messages/${a.id}/attachments/${att.body.attachmentId}`)).body;
  assert.equal(got.size, att.body.size);
  assert.equal(Buffer.from(got.data, 'base64url').subarray(0, 5).toString(), '%PDF-');

  const c = (await call('threads/thr_conversation?format=full')).body;
  assert.equal(c.messages.length, 3);
  const hdr = (m, n) => m.payload.headers.find((h) => h.name === n)?.value;
  assert.equal(hdr(c.messages[1], 'In-Reply-To'), hdr(c.messages[0], 'Message-ID'));
  assert.equal(hdr(c.messages[2], 'References'), `${hdr(c.messages[0], 'Message-ID')} ${hdr(c.messages[1], 'Message-ID')}`);
  assert.ok(c.messages[2].labelIds.includes('UNREAD'));

  const z = (await call('threads/thr_zoe?format=full')).body.messages[0];
  assert.match(hdr(z, 'From'), /^=\?UTF-8\?B\?.*\?= <zoe@example\.com>$/);

  assert.equal(hdr((await call('threads/thr_nosubject?format=full')).body.messages[0], 'Subject'), '');

  const md = (await call('threads/thr_conversation?format=metadata&metadataHeaders=subject&metadataHeaders=FROM')).body;
  for (const m of md.messages) {
    assert.equal(m.payload.parts, undefined);
    assert.deepEqual(m.payload.headers.map((h) => h.name.toLowerCase()).sort(), ['from', 'subject']);
  }
  const mn = (await call('threads/thr_conversation?format=minimal')).body;
  assert.equal(mn.messages[0].payload, undefined);
  assert.equal((await call('threads/nope')).status, 404);
});

test('modify and trash change counts', async (t) => {
  const srv = await boot(t);
  const call = api(srv, (await getTokens(srv)).access_token);
  const h0 = (await call('profile')).body.historyId;

  const mod = await call('threads/thr_welcome/modify', { method: 'POST', body: { removeLabelIds: ['UNREAD'], addLabelIds: ['STARRED'] } });
  assert.equal(mod.status, 200);
  assert.equal(mod.body.id, 'thr_welcome');
  assert.ok(!mod.body.messages[0].labelIds.includes('UNREAD'));
  assert.ok(Number(mod.body.historyId) > Number(h0));
  let inbox = (await call('labels/INBOX')).body;
  assert.equal(inbox.threadsUnread, 5);
  assert.equal((await call('labels/STARRED')).body.threadsTotal, 2);

  const tr = await call('threads/thr_starred/trash', { method: 'POST' });
  assert.equal(tr.status, 200);
  assert.ok(tr.body.messages[0].labelIds.includes('TRASH'));
  inbox = (await call('labels/INBOX')).body;
  assert.equal(inbox.threadsTotal, 26);
  assert.equal((await call('labels/TRASH')).body.threadsTotal, 2);

  const bad = await call('threads/thr_welcome/modify', { method: 'POST', body: { addLabelIds: ['Nope'] } });
  assert.equal(bad.status, 400);
});

function buildRaw(headers, body) {
  return Buffer.from(Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n' + body).toString('base64url');
}

test('send parses plain and multipart/mixed with attachment', async (t) => {
  const srv = await boot(t);
  const call = api(srv, (await getTokens(srv)).access_token);

  const noRcpt = await call('messages/send', { method: 'POST', body: { raw: buildRaw({ Subject: 'x' }, 'hi') } });
  assert.equal(noRcpt.status, 400);

  const plain = await call('messages/send', {
    method: 'POST',
    body: { raw: buildRaw({ To: 'a@example.com', Subject: 'Plain', 'Content-Type': 'text/plain; charset=UTF-8' }, 'Hello plain\r\n') },
  });
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.body.labelIds, ['SENT']);
  assert.equal(srv.state.sent[0].text, 'Hello plain');
  assert.equal(srv.state.sent[0].headers.subject, 'Plain');

  const fileBytes = Buffer.from('fake-bytes-for-attachment');
  const body =
    '--BND\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\nSee attached.\r\n' +
    `--BND\r\nContent-Type: application/octet-stream; name="a.bin"\r\nContent-Disposition: attachment; filename="a.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n${fileBytes.toString('base64')}\r\n--BND--\r\n`;
  const raw = buildRaw(
    {
      To: 'Alice <alice@example.com>', Cc: 'c@example.com', Subject: '=?UTF-8?B?UmU6IFByb2plY3Qga2lja29mZiDinJM=?=',
      'In-Reply-To': '<conv-3@mail.example.com>', References: '<conv-1@mail.example.com> <conv-3@mail.example.com>',
      'MIME-Version': '1.0', 'Content-Type': 'multipart/mixed; boundary="BND"',
    },
    body
  );
  const sent = await call('messages/send', { method: 'POST', body: { raw, threadId: 'thr_conversation' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.threadId, 'thr_conversation');
  const rec = srv.state.sent[1];
  assert.equal(rec.text, 'See attached.');
  assert.equal(rec.headers.to, 'Alice <alice@example.com>');
  assert.equal(rec.headers.cc, 'c@example.com');
  assert.equal(rec.headers.subject, 'Re: Project kickoff ✓');
  assert.equal(rec.headers['in-reply-to'], '<conv-3@mail.example.com>');
  assert.deepEqual(rec.attachments, [{ filename: 'a.bin', mimeType: 'application/octet-stream', size: fileBytes.length }]);
  assert.deepEqual(rec.attachments[0].data, fileBytes);

  const th = (await call('threads/thr_conversation?format=full')).body;
  assert.equal(th.messages.length, 4);
  assert.deepEqual(th.messages[3].labelIds, ['SENT']);
  assert.equal(th.messages[3].payload.parts[1].filename, 'a.bin');
  const newThread = (await call(`threads/${plain.body.threadId}?format=minimal`)).body;
  assert.equal(newThread.messages.length, 1);
});

test('history after /__test/deliver', async (t) => {
  const srv = await boot(t);
  const call = api(srv, (await getTokens(srv)).access_token);
  const start = (await call('profile')).body.historyId;

  const empty = (await call(`history?startHistoryId=${start}`)).body;
  assert.equal(empty.history, undefined);
  assert.equal(empty.historyId, start);

  const d = await fetch(`${srv.url}/__test/deliver`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'New Person <new@example.com>', subject: 'Fresh mail', text: 'Brand new body', html: '<p>Brand new body</p>' }),
  });
  assert.equal(d.status, 200);
  const { id, threadId } = await d.json();
  assert.ok(id && threadId);

  const h = (await call(`history?startHistoryId=${start}&historyTypes=messageAdded&labelId=INBOX`)).body;
  assert.ok(Number(h.historyId) > Number(start));
  assert.equal(h.history.length, 1);
  assert.deepEqual(h.history[0].messages, [{ id, threadId }]);
  assert.deepEqual(h.history[0].messagesAdded[0].message.labelIds, ['INBOX', 'UNREAD']);

  const top = (await call('threads?labelIds=INBOX&maxResults=1')).body.threads[0];
  assert.equal(top.id, threadId);
  assert.equal(srv.state.requests.some((r) => r.path === '/__test/deliver'), true);
  assert.equal((await call(`history`)).status, 400);
});
