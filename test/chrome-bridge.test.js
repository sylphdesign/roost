const test = require('node:test');
const assert = require('node:assert');
const { findMainPid, pickTitle, browserName } = require('../src/chrome-bridge');

const PS = `
  101 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  202 /Applications/Google Chrome.app/Contents/Frameworks/Helper --type=renderer --user-data-dir=/x/chrome-profiles/abc
  303 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/x/chrome-profiles/abc --no-first-run --app=https://mail.google.com/
  404 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/x/chrome-profiles/def --app=https://calendar.google.com/`;

test('finds the main Chrome process of a profile, not helpers or other profiles', () => {
  assert.strictEqual(findMainPid(PS, '/x/chrome-profiles/abc'), 303);
  assert.strictEqual(findMainPid(PS, '/x/chrome-profiles/def'), 404);
  assert.strictEqual(findMainPid(PS, '/x/chrome-profiles/zzz'), null);
});
test('picks the window title that matches the app', () => {
  assert.strictEqual(pickTitle(['Settings', 'Inbox (3) - me@gmail.com - Gmail'], 'gmail'), 'Inbox (3) - me@gmail.com - Gmail');
  assert.strictEqual(pickTitle(['Only window'], 'gmail'), 'Only window');
  assert.strictEqual(pickTitle([], 'gmail'), '');
});
test('browser names', () => {
  assert.strictEqual(browserName('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), 'Google Chrome');
  assert.strictEqual(browserName('C:\\x\\msedge.exe'), 'Microsoft Edge');
});

test('reads the newest window title from a real Chrome session file', () => {
  const fs = require('fs');
  const path = require('path');
  const { titleFromSessionText } = require('../src/chrome-bridge');
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'chrome-apps-session.bin'), 'latin1');
  assert.strictEqual(titleFromSessionText(text, 'gmail'), 'Inbox (7) - test@example.com - Gmail');
  assert.strictEqual(titleFromSessionText(text, 'nothing-like-this'), null);
});
