// Device pickers (security finding F5): a site asking for a Bluetooth, USB,
// serial, or HID device gets none. Checks that every session and page has
// Firn's refusal, that it refuses even when a device is on offer (a made-up
// one handed to the same handlers Electron calls), and that a real page's
// requests, after a click, all come back empty.
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
  .createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Devices</title><body>devices</body>');
  })
  .listen(8772);

(async () => {
  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  await ui.evaluate(() => window.firn.openUrl('127.0.0.1:8772/'));
  await wait(2000);

  const counts = await app.evaluate(({ session, webContents }) => {
    const all = webContents.getAllWebContents();
    const sessions = [...new Set(all.map((w) => w.session))];
    sessions.push(session.defaultSession);
    return {
      sessions: sessions.map((s) =>
        ['select-hid-device', 'select-usb-device', 'select-serial-port'].map(
          (e) => s.listenerCount(e),
        ),
      ),
      pages: all.map((w) => w.listenerCount('select-bluetooth-device')),
    };
  });
  check(
    'every session refuses HID, USB, and serial pickers',
    counts.sessions.length >= 2 &&
      counts.sessions.every((c) => c.every((n) => n >= 1)),
    JSON.stringify(counts.sessions),
  );
  check(
    'every page refuses the Bluetooth picker',
    counts.pages.length >= 2 && counts.pages.every((n) => n >= 1),
    JSON.stringify(counts.pages),
  );

  // Offer each handler a made-up device: it must stop Electron's default
  // (preventDefault) and choose nothing.
  const offered = await app.evaluate(({ session, webContents }) => {
    const page = webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes(':8772/'));
    const ask = (target, name, args) => {
      let prevented = false;
      let chosen = 'not answered';
      const event = { preventDefault: () => (prevented = true) };
      target.emit(name, event, ...args, (id) => (chosen = id ?? null));
      return { prevented, chosen };
    };
    const s = session.defaultSession;
    return {
      hid: ask(s, 'select-hid-device', [
        { deviceList: [{ deviceId: 'h1', name: 'Fake' }], frame: null },
      ]),
      usb: ask(s, 'select-usb-device', [
        { deviceList: [{ deviceId: 'u1', productName: 'Fake' }], frame: null },
      ]),
      serial: ask(s, 'select-serial-port', [
        [{ portId: 's1', portName: 'Fake' }],
        page,
      ]),
      bluetooth: ask(page, 'select-bluetooth-device', [
        [{ deviceId: 'b1', deviceName: 'Fake' }],
      ]),
    };
  });
  for (const kind of ['hid', 'usb', 'serial', 'bluetooth']) {
    const r = offered[kind];
    check(
      `${kind}: a device on offer is refused`,
      r.prevented && (r.chosen === null || r.chosen === ''),
      JSON.stringify(r),
    );
  }

  // A real page asking, right after a click (these need one).
  const page = app.windows().find((w) => w.url().includes(':8772/'));
  const answers = await page.evaluate(async () => {
    const tryIt = async (f) => {
      try {
        const r = await f();
        return Array.isArray(r) ? `list:${r.length}` : 'GOT A DEVICE';
      } catch (e) {
        return `refused:${e.name}`;
      }
    };
    const n = navigator;
    return {
      hid: await tryIt(() => n.hid.requestDevice({ filters: [] })),
      usb: await tryIt(() => n.usb.requestDevice({ filters: [] })),
      serial: await tryIt(() => n.serial.requestPort()),
      bluetooth: await tryIt(() =>
        n.bluetooth.requestDevice({ acceptAllDevices: true }),
      ),
      hidKnown: await tryIt(() => n.hid.getDevices()),
      usbKnown: await tryIt(() => n.usb.getDevices()),
      serialKnown: await tryIt(() => n.serial.getPorts()),
    };
  });
  check(
    'a page asking after a click gets no device',
    Object.values(answers).every(
      (a) => a.startsWith('refused:') || a === 'list:0',
    ),
    JSON.stringify(answers),
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
