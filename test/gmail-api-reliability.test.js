const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GmailAccount, GmailStore, buildRawMessage } = require('../src/gmail-api');

const tmpStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-rel-'));
  const store = new GmailStore(path.join(dir, 's.json'), null);
  store.setClient('id.apps.googleusercontent.com', 'secret');
  store.setAccount('g1', { email: 'me@x.com', refreshToken: 'r1' });
  return { store, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
};
const newAccount = (store) => new GmailAccount({ serviceId: 'g1', store, deps: {} });
const bare = (extra = {}) => Object.assign(Object.create(GmailAccount.prototype), { apiBase: 'http://x', accessToken: async () => 't' }, extra);
const rateLimited = () => ({ ok: false, status: 429, headers: new Map(), json: async () => ({ error: { message: 'Quota exceeded' } }) });
const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });

async function withFetch(fake, fn) {
  const real = global.fetch;
  global.fetch = fake;
  try { return await fn(); } finally { global.fetch = real; }
}

test('after a 429 pause the budget starts empty, with no full burst at once', async () => {
  let calls = 0;
  await withFetch(async () => (++calls === 1 ? rateLimited() : ok()), async () => {
    const acc = bare({ retryBaseMs: 100, quotaRate: 1000 });
    await acc.api('GET', '/gmail/v1/users/me/profile');
    assert.strictEqual(calls, 2);
    // The pause was 100-200 ms. At 1000 units/s, counting the pause would give 100+ units.
    assert.ok(acc.quotaTokens < 50, `budget after the pause: ${acc.quotaTokens}`);
  });
});

test('calls with no cost (Calendar) still wait out a 429 pause and say "Google Calendar is busy"', async () => {
  let calls = 0;
  await withFetch(async () => (++calls <= 2 ? rateLimited() : ok({ fine: true })), async () => {
    const acc = bare({ retryBaseMs: 50 });
    const t0 = Date.now();
    assert.deepStrictEqual(await acc.api('GET', '/calendar/v3/users/me/calendarList'), { fine: true });
    const ms = Date.now() - t0;
    assert.ok(ms >= 140, `two retries waited only ${ms} ms`);
    calls = -100;
    acc.maxRetries = 0;
    await assert.rejects(acc.api('GET', '/calendar/v3/users/me/calendarList'), (e) => e.status === 429 && /^Google Calendar is busy/.test(e.message));
  });
  // A zero-cost call with no pause does not touch the budget.
  const acc = bare();
  await acc.takeQuota(0);
  assert.strictEqual(acc.quotaTokens, undefined);
});

test('a fetch that hangs ends with a clear error', async () => {
  const hang = (_u, opts) => new Promise((_r, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason)));
  await withFetch(hang, async () => {
    const acc = bare({ fetchTimeoutMs: 50 });
    await assert.rejects(acc.api('GET', '/gmail/v1/users/me/profile'), /Google did not answer in time/);
  });
  await withFetch(async () => { throw new TypeError('fetch failed'); }, async () => {
    await assert.rejects(bare().api('GET', '/gmail/v1/users/me/profile'), (e) => e instanceof TypeError);
  });
});

