#!/usr/bin/env node
//
// Reads and writes the spreadsheet's bound Apps Script project.
//
// Why not clasp: the CLI is a global npm package that can vanish from PATH
// (it already did once), and all it really contributes is an OAuth token.
// That token is what matters, so this talks to the Apps Script API directly
// using the credentials clasp left in ~/.clasprc.json — no global install to
// keep alive, and the commands live in the repo next to everything else.
//
// The service account cannot be used here: the API gates writes on a per-user
// setting that a service account has no way to hold, so it can read the
// project but never update it.
//
//   node scripts/apps-script.js diff    # remote vs repo, exit 1 if different
//   node scripts/apps-script.js pull    # remote  -> repo
//   node scripts/apps-script.js push    # repo -> remote, needs --yes
//
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { google } = require('googleapis');

const SCRIPT_ID = process.env.APPS_SCRIPT_ID
  || '125uCJleXCJvJRuxsMNFIxI0c6a-yHxEukUbF7Tcv4JuoxoKfO9nYD9hc';

// Remote file name -> path in this repository. The manifest is tracked too:
// it carries the timezone and runtime version, which change behaviour.
const FILES = {
  ccltracking: { type: 'SERVER_JS', local: 'deploy/google-apps-script.gs' },
  appsscript: { type: 'JSON', local: 'deploy/appsscript.json' },
};

const repoPath = (rel) => path.join(__dirname, '..', rel);

function client() {
  const credentials = path.join(os.homedir(), '.clasprc.json');
  if (!fs.existsSync(credentials)) {
    throw new Error('Не найден ~/.clasprc.json. Выполните: npx @google/clasp login');
  }
  const token = JSON.parse(fs.readFileSync(credentials, 'utf8')).tokens?.default;
  if (!token?.refresh_token) throw new Error('В ~/.clasprc.json нет refresh_token — войдите заново.');
  const auth = new google.auth.OAuth2(token.client_id, token.client_secret);
  auth.setCredentials({ refresh_token: token.refresh_token });
  return google.script({ version: 'v1', auth });
}

// Apps Script stores sources with \n; a checkout on Windows has \r\n. Compare
// and send normalised text so a line-ending difference never looks like an edit.
const lf = (text) => text.replace(/\r\n/g, '\n');

async function readRemote(api) {
  const { data } = await api.projects.getContent({ scriptId: SCRIPT_ID });
  return Object.fromEntries(data.files.map((f) => [f.name, lf(f.source)]));
}

function readLocal() {
  const out = {};
  for (const [name, { local }] of Object.entries(FILES)) {
    const full = repoPath(local);
    if (fs.existsSync(full)) out[name] = lf(fs.readFileSync(full, 'utf8'));
  }
  return out;
}

function report(remote, local) {
  let differs = false;
  for (const name of Object.keys(FILES)) {
    const a = remote[name];
    const b = local[name];
    if (a === undefined) { console.log(`${name}: нет в скрипте`); differs = true; continue; }
    if (b === undefined) { console.log(`${name}: нет в репозитории (${FILES[name].local})`); differs = true; continue; }
    if (a === b) { console.log(`${name}: совпадает`); continue; }
    differs = true;
    console.log(`${name}: РАЗЛИЧАЕТСЯ`);
    const tmp = path.join(os.tmpdir(), `gas-${name}`);
    fs.writeFileSync(`${tmp}.remote`, a);
    fs.writeFileSync(`${tmp}.local`, b);
    try {
      execFileSync('git', ['--no-pager', 'diff', '--no-index', '--', `${tmp}.remote`, `${tmp}.local`], { stdio: 'inherit' });
    } catch {
      // git diff exits non-zero whenever the files differ — that is the
      // expected path here, and the diff has already been printed.
    }
  }
  return differs;
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  const api = client();

  if (command === 'pull') {
    const remote = await readRemote(api);
    for (const [name, { local }] of Object.entries(FILES)) {
      if (remote[name] === undefined) continue;
      fs.writeFileSync(repoPath(local), remote[name]);
      console.log(`${local} <- ${name}`);
    }
    return;
  }

  if (command === 'diff') {
    process.exitCode = report(await readRemote(api), readLocal()) ? 1 : 0;
    return;
  }

  if (command === 'push') {
    const remote = await readRemote(api);
    const local = readLocal();
    // A push replaces the project wholesale, so anything edited in the Apps
    // Script editor and not pulled first would be destroyed silently.
    if (!report(remote, local)) return console.log('Нечего отправлять.');
    if (!flags.includes('--yes')) {
      console.log('\nОтправка перезапишет скрипт целиком. Повторите с --yes.');
      process.exitCode = 1;
      return;
    }
    const files = Object.entries(FILES)
      .filter(([name]) => local[name] !== undefined)
      .map(([name, { type }]) => ({ name, type, source: local[name] }));
    await api.projects.updateContent({ scriptId: SCRIPT_ID, requestBody: { files } });
    const after = await readRemote(api);
    const ok = Object.entries(local).every(([name, source]) => after[name] === source);
    console.log(ok ? 'Отправлено, скрипт совпадает с репозиторием.' : 'ОТПРАВЛЕНО, НО СОДЕРЖИМОЕ РАСХОДИТСЯ — проверьте.');
    if (!ok) process.exitCode = 1;
    return;
  }

  console.log('Использование: node scripts/apps-script.js <pull|diff|push [--yes]>');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('Ошибка:', error.code || '', error.message);
  process.exitCode = 1;
});
