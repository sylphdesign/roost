const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GmailAccount, GmailStore } = require('../src/gmail-api');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roost-safe-')), 's.json');

test('send refuses a file path that was not picked in the file dialog', async () => {
  const read = [];
  const acc = Object.assign(Object.create(GmailAccount.prototype), {
    deps: { readFile: async (f) => { read.push(f); return Buffer.from('x'); } },
    account: () => ({ email: 'me@x.com' }),
  });
  await assert.rejects(
    acc.send({ to: 'a@b.com', subject: 's', body: 'b', attachments: [{ path: '/Users/me/.ssh/id_ed25519' }] }),
    /Attach the file again/,
  );
  assert.deepStrictEqual(read, [], 'the file must not be read');
});

test('a file picked in the dialog can be attached', async () => {
  const acc = Object.assign(Object.create(GmailAccount.prototype), {
    deps: { showOpenDialog: async () => [{ path: '/tmp/report.pdf', name: 'report.pdf', size: 1 }] },
  });
  const r = await acc.pickAttachments();
  assert.strictEqual(r.files.length, 1);
  assert.ok(acc.pickedPaths.has('/tmp/report.pdf'));
});

test('tokens are never saved as plain text when the Keychain is not available', () => {
  const noKeychain = { isEncryptionAvailable: () => false };
  const store = new GmailStore(tmpFile(), noKeychain);
  assert.throws(() => store.enc('secret-refresh-token'), /Keychain/);
});

test('with a working Keychain, tokens are encrypted', () => {
  const keychain = {
    isEncryptionAvailable: () => true,
    encryptString: (t) => Buffer.from(`E(${t})`),
    decryptString: (b) => String(b).slice(2, -1),
  };
  const store = new GmailStore(tmpFile(), keychain);
  const v = store.enc('tok');
  assert.match(v, /^enc:/);
  assert.strictEqual(store.dec(v), 'tok');
});