test('two polls at the same time report new mail only once', async () => {
  const { store, done } = tmpStore();
  const acc = newAccount(store);
  acc.historyId = '1';
  acc.refreshUnread = async () => {};
  acc.api = async (_m, p) => {
    await new Promise((r) => setTimeout(r, 20));
    if (p.endsWith('/history')) return { historyId: '2', history: [{ messagesAdded: [{ message: { id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'] } }] }] };
    return { payload: { headers: [{ name: 'From', value: 'Ann <a@x.com>' }, { name: 'Subject', value: 'Hi' }] } };
  };
  const seen = [];
  acc.on('new-mail', (m) => seen.push(m));
  await Promise.all([acc.poll(), acc.poll(), acc.poll()]);
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(acc.pollBusy, false);
  acc.dispose();
  done();
});

test('listContacts does not cache a result when a scan failed', async () => {
  let fail = true;
  let lists = 0;
  const self = {
    account: () => ({ email: 'me@x.com' }),
    api: async (_m, p, { query }) => {
      if (p.endsWith('/messages')) {
        lists++;
        if (fail && query.labelIds[0] === 'INBOX') throw new Error('429');
        return { messages: [{ id: query.labelIds[0] }] };
      }
      return { internalDate: '1', payload: { headers: [{ name: 'To', value: 'ann@x.com' }, { name: 'From', value: 'bob@x.com' }] } };
    },
  };
  const first = await GmailAccount.prototype.listContacts.call(self);
  assert.strictEqual(first.partial, true);
  assert.deepStrictEqual(first.contacts.map((c) => c.email), ['ann@x.com']);
  assert.ok(!self.contactsCache, 'partial result is not cached');
  fail = false;
  const second = await GmailAccount.prototype.listContacts.call(self);
  assert.strictEqual(lists, 4, 'second call asks Google again');
  assert.ok(!second.partial);
  assert.ok(self.contactsCache, 'full result is cached');
});

test('signOut and forgetTokens clear the caches and the Primary count', async () => {
  const { store, done } = tmpStore();
  const acc = newAccount(store);
  const fill = () => Object.assign(acc, { contactsCache: { at: Date.now(), list: [] }, summaryCache: new Map([['a', 1]]), unreadPrimary: 5 });
  fill();
  acc.forgetTokens();
  assert.deepStrictEqual([acc.contactsCache, acc.summaryCache, acc.unreadPrimary], [null, null, undefined]);
  fill();
  await acc.signOut({ revoke: false });
  assert.deepStrictEqual([acc.contactsCache, acc.summaryCache, acc.unreadPrimary], [null, null, undefined]);
  acc.dispose();
  done();
});

test('parallel callers share one token refresh', async () => {
  const { store, done } = tmpStore();
  const acc = newAccount(store);
  let calls = 0;
  await withFetch(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return ok({ access_token: 'a1', expires_in: 3600 });
  }, async () => {
    const tokens = await Promise.all(Array.from({ length: 5 }, () => acc.accessToken()));
    assert.deepStrictEqual(tokens, ['a1', 'a1', 'a1', 'a1', 'a1']);
    assert.strictEqual(calls, 1);
    assert.strictEqual(acc.refreshing, null);
  });
  acc.dispose();
  done();
});

test('a late invalid_grant does not wipe a newer sign-in', async () => {
  const { store, done } = tmpStore();
  const acc = newAccount(store);
  const invalid = async () => {
    await new Promise((r) => setTimeout(r, 20));
    return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
  };
  await withFetch(invalid, async () => {
    const p = acc.accessToken();
    store.setAccount('g1', { email: 'me@x.com', refreshToken: 'r2' }); // the user signed in again meanwhile
    await assert.rejects(p, (e) => e.needsSignIn);
    assert.strictEqual(store.getAccount('g1').refreshToken, 'r2', 'newer sign-in kept');
    // Same key still stored: it is forgotten.
    await assert.rejects(acc.accessToken(), (e) => e.needsSignIn);
    assert.strictEqual(store.getAccount('g1').refreshToken, '');
  });
  acc.dispose();
  done();
});

test('In-Reply-To and References cannot add header lines', () => {
  const raw = buildRawMessage({ from: 'me@x.com', to: 'you@x.com', subject: 's', body: 'b',
    inReplyTo: '<a@x>\r\nBcc: evil@x.com', references: '<z@x>\n<a@x>\rX-Evil: 1' });
  const head = raw.split('\r\n\r\n')[0];
  assert.ok(!/\r\nBcc:/.test(head), head);
  assert.ok(!/\r\nX-Evil:/.test(head), head);
  assert.match(head, /\r\nIn-Reply-To: <a@x> Bcc: evil@x.com\r\n/);
  assert.match(head, /\r\nReferences: <z@x> <a@x> X-Evil: 1\r\n/);
});
