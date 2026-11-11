const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { runAiTask, buildPrompt, parseReplies, MODEL } = require('../src/ai');

function fakeClaude(reply, status = 200) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? {
        id: 'msg_1', type: 'message', role: 'assistant', model: MODEL, stop_reason: 'end_turn',
        content: [{ type: 'text', text: reply }], usage: { input_tokens: 1, output_tokens: 1 },
      } : { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test('write sends a Claude request with the key, model and fallbacks', async () => {
  const f = await fakeClaude('Hi Sam,\n\nSee you Friday.');
  const r = await runAiTask({ task: 'write', prompt: 'tell Sam I come Friday', to: 'sam@x.com' }, { getKey: () => 'sk-ant-test', fake: false, baseURL: f.url });
  f.server.close();
  assert.strictEqual(r.text, 'Hi Sam,\n\nSee you Friday.');
  const req = f.seen[0];
  assert.match(req.url, /\/v1\/messages/);
  assert.ok(req.headers['x-api-key'] === 'sk-ant-test' || req.headers.authorization === 'Bearer sk-ant-test');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.strictEqual(req.body.model, 'claude-opus-5-5');
  assert.strictEqual(req.body.fallbacks, 'default');
  assert.match(req.body.messages[0].content, /tell Sam I come Friday/);
});

test('replies are split into 3 lines', async () => {
  const f = await fakeClaude('1. Thanks!\n- Sounds good.\n"Let me check."\nextra');
  const r = await runAiTask({ task: 'replies', thread: { subject: 'Lunch', messages: [{ from: 'a', date: 'd', text: 'Lunch?' }] } }, { getKey: () => 'k', fake: false, baseURL: f.url });
  f.server.close();
  assert.deepStrictEqual(r.replies, ['Thanks!', 'Sounds good.', 'Let me check.']);
});

test('no key and a bad key ask for a key', async () => {
  await assert.rejects(runAiTask({ task: 'rewrite', style: 'polish', draft: 'hi' }, { getKey: () => null, fake: false }), (e) => e.needsAiKey === true);
  const f = await fakeClaude('', 401);
  await assert.rejects(runAiTask({ task: 'rewrite', style: 'polish', draft: 'hi' }, { getKey: () => 'bad', fake: false, baseURL: f.url }), (e) => e.needsAiKey === true);
  f.server.close();
});

test('prompts validate input', () => {
  assert.throws(() => buildPrompt({ task: 'rewrite', style: 'nope', draft: 'x' }));
  assert.throws(() => buildPrompt({ task: 'write', prompt: '  ' }));
  assert.throws(() => buildPrompt({ task: 'hack' }));
  assert.match(buildPrompt({ task: 'rewrite', style: 'shorter', draft: 'long text' }), /shorter/);
  assert.deepStrictEqual(parseReplies('a\nb'), ['a', 'b']);
});

test('complete task: prompt asks for a short continuation of the draft', () => {
  const p = buildPrompt({ task: 'complete', draft: 'Hi Sam, thanks for', subject: 'Lunch' });
  assert.match(p, /Hi Sam, thanks for\n<\/draft>/);
  assert.match(p, /at most 10 words/);
  assert.throws(() => buildPrompt({ task: 'complete', draft: '  ' }), /Write something first/);
});

test('cleanCompletion keeps the leading space, drops <none>, quotes and repeats', () => {
  const { cleanCompletion } = require('../src/ai');
  assert.strictEqual(cleanCompletion(' the quick reply.\nextra line', 'Thanks for'), ' the quick reply.');
  assert.strictEqual(cleanCompletion('s for your help', 'Thank'), 's for your help');
  assert.strictEqual(cleanCompletion(' more', 'Thanks '), 'more');
  assert.strictEqual(cleanCompletion('<none>', 'Hi'), '');
  assert.strictEqual(cleanCompletion(' "see you soon"', 'Ok'), ' see you soon');
  assert.strictEqual(cleanCompletion('thanks for lunch today', 'Hi, thanks for'), ' lunch today');
  assert.strictEqual(cleanCompletion(' a b c d e f g h i j k l m n', 'x').trim().split(' ').length, 12);
});

test('complete task through the API returns raw continuation (empty allowed)', async () => {
  const fc = await fakeClaude('<none>');
  try {
    const r = await runAiTask({ task: 'complete', draft: 'Hello' }, { getKey: () => 'sk-test', fake: false, baseURL: fc.url });
    assert.deepStrictEqual(r, { text: '' });
  } finally { fc.server.close(); }
});
