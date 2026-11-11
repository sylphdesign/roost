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
