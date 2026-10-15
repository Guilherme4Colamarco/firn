// Downloads a page starts on its own, and tricky file names (security F9).
const { _electron } = require('./playwright.cjs');
const ROOT = require('path').resolve(__dirname, '../..');
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
// Three downloads started by the page itself as it opens, and three more
// from one press of a button.
const FLOOD = `<!doctype html><title>Flood</title>
<body style="font: 16px sans-serif; padding: 40px">
<button id="many" style="font-size: 20px">Three files</button>
<script>
  const grab = (tag) => { for (let n = 1; n <= 3; n++) {
    const a = document.createElement('a');
    a.href = '/f/' + tag + n + '.txt'; a.download = '';
    document.body.append(a); a.click(); } };
  grab('load');
  document.getElementById('many').onclick = () => grab('press');
</script>`;
const NAMES = {
  // "photo", right-to-left override, "gpj.exe": shows as photoexe.jpg
  '/rlo': "attachment; filename*=UTF-8''photo%E2%80%AEgpj.exe",
  '/spaces': 'attachment; filename="invoice.pdf          .exe . ."',
};
const server = http
  .createServer((req, res) => {
    if (req.url === '/flood.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(FLOOD);
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition':
        NAMES[req.url] ?? 'attachment; filename="' + req.url.slice(3) + '"',
    });
    res.end('hello');
  })
  .listen(8767);
(async () => {
  execSync(
    'rm -rf /tmp/fdg && mkdir -p /tmp/fdg && rm -f /root/.config/Firn/session.json /root/.config/Firn/downloads.json',
  );
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: require('path').join(
      ROOT,
      'node_modules/electron/dist/electron',
    ),
  });
  await wait(6000);
  await app.evaluate(({ app }) => app.setPath('downloads', '/tmp/fdg'));
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const go = async (url) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(url);
    await fl.keyboard.press('Enter');
    await wait(2000);
  };
  const files = () => fs.readdirSync('/tmp/fdg').sort();

  await go('127.0.0.1:8767/flood.html');
  const loaded = files().filter((f) => f.startsWith('load'));
  check(
    'a page opening saves only one of the files it starts by itself',
    loaded.length === 1,
    loaded.join(', '),
  );
  const pg = app.windows().find((w) => w.url().includes('flood.html'));
  await pg.click('#many');
  await wait(1500);
  let pressed = files().filter((f) => f.startsWith('press'));
  check(
    'one press lets it save one more, not three',
    pressed.length === 1,
    pressed.join(', '),
  );
  await pg.click('#many');
  await wait(1500);
  pressed = files().filter((f) => f.startsWith('press'));
  check('another press, another one', pressed.length === 2, pressed.join(', '));
  const listed = await ui.evaluate(() =>
    [...document.querySelectorAll('.download-name')].map((n) => n.textContent),
  );
  check(
    'refused ones leave nothing in the downloads list',
    listed.length === 3,
    listed.join(', '),
  );

  await go('127.0.0.1:8767/rlo');
  await go('127.0.0.1:8767/spaces');
  const all = files();
  check(
    'direction marks are taken out of file names',
    all.some((f) => /^photo.?gpj\.exe$/.test(f)) &&
      !all.some((f) => /\u202E/.test(f)),
    JSON.stringify(all),
  );
  check(
    'runs of spaces become one (the real ending stays in sight)',
    all.some((f) => f.startsWith('invoice.pdf .exe')),
    JSON.stringify(all),
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
  server.close();
})();
