// Client certificates (security finding F4): a site asking for one gets
// none, even with one on the computer. Makes a test certificate authority,
// a site certificate, and a client certificate, puts the client certificate
// where Chromium looks on Linux (the NSS database in ~/.pki/nssdb, removed
// again at the end), and runs a small https site that asks for it and says
// whether it got one. As a control, the same site on a second port with
// Firn's handler taken out does get the certificate (Electron's default), so
// the check would catch a leak.
const { _electron } = require('./playwright.cjs');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
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
const NSS = `sql:${process.env.HOME}/.pki/nssdb`;
const NICK = 'firn-test-client';
const PORT = 8766;
const CONTROL_PORT = 8767;

const SERVER = `
import http.server, ssl, sys
d = sys.argv[1]
port = int(sys.argv[2])
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        got = self.connection.getpeercert()
        body = ('certificate: ' + ('yes' if got else 'no')).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        pass
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(d + '/server.crt', d + '/server.key')
ctx.load_verify_locations(d + '/ca.crt')
ctx.verify_mode = ssl.CERT_OPTIONAL
s = http.server.HTTPServer(('127.0.0.1', port), H)
s.socket = ctx.wrap_socket(s.socket, server_side=True)
s.serve_forever()
`;

const makeCerts = (d) => {
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  const sh = (c) => execSync(c, { cwd: d, stdio: 'ignore' });
  sh(
    'openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 2 -subj "/CN=Firn Test CA"',
  );
  fs.writeFileSync(path.join(d, 'server.ext'), 'subjectAltName=IP:127.0.0.1\n');
  sh(
    'openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=127.0.0.1"',
  );
  sh(
    'openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 2 -extfile server.ext',
  );
  fs.writeFileSync(path.join(d, 'client.ext'), 'extendedKeyUsage=clientAuth\n');
  sh(
    'openssl req -newkey rsa:2048 -nodes -keyout client.key -out client.csr -subj "/CN=Firn Test Person"',
  );
  sh(
    'openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 2 -extfile client.ext',
  );
  sh(
    `openssl pkcs12 -export -inkey client.key -in client.crt -name ${NICK} -out client.p12 -passout pass:`,
  );
};
const removeClientCert = () => {
  try {
    execSync(`certutil -D -d ${NSS} -n ${NICK}`, { stdio: 'ignore' });
  } catch {}
};

(async () => {
  const d = path.join(SP, 'clientcert');
  makeCerts(d);
  removeClientCert();
  execSync(`pk12util -i client.p12 -d ${NSS} -W ""`, {
    cwd: d,
    stdio: 'ignore',
  });
  const servers = [PORT, CONTROL_PORT].map((p) =>
    spawn('python3', ['-c', SERVER, d, String(p)], { stdio: 'ignore' }),
  );

  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  // Trust the test site's own certificate, and note each certificate
  // question (after Firn's own answer, which comes first).
  await app.evaluate(({ app: a, session }) => {
    session.defaultSession.setCertificateVerifyProc((req, cb) =>
      cb(req.hostname === '127.0.0.1' ? 0 : -3),
    );
    globalThis.__asked = [];
    a.on('select-client-certificate', (_e, _wc, url, list) => {
      globalThis.__asked.push({ url, count: list.length });
    });
  });
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const open = async (u) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(u);
    await fl.keyboard.press('Enter');
    await wait(2500);
  };
  const pageText = (port) =>
    app.evaluate(async ({ webContents }, p) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith(`https://127.0.0.1:${p}/`));
      return wc
        ? wc.executeJavaScript('document.body.innerText', true)
        : webContents
            .getAllWebContents()
            .map((w) => w.getURL())
            .join(' ');
    }, port);

  await open(`https://127.0.0.1:${PORT}/`);
  const asked = await app.evaluate(() => globalThis.__asked);
  check(
    'the site asked, with a certificate on the computer to offer',
    asked.length >= 1 && asked[0].count >= 1,
    JSON.stringify(asked),
  );
  const text = await pageText(PORT);
  check('Firn sends the site no certificate', text === 'certificate: no', text);

  // The control: without Firn's answer, Electron hands it over.
  await app.evaluate(({ app: a }) => {
    a.removeAllListeners('select-client-certificate');
  });
  await open(`https://127.0.0.1:${CONTROL_PORT}/`);
  const control = await pageText(CONTROL_PORT);
  check(
    "control: without Firn's answer the certificate would go out",
    control === 'certificate: yes',
    control,
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
  servers.forEach((s) => s.kill());
  removeClientCert();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  removeClientCert();
  process.exit(1);
});
