const test = require('node:test');
const assert = require('node:assert');
const { isKeyLearned, keysToShow, quietEnd, quietText } = require('../src/ui/badge');

test('a key is learned after 5 uses', () => {
  assert.strictEqual(isKeyLearned('e', { e: 5 }), true);
  assert.strictEqual(isKeyLearned('e', { e: 4 }), false);
  assert.strictEqual(isKeyLearned('e', {}), false);
  assert.strictEqual(isKeyLearned('e', undefined), false);
});
test('an item with two keys needs both keys', () => {
  assert.strictEqual(isKeyLearned('j k', { j: 9, k: 4 }), false);
  assert.strictEqual(isKeyLearned('j k', { j: 9, k: 5 }), true);
  assert.strictEqual(isKeyLearned('[ ]', { '[': 5, ']': 5 }), true);
  assert.strictEqual(isKeyLearned('[ ]', { '[': 5 }), false);
});
test('⇧F counts as F, not f', () => {
  assert.strictEqual(isKeyLearned('⇧F', { F: 5 }), true);
  assert.strictEqual(isKeyLearned('⇧F', { f: 5 }), false);
});
test('# and / are plain keys', () => {
  assert.strictEqual(isKeyLearned('#', { '#': 6 }), true);
  assert.strictEqual(isKeyLearned('/', { '/': 5 }), true);
});
test('empty key text is never learned', () => assert.strictEqual(isKeyLearned('', { '': 9 }), false));
test('keysToShow drops learned items and keeps the order', () => {
  const items = [['c', 'New'], ['j k', 'Move'], ['e', 'Archive'], ['⇧F', 'All']];
  assert.deepStrictEqual(keysToShow(items, { j: 5, k: 5, e: 2, F: 7 }).map((i) => i[1]), ['New', 'Archive']);
  assert.deepStrictEqual(keysToShow(items, null).length, 4);
  assert.deepStrictEqual(keysToShow(undefined, {}), []);
});

const at = (h, m) => new Date(2026, 10, 11, h, m, 0, 0);
test('quiet hours in the same day end today', () => {
  const end = quietEnd(at(13, 0), { from: '12:00', to: '14:30' });
  assert.strictEqual(end.getDate(), 11);
  assert.strictEqual(end.getHours(), 14);
  assert.strictEqual(end.getMinutes(), 30);
});
test('quiet hours across midnight: in the evening they end tomorrow morning', () => {
  const end = quietEnd(at(23, 15), { from: '22:00', to: '07:00' });
  assert.strictEqual(end.getDate(), 12);
  assert.strictEqual(end.getHours(), 7);
});
test('quiet hours across midnight: after midnight they end this morning', () => {
  const end = quietEnd(at(2, 0), { from: '22:00', to: '07:00' });
  assert.strictEqual(end.getDate(), 11);
  assert.strictEqual(end.getHours(), 7);
});
test('bad or empty quiet window has no end', () => {
  assert.strictEqual(quietEnd(at(2, 0), { from: '07:00', to: '07:00' }), null);
  assert.strictEqual(quietEnd(at(2, 0), { from: 'x', to: '07:00' }), null);
  assert.strictEqual(quietEnd(at(2, 0), undefined), null);
});
test('pill text: quiet hours show the end time in the locale format', () => {
  const q = { on: true, from: '22:00', to: '07:00' };
  assert.strictEqual(quietText('hours', q, { now: at(23, 0), locale: 'en-GB' }).pill, '🔕 Quiet until 07:00');
  assert.match(quietText('hours', q, { now: at(23, 0), locale: 'en-US' }).pill, /^🔕 Quiet until 7:00\sAM$/);
  assert.match(quietText('hours', q, { now: at(23, 0), locale: 'en-GB' }).title, /until 07:00/);
});
test('pill text: in a call has no time, Do Not Disturb says until you turn it off', () => {
  assert.strictEqual(quietText('call', {}).pill, '🔕 Quiet – in a call');
  assert.strictEqual(quietText('dnd', {}).pill, '🔕 Do Not Disturb · until you turn it off');
  assert.match(quietText('dnd', {}).title, /until you turn it off/);
});
test('pill text: quiet hours with a bad window fall back to the old text', () => {
  assert.strictEqual(quietText('hours', { from: '07:00', to: '07:00' }).pill, '🔕 Quiet hours');
});
test('not quiet: no pill', () => {
  assert.strictEqual(quietText(null, {}).pill, '');
  assert.strictEqual(quietText(null, {}).title, 'Do Not Disturb (⌘⇧D)');
});
