const test = require('node:test');
const assert = require('node:assert');
const {
  decodeWords, parseAddress, splitAddresses, parsePayload, buildRawMessage, b64url, fromB64url, summarizeThread, decodeHtmlEntities,
} = require('../src/gmail-api');

const part = (mimeType, text, extra = {}) => ({ mimeType, headers: extra.headers || [], filename: extra.filename || '', body: extra.body || { size: text.length, data: b64url(Buffer.from(text)) } });

test('decodes RFC 2047 encoded words (B and Q)', () => {
  assert.strictEqual(decodeWords('=?UTF-8?B?Wm/DqyBNw7xsbGVy?= <zoe@example.com>'), 'Zoë Müller <zoe@example.com>');
  assert.strictEqual(decodeWords('=?ISO-8859-1?Q?Caf=E9_au_lait?='), 'Café au lait');
  assert.strictEqual(decodeWords('=?UTF-8?Q?a?= =?UTF-8?Q?b?='), 'ab');
  assert.strictEqual(decodeWords('plain'), 'plain');
});

test('parses and splits addresses', () => {
  assert.deepStrictEqual(parseAddress('"Doe, Jane" <jane@x.com>'), { name: 'Doe, Jane', email: 'jane@x.com' });
  assert.deepStrictEqual(parseAddress('bob@x.com'), { name: 'bob@x.com', email: 'bob@x.com' });
  assert.deepStrictEqual(splitAddresses('"Doe, Jane" <jane@x.com>, bob@x.com'), ['"Doe, Jane" <jane@x.com>', 'bob@x.com']);
});

test('reads text, html, attachments and inline images from a MIME tree', () => {
  const payload = {
    mimeType: 'multipart/mixed', headers: [], parts: [
      { mimeType: 'multipart/alternative', headers: [], parts: [part('text/plain', 'Hello'), part('text/html', '<p>Hello <img src="cid:logo1"></p>')] },
      { mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo1>' }, { name: 'Content-Disposition', value: 'inline' }], body: { size: 10, attachmentId: 'A1' } },
      { mimeType: 'application/pdf', filename: 'doc.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="doc.pdf"' }], body: { size: 300, attachmentId: 'A2' } },
    ],
  };
  const out = parsePayload(payload);
  assert.strictEqual(out.text, 'Hello');
  assert.match(out.html, /cid:logo1/);
  assert.deepStrictEqual(out.inline.map((i) => i.cid), ['logo1']);
  assert.deepStrictEqual(out.attachments.map((a) => [a.filename, a.id, a.size]), [['doc.pdf', 'A2', 300]]);
});

test('decodes a latin-1 text part', () => {
  const body = { size: 4, data: b64url(Buffer.from([0x43, 0x61, 0x66, 0xe9])) };
  const out = parsePayload({ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' }], body });
  assert.strictEqual(out.text, 'Café');
});

test('builds a valid plain message with UTF-8 subject and reply headers', () => {
  const raw = buildRawMessage({ from: 'me@x.com', to: 'you@x.com', subject: 'Grüße', body: 'line1\nline2', inReplyTo: '<a@x>', references: '<z@x> <a@x>' });
  assert.match(raw, /^From: me@x.com\r\nTo: you@x.com\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?R3LDvMOfZQ==\?=/);
  assert.match(raw, /In-Reply-To: <a@x>\r\nReferences: <z@x> <a@x>/);
  const b64 = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.strictEqual(Buffer.from(b64, 'base64').toString('utf8'), 'line1\r\nline2');
  assert.ok(!/\nBcc:/.test(raw));
});

test('builds multipart/mixed with attachments', () => {
  const raw = buildRawMessage({ from: 'me@x.com', to: 'you@x.com', subject: 'Files', body: 'see attached',
    attachments: [{ filename: 'résumé.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4 test') }] });
  const boundary = raw.match(/boundary="([^"]+)"/)[1];
  assert.strictEqual(raw.split(`--${boundary}`).length, 4); // preamble, text, file, closing
  assert.match(raw, /filename\*=UTF-8''r%C3%A9sum%C3%A9\.pdf/);
  assert.match(raw, new RegExp(Buffer.from('%PDF-1.4 test').toString('base64')));
});

