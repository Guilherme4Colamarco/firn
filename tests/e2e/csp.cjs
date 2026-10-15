// Firn's own UI has a Content Security Policy (security finding F10): only
// its own scripts, styles, and fonts, never inline or injected scripts. The
// policy is sent with the built UI at firn://app (Vite's dev server, which
// the other checks use, needs inline scripts), so this check packages Firn
// and runs the real build.
const { _electron } = require('./playwright.cjs');
const fs = require('fs');
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

(async () => {
  // Packaging rebuilds .vite/build without the dev server; keep the other
  // checks' copy and put it back afterwards.
  const build = path.join(ROOT, '.vite/build');
  const kept = path.join(__dirname, 'out/build-dev');
  fs.rmSync(kept, { recursive: true, force: true });
  fs.cpSync(build, kept, { recursive: true });
  try {
    execSync('npx electron-forge package', { cwd: ROOT, stdio: 'ignore' });
  } finally {
    fs.rmSync(build, { recursive: true, force: true });
    fs.renameSync(kept, build);
  }

  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    timeout: 60000,
    // The packaged app's own code, run by plain Electron (the packaged
    // binary's fuses rightly refuse the debugger this check drives it with).
    args: [
      '--no-sandbox',
      path.join(ROOT, 'out/Firn-linux-x64/resources/app.asar'),
    ],
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url() === 'firn://app/index.html');
  check('the built UI loads from firn://app', !!ui, ui ? '' : 'not found');
  if (!ui) {
    await app.close();
    process.exit(1);
  }

  // Watch for anything the policy refuses while every part of the UI (the
  // sidebar, the floating layer, the top bar, the peek) loads from scratch.
  const refused = [];
  const views = app.windows().filter((w) => w.url().startsWith('firn://app/'));
  for (const view of views) {
    view.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) refused.push(m.text());
    });
    await view.reload();
  }
  await wait(3000);

  const header = await ui.evaluate(() =>
    fetch(location.href).then((r) => r.headers.get('content-security-policy')),
  );
  check(
    'the UI is sent with a policy',
    /script-src 'self'/.test(header ?? '') &&
      /default-src 'none'/.test(header ?? ''),
    header ?? 'none',
  );

  // The UI still works under it: the sidebar shows, a tab opens with its
  // site's favicon, and the Fraunces font loads.
  const sidebar = await ui.evaluate(
    () => !!document.querySelector('.app .sidebar-resizer'),
  );
  check('the sidebar shows under the policy', sidebar);
  await ui.evaluate(() =>
    window.firn.openUrl('http://localhost:8765/blue.html'),
  );
  await wait(2500);
  const favicon = await ui.evaluate(() => {
    const img = document.querySelector('img.tab-favicon');
    return img ? img.complete && img.naturalWidth > 0 : null;
  });
  check("a site's favicon still shows in its tab", favicon === true, favicon);
  const font = await ui.evaluate(async () => {
    await document.fonts.load('32px Fraunces');
    return document.fonts.check('32px Fraunces');
  });
  check('Firn’s own font still loads', font);
  // The command bar and Settings (in the floating layer).
  const fl = views.find((w) => w.url().includes('view=floating'));
  // Ctrl+T as a real keyboard sends it (to whatever has focus).
  for (const type of ['keyDown', 'keyUp'])
    await app.evaluate(({ webContents }, type) => {
      const w =
        webContents.getFocusedWebContents() ||
        webContents.getAllWebContents()[0];
      w.sendInputEvent({ type, keyCode: 'T', modifiers: ['control'] });
    }, type);
  await wait(500);
  const bar = await fl.evaluate(() => !!document.querySelector('.command-bar'));
  check('the command bar opens', bar);
  await fl.keyboard.type('settings');
  await wait(400);
  await fl.locator('.result', { hasText: /^Settings/ }).click();
  await wait(800);
  await fl.keyboard.press('Escape');
  await wait(300);
  check(
    'nothing Firn needs is refused',
    refused.length === 0,
    refused.slice(0, 2).join(' | '),
  );

  // An injected script (say, a hostile page title that slipped into the
  // page as HTML) never runs.
  const ran = await ui.evaluate(async () => {
    window.__injected = false;
    const s = document.createElement('script');
    s.textContent = 'window.__injected = true';
    document.body.appendChild(s);
    const d = document.createElement('div');
    d.innerHTML = '<img src="x:" onerror="window.__injected = true">';
    document.body.appendChild(d);
    await new Promise((r) => setTimeout(r, 300));
    s.remove();
    d.remove();
    return window.__injected;
  });
  check('an injected script never runs in the UI', ran === false, ran);
  // (And the watch above really sees refusals: this one was reported.)
  check('the refusal is reported', refused.length > 0, refused.length);

  await app.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed  (' + e.message.split('\n')[0] + ')');
  process.exit(1);
});
