// Runs every test: the unit tests, then each app test (test/*.e2e.js) one after another.
// App tests start the real app against a fake Google server; they need a display. Run: npm run test:all
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const results = [];
const run = (name, cmd, args) => {
  const t = Date.now();
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  results.push({ name, ok: r.status === 0, secs: Math.round((Date.now() - t) / 1000) });
};

run('unit tests', process.execPath, ['--test', ...fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).map((f) => path.join('test', f))]);
const electron = require(path.join(root, 'node_modules', 'electron'));
for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith('.e2e.js')).sort()) {
  // recipes.e2e.js runs inside Electron; the others start Electron themselves.
  if (f === 'recipes.e2e.js') run(f, electron, [path.join('test', f)]);
  else run(f, process.execPath, [path.join('test', f)]);
}
console.log('\n---- summary ----');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.secs}s)`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} FAILED` : 'all tests passed');
process.exit(failed ? 1 : 0);
