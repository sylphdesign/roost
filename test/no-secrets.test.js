// Guards the public repository: no keys, secrets, tokens, card numbers or private paths in tracked files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const tracked = () => {
  try {
    return execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { return []; }
};
const TEXT = /\.(js|json|md|html|css|c|txt|yml|yaml|sh)$|^\.gitignore$|^LICENSE$/;

const PATTERNS = {
  'Google API key': /AIza[0-9A-Za-z_-]{35}/,
  'Google OAuth client secret': /GOCSPX-[0-9A-Za-z_-]{20,}/,
  'Google OAuth client ID': /\d{8,}-[0-9a-z]{25,}\.apps\.googleusercontent\.com/,
  'Google access token': /ya29\.[0-9A-Za-z_-]{30,}/,
  'Google refresh token': /1\/\/0[0-9A-Za-z_-]{30,}/,
  'Anthropic API key': /sk-ant-api\d\d-[0-9A-Za-z_-]{40,}/,
  'GitHub token': /gh[pousr]_[0-9A-Za-z]{36,}/,
  'Slack token': /xox[abposr]-\d+-[0-9A-Za-z-]{10,}/,
  'AWS key': /AKIA[0-9A-Z]{16}/,
  'private key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  'card number': /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}\b/,
  'password in code': /(?:password|passwd)\s*[:=]\s*['"][^'"\s]{6,}['"]/i,
  'a private home folder path': /\/Users\/(?!me\/)[A-Za-z0-9._-]+\//,
};

test('no secrets or private paths in tracked files', () => {
  const files = tracked().filter((f) => TEXT.test(path.basename(f)) && !f.startsWith('node_modules/') && f !== 'package-lock.json');
  assert.ok(files.length > 20, 'expected to see the project files');
  const found = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    for (const [name, re] of Object.entries(PATTERNS)) if (re.test(text)) found.push(`${f}: ${name}`);
  }
  assert.deepStrictEqual(found, []);
});

test('local data and build output are git-ignored', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const p of ['node_modules/', 'dist/', 'build/bin/', '.env']) assert.ok(ignore.includes(p), `${p} should be in .gitignore`);
});
