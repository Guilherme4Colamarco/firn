// Diagnostics (security finding F11): Ctrl+Shift+D prints what every layer
// is doing, but never a page's address. Opens a local page with a
// recognizable address, presses the shortcut, and reads Firn's terminal
// output: the diagnostics appear, the page shows up only as a number.
const { _electron } = require('./playwright.cjs');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
const PORT = 8768;
const SECRET = 'private-diary-page';

(async () => {
  const server = http
    .createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<title>Diary</title><p>Dear diary</p>');
    })
    .listen(PORT, '127.0.0.1');

  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  let out = '';
  app.process().stdout.on('data', (d) => (out += d));
  app.process().stderr.on('data', (d) => (out += d));
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type(`http://127.0.0.1:${PORT}/${SECRET}`);
  await fl.keyboard.press('Enter');
  await wait(2500);

  const opened = await app.evaluate(
    ({ webContents }, s) =>
      webContents.getAllWebContents().some((w) => w.getURL().includes(s)),
    SECRET,
  );
  check('the page is open', opened);

  // Real key presses into the focused layer (the page), as a person would.
  const ev = (type, keyCode, modifiers) =>
    app.evaluate(
      ({ webContents }, a) => {
        const w =
          webContents.getFocusedWebContents() ||
          webContents.getAllWebContents()[0];
        w.sendInputEvent(a);
      },
      { type, keyCode, modifiers },
    );
  out = '';
  await ev('keyDown', 'D', ['control', 'shift']);
  await ev('keyUp', 'D', ['control', 'shift']);
  await wait(800);
  check(
    'the diagnostics print',
    out.includes('--- diagnostics ---'),
    out.length ? '' : 'no output',
  );
  check('pages show only as a number', /page #\d+/.test(out));
  check(
    "the page's address is not printed",
    !out.includes(SECRET) && !out.includes(`127.0.0.1:${PORT}`),
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
  server.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
