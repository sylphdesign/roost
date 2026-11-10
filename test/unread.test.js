const test = require('node:test');
const assert = require('node:assert');
const { parseUnread } = require('../src/unread');

test('gmail count', () => assert.deepStrictEqual(parseUnread('Inbox (12) - me@gmail.com - Gmail'), { count: 12, dot: false }));
test('gmail big count', () => assert.strictEqual(parseUnread('Inbox (1,234) - Gmail').count, 1234));
test('whatsapp', () => assert.strictEqual(parseUnread('(3) WhatsApp').count, 3));
test('no unread', () => assert.deepStrictEqual(parseUnread('WhatsApp'), { count: 0, dot: false }));
test('slack dot', () => assert.deepStrictEqual(parseUnread('* general - Acme - Slack'), { count: 0, dot: true }));
test('words in brackets are not counts', () => assert.strictEqual(parseUnread('general (Channel) - Slack').count, 0));
test('empty', () => assert.deepStrictEqual(parseUnread(undefined), { count: 0, dot: false }));
