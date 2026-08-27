const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });
}

let failed = false;
for (const file of walk(path.resolve(__dirname, '..'))) {
  if (spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }).status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log('JavaScript syntax check passed');
