const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = { services: [], activeId: null, bounds: null };
let file;
let timer = null;

function load() {
  file = path.join(app.getPath('userData'), 'config.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...DEFAULTS, ...data, services: Array.isArray(data.services) ? data.services : [] };
  } catch {
    return { ...DEFAULTS, services: [] };
  }
}

function writeNow(config) {
  clearTimeout(timer);
  timer = null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, file);
}

function save(config) {
  clearTimeout(timer);
  timer = setTimeout(() => writeNow(config), 300);
}

module.exports = { load, save, writeNow };
