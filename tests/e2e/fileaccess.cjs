// Local pages and Firn's own UI (security finding F1): a local (file://)
// page can't read other files on the computer, and web pages can't reach
// Firn's UI files (firn://app, in the UI's own session). The checks run
// Firn's development build, so this one uses a copy of Electron with the
// same fuse switched off that forge.config.mts switches off in real builds,
// and checks forge.config.mts still says so.
const { _electron } = require('./playwright.cjs');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const SP = process.env.SP || path.join(__dirname, 'out');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};

(async () => {
  const config = fs.readFileSync(path.join(ROOT, 'forge.config.mts'), 'utf8');
  check(
    'real builds switch off extra file access for local pages',
    /\[FuseV1Options\.GrantFileProtocolExtraPrivileges\]:\s*false/.test(config),
  );

  // Electron with that fuse off (made once, kept in the checks' out folder).
  const dist = path.join(SP, 'electron-nofileaccess');
  const exe = path.join(dist, 'electron');
  if (!fs.existsSync(exe)) {
    fs.cpSync(path.join(ROOT, 'node_modules/electron/dist'), dist, {
      recursive: true,
    });
    execSync(
      `node -e "const f = require('@electron/fuses'); f.flipFuses(process.argv[1], { version: f.FuseVersion.V1, [f.FuseV1Options.GrantFileProtocolExtraPrivileges]: false })" "${exe}"`,
      { cwd: ROOT },
    );
  }

  // A local page with a file beside it.
  const local = path.join(SP, 'fileaccess');
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, 'secret.txt'), 'SECRET');
  fs.writeFileSync(
    path.join(local, 'page.html'),
    '<title>Local</title><body>A local page</body>',
  );

  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: exe,
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const pageUrl = 'file://' + path.join(local, 'page.html');
  await ui.evaluate((u) => window.firn.openUrl(u), pageUrl);
  await wait(1500);
  const pg = app.windows().find((w) => w.url() === pageUrl);

  const read = (url) =>
    pg.evaluate(
      (u) =>
        fetch(u).then(
          (r) => r.text().then((t) => 'read ' + t),
          () => 'blocked',
        ),
      url,
    );
  const beside = await read('secret.txt');
  check(
    "a local page can't read a file beside it",
    beside === 'blocked',
    beside,
  );
  const elsewhere = await read('file:///etc/hostname');
  check(
    "a local page can't read another file on the computer",
    elsewhere === 'blocked',
    elsewhere,
  );
  const xhr = await pg.evaluate(
    () =>
      new Promise((resolve) => {
        const x = new XMLHttpRequest();
        x.onload = () => resolve('read');
        x.onerror = () => resolve('blocked');
        try {
          x.open('GET', 'secret.txt');
          x.send();
        } catch {
          resolve('blocked');
        }
      }),
  );
  check('nor with an older-style request', xhr === 'blocked', xhr);

  const toUi = await read('firn://app/index.html');
  check("a page can't reach Firn's UI files", toUi === 'blocked', toUi);

  const sessions = await app.evaluate(({ session, webContents }) => {
    const all = webContents.getAllWebContents();
    const isUi = (w) => w.getURL().includes(':5173/');
    return {
      uiShared: all
        .filter(isUi)
        .some((w) => w.session === session.defaultSession),
      pagesOwn: all
        .filter((w) => w.getURL().startsWith('file:'))
        .every((w) => w.session === session.defaultSession),
    };
  });
  check(
    "Firn's UI has its own session, apart from web pages",
    !sessions.uiShared && sessions.pagesOwn,
    JSON.stringify(sessions),
  );

  const asked = await ui.evaluate(() =>
    navigator.permissions.query({ name: 'notifications' }).then((p) => p.state),
  );
  check("Firn's UI gets no permissions", asked === 'denied', asked);

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
