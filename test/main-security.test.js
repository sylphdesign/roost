// Security rules in src/main.js. main.js needs Electron, so the pure helpers are cut out of the source and run in a VM.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

function cut(startRe, endMarker) {
  const start = SRC.search(startRe);
  assert.ok(start >= 0, `missing ${startRe}`);
  const end = SRC.indexOf(endMarker, start);
  assert.ok(end > start, `missing end of ${startRe}`);
  return SRC.slice(start, end);
}

function loadHelpers() {
  const authHosts = cut(/const AUTH_HOSTS = \[/, '];') + '];';
  const hostOf = cut(/const hostOf = /, '\n');
  const helpers = cut(/\/\/ --- security helpers/, '// --- end security helpers ---');
  const unwrap = cut(/function unwrapRedirect\(url\) \{/, '\nfunction normalizeUrl');
  const ctx = { require, path, URL };
  vm.createContext(ctx);
  vm.runInContext(`${authHosts}\n${hostOf}\n${helpers}\n${unwrap}\nthis.h = { isGoogleRedirectHost, isAuthHost, hostAllowedFor, permissionAllowedFor, unwrapRedirect };`, ctx);
  return ctx.h;
}

const h = loadHelpers();

test('Google redirect hosts: real ones only', () => {
  for (const ok of ['google.com', 'www.google.com', 'www.google.de', 'google.co.uk', 'www.google.com.au', 'WWW.GOOGLE.COM']) {
    assert.ok(h.isGoogleRedirectHost(ok), ok);
  }
  for (const bad of ['google.attacker.com', 'www.google.evil.co', 'evilgoogle.com', 'google.com.evil.com', 'mail.google.com.x.io', 'notgoogle.com']) {
    assert.ok(!h.isGoogleRedirectHost(bad), bad);
  }
});

test('unwrapRedirect: unwraps Google links, ignores look-alike hosts', () => {
  assert.strictEqual(h.unwrapRedirect('https://www.google.com/url?q=https://example.com/a'), 'https://example.com/a');
  const spoof = 'https://google.attacker.com/url?q=https://mail.google.com/';
  assert.strictEqual(h.unwrapRedirect(spoof), spoof);
});

test('popup rule uses the URL that loads', () => {
  const svc = 'https://app.slack.com/client';
  assert.ok(h.hostAllowedFor('https://app.slack.com/x', svc));
  assert.ok(h.hostAllowedFor('https://accounts.google.com/o/oauth2', svc));
  assert.ok(h.hostAllowedFor('https://discord.com/oauth2/authorize', 'https://web.whatsapp.com/'));
  assert.ok(h.hostAllowedFor('https://www.example.com/', 'https://example.com/'), 'www. is ignored');
  assert.ok(!h.hostAllowedFor('https://attacker.com/', svc));
  assert.ok(!h.hostAllowedFor('https://slack.com.attacker.com/', svc));
  assert.ok(!h.hostAllowedFor('about:blank', svc));
  assert.ok(!h.hostAllowedFor('https://attacker.com/', ''));
  // A spoofed Google wrapper loads attacker.com: not allowed even though q= points at an auth host.
  assert.ok(!h.hostAllowedFor('https://google.attacker.com/url?q=https://accounts.google.com/', svc));
});

test('window open handler decides from url, not target', () => {
  const handler = cut(/wc\.setWindowOpenHandler\(/, 'openExternal(target);\n    return { action: \'deny\' };');
  assert.match(handler, /hostAllowedFor\(url, svcUrl\)/);
  assert.doesNotMatch(handler, /hostOf\(target\)/);
});

test('popups check will-navigate', () => {
  const block = cut(/wc\.on\('did-create-window'/, 'attachWindowRules(cwc, svc);');
  assert.match(block, /cwc\.on\('will-navigate'/);
  assert.match(block, /e\.preventDefault\(\)/);
  assert.match(block, /about:blank/);
});

test('permissions: own site, auth hosts, Roost screens only', () => {
  const appDir = '/Applications/Roost.app/Contents/Resources/app/src';
  const svc = 'https://web.whatsapp.com/';
  assert.ok(h.permissionAllowedFor('https://web.whatsapp.com/', svc, appDir));
  assert.ok(h.permissionAllowedFor('https://accounts.google.com/', svc, appDir));
  assert.ok(!h.permissionAllowedFor('https://attacker.com/', svc, appDir));
  assert.ok(!h.permissionAllowedFor('', svc, appDir));
  assert.ok(h.permissionAllowedFor(`file://${appDir}/gmail/index.html`, 'https://mail.google.com/', appDir));
  assert.ok(!h.permissionAllowedFor('file:///tmp/evil.html', svc, appDir));
  assert.ok(!h.permissionAllowedFor(`file://${appDir}-evil/x.html`, svc, appDir));
});

test('permission handlers check the origin', () => {
  const block = cut(/function setupSession\(ses, svcId\)/, 'setDisplayMediaRequestHandler');
  assert.match(block, /setPermissionCheckHandler\([^]*originOk/);
  assert.match(block, /setPermissionRequestHandler\([^]*if \(!originOk\([^)]*\)\) return callback\(false\)/);
});

test('ROOST_* test hooks work only when the app is not packaged', () => {
  assert.match(SRC, /function devEnv\(name\) \{ return app\.isPackaged \? undefined : process\.env\[name\]; \}/);
  assert.doesNotMatch(SRC, /process\.env\.ROOST_/);
  assert.doesNotMatch(SRC, /process\.env\[['"]ROOST_/);
  assert.match(SRC, /devEnv\('ROOST_E2E_SCRIPT'\)\) require\(devEnv\('ROOST_E2E_SCRIPT'\)\)/);
  assert.match(SRC, /d\.plain && devEnv\('ROOST_PLAIN_TOKENS'\)/);
});

test('notifications are kept until click or close', () => {
  assert.match(SRC, /const liveNotifications = new Set\(\);/);
  const keep = cut(/function keepNotification\(n\)/, '\n}\n');
  assert.match(keep, /n\.on\('click', drop\)/);
  assert.match(keep, /n\.on\('close', drop\)/);
  const shows = SRC.match(/keepNotification\(n\);\n\s*n\.show\(\);/g) || [];
  const allShows = SRC.match(/\bn\.show\(\);/g) || [];
  assert.strictEqual(shows.length, allShows.length);
});

test('resume re-checks mail and reminders for signed-in accounts', async () => {
  assert.match(SRC, /powerMonitor\.on\('resume'/);
  const fn = cut(/function refreshApiAccountsAfterResume\(\)/, '\n}\n') + '\n}';
  const calls = [];
  const gmailAccounts = new Map([
    ['a', { status: () => ({ signedIn: true }), poll: async () => calls.push('poll') }],
    ['b', { status: () => ({ signedIn: true }), scheduleReminders: async () => calls.push('remind') }],
    ['c', { status: () => ({ signedIn: false }), poll: async () => calls.push('bad') }],
    ['d', { status: () => { throw new Error('x'); } }],
    ['e', { status: () => ({ signedIn: true }), poll: () => Promise.reject(new Error('offline')) }],
  ]);
  const ctx = { gmailAccounts };
  vm.createContext(ctx);
  vm.runInContext(`${fn}\nrefreshApiAccountsAfterResume();`, ctx);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(calls.sort(), ['poll', 'remind']);
});
