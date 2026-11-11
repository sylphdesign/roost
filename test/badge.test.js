const test = require('node:test');
const assert = require('node:assert');
const { badgeFor, welcomePresets, welcomeHint, welcomeButtonLabel } = require('../src/ui/badge');
const { PRESETS } = require('../src/presets');

test('red badge shows the count that needs a person', () => assert.deepStrictEqual(badgeFor({ unread: 12, important: 3 }), { kind: 'red', text: '3' }));
test('calm gray badge when nothing needs a person', () => assert.deepStrictEqual(badgeFor({ unread: 7, important: 0 }), { kind: 'calm', text: '7' }));
test('no important field: every unread item counts (chat apps)', () => assert.deepStrictEqual(badgeFor({ unread: 4 }), { kind: 'red', text: '4' }));
test('dot when something is new but has no count', () => assert.deepStrictEqual(badgeFor({ unread: 0, important: 0, dot: true }), { kind: 'dot', text: '' }));
test('no badge when nothing is new', () => {
  assert.strictEqual(badgeFor({ unread: 0, important: 0, dot: false }), null);
  assert.strictEqual(badgeFor(undefined), null);
});
test('big counts are cut to 99+', () => {
  assert.strictEqual(badgeFor({ unread: 500, important: 120 }).text, '99+');
  assert.strictEqual(badgeFor({ unread: 150, important: 0 }).text, '99+');
});
test('a count beats the dot', () => assert.strictEqual(badgeFor({ unread: 2, important: 0, dot: true }).kind, 'calm'));

test('welcome offers email and chat apps, then Google Calendar, never custom', () => {
  const types = welcomePresets(PRESETS).map((p) => p.type);
  assert.deepStrictEqual(types, ['gmail', 'whatsapp', 'slack', 'telegram', 'discord', 'messenger', 'calendar']);
  assert.deepStrictEqual(welcomePresets(undefined), []);
});
test('welcome hints', () => {
  const by = (t) => PRESETS.find((p) => p.type === t);
  assert.strictEqual(welcomeHint(by('gmail')), 'Needs your own Google key · about 10 min');
  assert.strictEqual(welcomeHint(by('slack')), 'Just sign in');
  assert.strictEqual(welcomeHint(by('calendar')), 'Uses your Gmail key');
});
test('welcome button label', () => {
  assert.strictEqual(welcomeButtonLabel(0), 'Pick the apps you use');
  assert.strictEqual(welcomeButtonLabel(1), 'Add 1 app');
  assert.strictEqual(welcomeButtonLabel(3), 'Add 3 apps');
});
test('every chat preset has a bundled icon (no request to the app maker)', () => {
  for (const p of PRESETS.filter((x) => x.group === 'chat' && x.type !== 'custom')) assert.match(p.icon || '', /^data:image\/png;base64,/, p.type);
});