test('base64url round trip', () => {
  const buf = Buffer.from([251, 255, 0, 1, 2]);
  assert.deepStrictEqual(fromB64url(b64url(buf)), buf);
});

test('summarizes a thread from metadata', () => {
  const h = (from, subject) => ({ mimeType: 'multipart/mixed', headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }] });
  const s = summarizeThread({ id: 't1', messages: [
    { id: 'm1', labelIds: ['INBOX'], internalDate: '1000', snippet: 'first', payload: h('A <a@x.com>', 'Hi') },
    { id: 'm2', labelIds: ['INBOX', 'UNREAD', 'STARRED'], internalDate: '2000', snippet: 'It&#39;s me', payload: h('B <b@x.com>', 'Re: Hi') },
  ] });
  assert.deepStrictEqual([s.subject, s.from, s.fromEmail, s.snippet, s.date, s.unread, s.starred, s.messageCount, s.hasAttachments],
    ['Hi', 'B', 'b@x.com', "It's me", 2000, true, true, 2, true]);
});

test('html entities', () => assert.strictEqual(decodeHtmlEntities('a &amp; b &lt;c&gt; &#x27;d&#39;'), "a & b <c> 'd'"));

test('builds multipart/alternative when an HTML body is given', () => {
  const raw = buildRawMessage({ from: 'me@x.com', to: 'you@x.com', subject: 'Rich', body: 'Hi *there*', html: '<div>Hi <b>there</b></div>' });
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="(roost_alt_[0-9a-f]+)"/);
  const alt = raw.match(/boundary="([^"]+)"/)[1];
  const parts = raw.split(`--${alt}`);
  assert.strictEqual(parts.length, 4); // preamble, text, html, closing
  assert.match(parts[1], /text\/plain/);
  assert.match(parts[2], /text\/html/);
  const htmlB64 = parts[2].split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.strictEqual(Buffer.from(htmlB64, 'base64').toString('utf8'), '<div>Hi <b>there</b></div>');
});

