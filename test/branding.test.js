// The app is "Roost" everywhere a person can see it, with the Roost icon.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');

test('package and build use the Roost name and icon', () => {
  assert.strictEqual(pkg.productName, 'Roost');
  assert.strictEqual(pkg.build.productName, 'Roost');
  assert.strictEqual(pkg.name, 'roost');
  assert.match(pkg.build.appId, /roost/);
  assert.strictEqual(pkg.build.mac.icon, 'build/icon.icns');
  const icns = fs.readFileSync(path.join(root, 'build', 'icon.icns'));
  assert.strictEqual(icns.subarray(0, 4).toString('latin1'), 'icns');
  for (const f of ['assets/brand/Roost-1024.png', 'src/assets/icon.png', 'src/assets/trayTemplate.png', 'src/assets/trayTemplate@2x.png']) {
    const b = fs.readFileSync(path.join(root, f));
    assert.strictEqual(b.subarray(1, 4).toString('latin1'), 'PNG', `${f} is a PNG`);
  }
});

test('the app shows the Roost name', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(read('src/ui/index.html'), /<title>Roost<\/title>/);
  const main = read('src/main.js');
  assert.match(main, /const APP_NAME = 'Roost'/);
  assert.match(main, /setToolTip\('Roost'\)/);
  assert.match(main, /title: 'Roost'/);
});
