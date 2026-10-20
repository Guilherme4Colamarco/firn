// Websites see Firn as plain Chrome: no "Firn/…" or "Electron/…" in the
// browser's name (some sites, Microsoft's among them, act differently when
// they see Electron's), in what pages read and what they're sent, and only
// the main Chrome version ("Chrome/152.0.0.0"), as real Chrome sends.
// Except on Google's sign-in page (pretended here on port 8768), which is
// sent Firefox's name and no "which browser" hints, and only there.
const { _electron } = require('./playwright.cjs');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '../..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
let sent = '';
let sentHints = '';
const server = http
  .createServer((req, res) => {
    sent = req.headers['user-agent'] ?? '';
    sentHints = req.headers['sec-ch-ua'] ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Agent</title>');
  })
  .listen(8767);
const signIn = [];
const signInServer = http
  .createServer((req, res) => {
    // (Not Firn's own look for the tab's icon: not the page's, and not
    // what Google judges the browser by.)
    if (req.url !== '/favicon.ico')
      signIn.push({
        agent: req.headers['user-agent'] ?? '',
        hints: Object.keys(req.headers).filter((h) =>
          h.startsWith('sec-ch-ua'),
        ),
      });
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
    });
    res.end('<title>Sign in</title>');
  })
  .listen(8768);
(async () => {
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    env: {
      ...process.env,
      FIRN_GOOGLE_SIGN_IN_TEST: 'http://127.0.0.1:8768/*',
    },
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  await ui.evaluate(() => window.firn.openUrl('127.0.0.1:8767/'));
  await wait(1500);
  const pg = app.windows().find((w) => w.url().includes(':8767/'));
  const read = await pg.evaluate(() => navigator.userAgent);
  const plain = (ua) =>
    /Chrome\/\d/.test(ua) && !/Electron|Firn/i.test(ua) && ua.length > 0;
  check('pages read a plain Chrome name', plain(read), read);
  check('...and are sent the same', plain(sent) && sent === read, sent);
  check(
    'only the main Chrome version, as real Chrome sends',
    /Chrome\/\d+\.0\.0\.0 /.test(read),
    read.match(/Chrome\/\S+/)?.[0] ?? read,
  );
  check(
    'other sites get Chromium\'s "which browser" hints as usual',
    sentHints.includes('Chromium'),
    sentHints,
  );

  // Something a page loads from the sign-in address is sent Firefox's name.
  await pg.evaluate(() => fetch('http://127.0.0.1:8768/check').then(() => 0));
  await wait(500);
  // The sign-in page itself, in a tab.
  await ui.evaluate(() => window.firn.openUrl('127.0.0.1:8768/'));
  await wait(1500);
  const firefox = (ua) =>
    /^Mozilla\/5\.0 \([^)]*rv:\d+\.0\) Gecko\/20100101 Firefox\/\d+\.0$/.test(
      ua,
    );
  check(
    "Google's sign-in page is sent Firefox's name",
    signIn.length >= 2 && signIn.every((r) => firefox(r.agent)),
    signIn.map((r) => r.agent).join(' | '),
  );
  check(
    '...with no Chromium hints',
    signIn.length >= 2 && signIn.every((r) => r.hints.length === 0),
    signIn.flatMap((r) => r.hints).join(', '),
  );
  check(
    "...and a recent Firefox (about Chrome's version + 3)",
    signIn.every(
      (r) =>
        Number(r.agent.match(/Firefox\/(\d+)/)?.[1]) ===
        Number(read.match(/Chrome\/(\d+)/)?.[1]) + 3,
    ),
  );
  // Back on another site, the usual name again.
  sent = '';
  await pg.reload();
  await wait(1000);
  check('other sites still see Chrome afterwards', plain(sent), sent);
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
  server.close();
  signInServer.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