test('HTML body plus attachments nests alternative inside mixed', () => {
  const raw = buildRawMessage({ from: 'me@x.com', to: 'you@x.com', subject: 'R', body: 'b', html: '<b>b</b>',
    attachments: [{ filename: 'a.txt', mimeType: 'text/plain', data: Buffer.from('x') }] });
  assert.match(raw, /multipart\/mixed; boundary="roost_[0-9a-f]+"/);
  assert.match(raw, /multipart\/alternative; boundary="roost_alt_/);
  assert.match(raw, /filename="a.txt"/);
});

test('listContacts ranks people I wrote to first and skips me and no-reply', async () => {
  const { GmailAccount } = require('../src/gmail-api');
  const msgs = {
    s1: { label: 'SENT', ts: 3, headers: { To: 'Ann Lee <ann@x.com>, bob@x.com', Cc: 'Me <me@x.com>' } },
    s2: { label: 'SENT', ts: 2, headers: { To: 'ann@x.com' } },
    i1: { label: 'INBOX', ts: 5, headers: { From: '"Carl" <carl@x.com>' } },
    i2: { label: 'INBOX', ts: 4, headers: { From: 'Shop <no-reply@shop.com>' } },
  };
  let calls = 0;
  const self = {
    account: () => ({ email: 'me@x.com' }),
    api: async (_m, p, { query }) => {
      calls++;
      if (p.endsWith('/messages')) return { messages: Object.keys(msgs).filter((k) => msgs[k].label === query.labelIds[0]).map((id) => ({ id })) };
      const m = msgs[p.split('/').pop()];
      return { internalDate: String(m.ts), payload: { headers: Object.entries(m.headers).map(([name, value]) => ({ name, value })) } };
    },
  };
  const { contacts } = await GmailAccount.prototype.listContacts.call(self);
  assert.deepStrictEqual(contacts.map((c) => c.email), ['ann@x.com', 'bob@x.com', 'carl@x.com']);
  assert.strictEqual(contacts[0].name, 'Ann Lee');
  assert.strictEqual(contacts[2].name, 'Carl');
  const before = calls;
  await GmailAccount.prototype.listContacts.call(self);
  assert.strictEqual(calls, before, 'second call uses the cache');
});

test('non-ASCII display names in To are RFC 2047 encoded', () => {
  const raw = buildRawMessage({ from: 'me@x.com', to: 'Zoë Ann <z@x.com>, b@x.com', subject: 's', body: 'b' });
  assert.match(raw, /\r\nTo: =\?UTF-8\?B\?[^?]+\?= <z@x.com>, b@x.com\r\n/);
});

test('untrashThread takes a thread out of Trash and puts INBOX back', async () => {
  const { GmailAccount } = require('../src/gmail-api');
  const seen = [];
  const self = { api: async (m, p, opts = {}) => { seen.push([m, p, opts.body || null]); return {}; }, refreshUnread: () => seen.push(['refresh']) };
  await GmailAccount.prototype.untrashThread.call(self, { id: 't/1', add: ['INBOX', 'TRASH', ''] });
  assert.deepStrictEqual(seen, [
    ['POST', '/gmail/v1/users/me/threads/t%2F1/untrash', null],
    ['POST', '/gmail/v1/users/me/threads/t%2F1/modify', { addLabelIds: ['INBOX'], removeLabelIds: [] }],
    ['refresh'],
  ]);
  seen.length = 0;
  await GmailAccount.prototype.untrashThread.call(self, { id: 'x' });
  assert.deepStrictEqual(seen.map((s) => s[1]), ['/gmail/v1/users/me/threads/x/untrash', undefined]);
});

test('refreshUnread reports the total and the Primary-tab count', async () => {
  const { GmailAccount, CONTRACT } = require('../src/gmail-api');
  assert.ok(CONTRACT.includes('untrashThread'));
  const run = async (inboxUnread, list) => {
    const got = [];
    const self = {
      setUnread: (n, p) => got.push([n, p]),
      api: async (_m, p, opts = {}) => {
        if (p.endsWith('/labels/INBOX')) return { threadsUnread: inboxUnread };
        assert.match(opts.query.q, /is:unread -category:promotions/);
        if (list instanceof Error) throw list;
        return list;
      },
    };
    await GmailAccount.prototype.countUnread.call(self);
    return got[0];
  };
  assert.deepStrictEqual(await run(9, { threads: [{ id: 'a' }, { id: 'b' }] }), [9, 2]);
  assert.deepStrictEqual(await run(0, null), [0, 0], 'no extra call when nothing is unread');
  assert.deepStrictEqual(await run(150, { threads: [], nextPageToken: 'n' }), [150, 100]);
  assert.deepStrictEqual(await run(4, new Error('offline')), [4, 4], 'falls back to the total');
});

test('a failed Primary count keeps the last one, and many refreshes run as few calls', async () => {
  const { GmailAccount } = require('../src/gmail-api');
  const got = [];
  let calls = 0;
  let failList = true;
  const self = {
    unreadPrimary: 2,
    setUnread: (n, p) => { got.push([n, p]); self.unreadPrimary = p; },
    countUnread: GmailAccount.prototype.countUnread,
    api: async (_m, p) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      if (p.endsWith('/labels/INBOX')) return { threadsUnread: 9 };
      if (failList) throw new Error('429');
      return { threads: [{ id: 'a' }] };
    },
  };
  await GmailAccount.prototype.countUnread.call(self);
  assert.deepStrictEqual(got.pop(), [9, 2], 'kept the last Primary count');
  failList = false;
  calls = 0;
  const runs = [];
  for (let i = 0; i < 10; i++) runs.push(GmailAccount.prototype.refreshUnread.call(self));
  await Promise.all(runs);
  assert.ok(calls <= 4, `10 refreshes made ${calls} calls`);
  assert.deepStrictEqual(got.pop(), [9, 1]);
});

