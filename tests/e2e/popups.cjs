// Pages open tabs and popup windows only right after a real press or key
// in them (security F2): a script on its own opens nothing, one click
// opens one thing, and a press long ago no longer counts. A popup's
// title always starts with its real site (security F3).
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
const server = http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url === '/page')
      return res.end(
        '<title>Page</title><body style="padding:40px">' +
          '<a id="link" href="/linked" target="_blank">link</a><br>' +
          '<button id="flood" onclick="for (let i = 0; i < 5; i++) window.open(\'/flood\' + i)">flood</button><br>' +
          "<button id=\"popup\" onclick=\"window.open('/popup', 'p', 'width=400,height=300')\">popup</button>" +
          '<script>setTimeout(() => window.open("/sneaky"), 300)</script></body>',
      );
    if (req.url === '/popup')
      return res.end(
        '<title>Sign in</title><script>setTimeout(() => (document.title = "accounts.google.com"), 300)</script>popup',
      );
    res.end(`<title>${req.url}</title>${req.url}`);
  })
  .listen(8771);
(async () => {
  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  await ui.evaluate(() => window.firn.openUrl('127.0.0.1:8771/page'));
  await wait(2000);
  const urls = () =>
    app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .map((w) => w.getURL())
        .filter((u) => u.includes(':8771/')),
    );
  const pg = app.windows().find((w) => w.url().endsWith(':8771/page'));

  let u = await urls();
  check(
    'a script opening a tab on its own (no click) opens nothing',
    !u.some((x) => x.endsWith('/sneaky')),
    u.join(', '),
  );

  await pg.click('#link');
  await wait(1500);
  u = await urls();
  check(
    'a link opening a new tab still works when clicked',
    u.some((x) => x.endsWith('/linked')),
    u.join(', '),
  );

  await pg.click('#flood');
  await wait(1500);
  u = await urls();
  const floods = u.filter((x) => x.includes('/flood')).length;
  check('one click opens one tab, not five', floods === 1, `${floods}`);

  await pg.click('#popup');
  await wait(1500);
  u = await urls();
  check(
    'a sign-in style popup window opens when clicked',
    u.some((x) => x.endsWith('/popup')),
    u.join(', '),
  );

  // Security F3: a popup has no address bar, so its title starts with
  // the site actually loaded, whatever the page calls itself.
  const popupTitle = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.webContents.getURL().endsWith('/popup'))
        .map((w) => w.getTitle())
        .join(''),
    );
  let t = await popupTitle();
  check(
    "a popup's title starts with its real site",
    t.startsWith('127.0.0.1:8771 — '),
    t,
  );
  await wait(800);
  t = await popupTitle();
  check(
    "a page renaming itself can't change the site part",
    t === '127.0.0.1:8771 — accounts.google.com',
    t,
  );

  // A press, then a script opening a tab well after it: nothing.
  await pg.click('body', { position: { x: 5, y: 5 } });
  await wait(6000);
  await pg.evaluate(() => window.open('/late'));
  await wait(1000);
  u = await urls();
  check(
    'a press more than 5 seconds ago no longer counts',
    !u.some((x) => x.endsWith('/late')),
    u.join(', '),
  );

  // A key counts as a press.
  await pg.focus('#link');
  await pg.keyboard.press('Enter');
  await wait(1500);
  u = await urls();
  check(
    'a key (Enter on a link) counts',
    u.filter((x) => x.endsWith('/linked')).length === 2,
    u.join(', '),
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