test('GmailStore remembers when each account signed in', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { GmailStore } = require('../src/gmail-api');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-store-'));
  const store = new GmailStore(path.join(dir, 'a.json'), null);
  const before = Date.now();
  store.setAccount('k', { email: 'a@x.com', refreshToken: 'r1' });
  const first = store.getAccount('k').signedInAt;
  assert.ok(first >= before, 'new token gets a time');
  store.setAccount('k', { email: 'a@x.com', refreshToken: 'r1' });
  assert.strictEqual(store.getAccount('k').signedInAt, first, 'same token keeps its time');
  store.setAccount('k', { email: 'a@x.com', refreshToken: 'r1', signedInAt: 123 });
  assert.strictEqual(store.getAccount('k').signedInAt, 123, 'a copied account keeps the given time');
  store.setAccount('k', { email: 'a@x.com', refreshToken: '' });
  assert.strictEqual(store.getAccount('k').signedInAt, null, 'signed out: no time');
  const reread = new GmailStore(path.join(dir, 'a.json'), null);
  assert.strictEqual(reread.getAccount('k').email, 'a@x.com');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quota: Google costs and rate-limit answers', () => {
  const { quotaCost, isRateLimited } = require('../src/gmail-api');
  assert.strictEqual(quotaCost('GET', '/gmail/v1/users/me/threads/abc'), 10);
  assert.strictEqual(quotaCost('GET', '/gmail/v1/users/me/messages/abc'), 5);
  assert.strictEqual(quotaCost('POST', '/gmail/v1/users/me/messages/send'), 100);
  assert.strictEqual(quotaCost('GET', '/gmail/v1/users/me/labels/INBOX'), 1);
  assert.strictEqual(quotaCost('GET', '/gmail/v1/users/me/history'), 2);
  assert.strictEqual(quotaCost('GET', '/calendar/v3/users/me/calendarList'), 0);
  assert.ok(isRateLimited(429, {}));
  assert.ok(isRateLimited(403, { error: { message: "Quota exceeded for quota metric 'Total Query Cost'", errors: [] } }));
  assert.ok(isRateLimited(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }));
  assert.ok(!isRateLimited(403, { error: { message: 'Insufficient Permission' } }));
});

test('api waits and tries again when Gmail says "quota exceeded"', async () => {
  const { GmailAccount } = require('../src/gmail-api');
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls <= 2) return { ok: false, status: 429, headers: new Map(), json: async () => ({ error: { message: 'Quota exceeded' } }) };
    return { ok: true, status: 200, json: async () => ({ fine: true }) };
  };
  try {
    const acc = Object.create(GmailAccount.prototype);
    Object.assign(acc, { apiBase: 'http://x', accessToken: async () => 't', retryBaseMs: 5 });
    assert.deepStrictEqual(await acc.api('GET', '/gmail/v1/users/me/profile'), { fine: true });
    assert.strictEqual(calls, 3);
    calls = -100; // always fail
    acc.maxRetries = 1;
    await assert.rejects(acc.api('GET', '/gmail/v1/users/me/profile'), (e) => e.status === 429 && /Wait one minute/.test(e.message));
  } finally { global.fetch = realFetch; }
});

test('quota budget spreads a burst of calls over time', async () => {
  const { GmailAccount } = require('../src/gmail-api');
  const acc = Object.create(GmailAccount.prototype);
  acc.quotaRate = 1000; // units per second
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 50 }, () => acc.takeQuota(10))); // 500 units, burst is 300
  const ms = Date.now() - t0;
  assert.ok(ms >= 150, `500 units took only ${ms} ms`);
});

test('listThreads reuses summaries of threads that did not change', async () => {
  const { GmailAccount } = require('../src/gmail-api');
  let gets = 0;
  let hist = '5';
  const self = {
    api: async (_m, p) => {
      if (p.endsWith('/threads')) return { threads: [{ id: 'a', historyId: hist, snippet: 's' }, { id: 'b', historyId: '7', snippet: 's' }] };
      gets++;
      return { id: p.split('/').pop(), messages: [{ labelIds: ['INBOX'], internalDate: '1', payload: { headers: [{ name: 'Subject', value: 'hi' }] } }] };
    },
  };
  const first = await GmailAccount.prototype.listThreads.call(self, { labelId: 'INBOX' });
  assert.strictEqual(first.threads.length, 2);
  assert.strictEqual(gets, 2);
  await GmailAccount.prototype.listThreads.call(self, { labelId: 'INBOX' });
  assert.strictEqual(gets, 2, 'nothing changed: no new thread calls');
  hist = '6';
  await GmailAccount.prototype.listThreads.call(self, { labelId: 'INBOX' });
  assert.strictEqual(gets, 3, 'only the changed thread is fetched again');
});
