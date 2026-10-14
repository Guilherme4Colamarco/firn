# Firn's security plan

Firn is a browser: people trust it with their passwords, history, and everything they read. This is the fuller plan behind the "Security" rules in `CLAUDE.md`. Statuses are filled in by an audit against the real code; "unknown, check" means nobody has looked yet, not that it's fine.

Last audit: 14 Oct 2026 (the first one, against Electron 44.7.0). Findings are numbered (F1, F2, …) as reported in that session; "fixed" replaces a finding's number once it's done.

## 1. Electron hardening checklist

| Item | Status | Where / notes |
|---|---|---|
| `contextIsolation: true` for every web page and Firn's own UI | in place | `SAFE_WEB_PREFERENCES` (src/engine/electron.ts), `UI_WEB_PREFERENCES` (src/main.ts); popups get the same |
| `sandbox: true` for every web page | in place | same places |
| `nodeIntegration` off for every web page | in place | same places |
| `webSecurity` never disabled | in place | never set anywhere |
| No `allowRunningInsecureContent` | in place | never set anywhere |
| No remote module | in place | removed from Electron itself (v14) |
| Fuse: RunAsNode off | in place | forge.config.mts |
| Fuse: NODE_OPTIONS and inspect arguments off | in place | forge.config.mts |
| Fuse: cookie encryption on | in place | forge.config.mts |
| Fuse: ASAR integrity on | in place | forge.config.mts |
| Fuse: OnlyLoadAppFromAsar on | in place | forge.config.mts |
| Fuse: GrantFileProtocolExtraPrivileges off | **missing (F1, high)** | not set, so on: a local web page can read other local files. Firn's UI loads from `file://` and needs it until the UI moves to its own protocol |
| `will-navigate` restricted (Firn's own UI never navigates away) | in place | `lockUi` (src/main.ts) |
| `setWindowOpenHandler` restricted (no new windows; only http/https become tabs) | partly (F2, F3) | UI: denied. Pages: only http/https become tabs, but sized popups open as real windows with no address shown, and nothing requires a click first |
| Permission request and check handlers deny by default | in place | src/engine/electron.ts; unknown kinds and Lookout/popups refused. Gaps: client certificates (F4), device pickers (F5), answers keyed on the frame's site (F7) |
| Every IPC handler checks its sender (right window or frame) and the message's shape | in place | UI: `uiContents.includes(event.sender)` + type checks (src/main.ts); page helper: top frame of a Firn page, site from the frame's real address |
| Content Security Policy on Firn's own UI pages | missing (F10, low) | index.html has none |
| Certificate errors never silently accepted | in place | no `certificate-error` handler, so Electron refuses them |
| `<webview>` tag not used | in place | `webviewTag` never turned on |

## 2. Browser-specific risks to review

Each one: what could go wrong, and whether Firn handles it.

- **Address bar spoofing:** the address shown always matches the page actually loaded, including during slow loads, failed loads, redirects, and `javascript:`/`data:` addresses.
  *Status: in place for tabs, Lookout, and split view* (the address comes from the page's committed address, `getURL()`, refreshed on `did-navigate`; typed `javascript:` becomes a search). Popup windows show no address at all (F3). A hand test of a hanging cross-site navigation would confirm.
- **Popups and `window.open` abuse:** a page can't flood tabs, open windows, or open one without a click.
  *Status: missing (F2).* Electron has no popup blocker; no click is required.
- **Downloads:** dangerous file types, filename tricks (right-to-left characters, double extensions, very long names, path parts), and where files land.
  *Status: partly (F9).* Names are cleaned of Windows' forbidden characters and land in Downloads; right-to-left characters are kept, and a page can start many downloads with no click. Mark of the Web on Windows: check by hand (a downloaded .exe's Properties should say it came from another computer).
- **Permission prompts:** camera, microphone, location, notifications, and clipboard. The prompt names the real site, and one site's answer never applies to another.
  *Status: partly (F7, F8).* Only tabs ask; answers are per site. But the site is the asking frame's, not the tab's, and "open in another app" can be allowed for any kind of link.
- **Links from other apps:** the command line (Windows) and `open-url`/`open-file` (Mac). Only http, https, and existing local web files get through, and nothing can pass as a Chromium setting.
  *Status: in place.* src/defaultBrowser.ts (`linksFromArguments`, `--` before `%1`), `open-url`/`open-file` in src/main.ts.
- **Lookout and split view:** they never show one site's address over another site's page.
  *Status: in place* (same committed-address source as tabs).
- **The password fill path:** `src/page-preload.ts` and the main process's checks (top frame only, the real address, https or this computer, a real click first).
  *Status: in place.* Top frame and real address checked in the main process (`senderOrigin`); the click check is in the page helper (trusted events only). Popups get no fills.
- **Safe Browsing and ad blocking:** a fault in either fails safely and never leaks visited addresses.
  *Status: in place.* Both fail open by design (a page loads if the check breaks); their logs carry no addresses. One debug printout does (F11).
- **`file:` and other local addresses:** what a local page can reach.
  *Status: missing (F1, high).*
- **The PDF viewer.**
  *Status: in place.* Chromium's own viewer (`plugins: true` only turns that on), in the same sandbox.

## 3. Supply chain and build

- **Dependencies, and why each is there:**
  - Runtime:
    - `@ghostery/adblocker`: ad and tracker blocking (pinned exact).
    - `react` and `react-dom`: Firn's own interface (version ranges, not exact; low, pin them, F14).
  - `npm audit --omit=dev`: 0 (14 Oct 2026).
  - Build and dev only (never shipped as code):
    - Electron and Electron Forge with its makers and plugins: builds and packages Firn.
    - `@electron/fuses`: switches off unsafe Electron features in the built app.
    - Vite and its React plugin: build Firn's interface.
    - TypeScript.
    - oxlint and oxfmt: lint and formatting.
- **GitHub Actions** (.github/workflows/build.yml):
  - Secrets are never printed. *In place.*
  - Actions are pinned to exact versions. *Missing (F12, low):* pinned to major tags (`@v5`); the Azure signing add-on and Apple's certificate are downloaded without a checksum.
  - Each workflow has the least permissions it needs. *Mostly:* `contents: read` by default; the Mac build gets `id-token: write` it doesn't need.
  - Signing secrets sit behind the `windows-signing` environment. *Partly (F6, medium):* every push to any branch runs in that environment, and the Mac secrets are repository-wide. Whether the environment limits branches is a GitHub setting to check.
- **Releases stay signed:** Windows signing (Azure Artifact Signing) and Mac signing and notarization are required. A release without them must fail, never fall back. *In place:* a release fails without the secrets, and the build verifies both signatures and notarization.
- **The Safe Browsing key** ships inside every copy of Firn, so assume anyone can read it. It must be restricted in Google's console to the Safe Browsing API only. *Can't be checked from the code:* David to confirm in Google Cloud (APIs & Services > Credentials > the key > API restrictions).

## 4. Review routine

- **Every Electron update:** recheck the checklist items it could change (fuses, defaults, the permission and window-open handlers), and run `npm audit --omit=dev` (stays at 0).
- **Every few releases:** a security-only look back, done by Opus, against this plan and the code.
  - Report findings in order of severity (high, medium, low), each with where it is and a suggested small fix.
  - Then fix them one at a time, each with a check.
  - Update the statuses and "Last audit" above.

## 5. Open findings (audit of 14 Oct 2026)

High:
- **F1** Local web pages can read other local files: the `GrantFileProtocolExtraPrivileges` fuse is on (forge.config.mts). Fix: serve Firn's UI from its own protocol instead of `file://`, then switch the fuse off; a check that a `file://` page can't fetch another file.

Medium:
- **F2** Pages can open tabs and popups without a click (`setWindowOpenHandler`, src/engine/electron.ts). Fix: only within a moment of a real press or key in that page.
- **F3** Popup windows show no address (same place). Fix: the window title always starts with the site's host, and the page can't change that part.
- **F4** Client certificates go to any site that asks (no `select-client-certificate` handler; Electron picks the first). Fix: send none.
- **F5** Device pickers (Bluetooth, USB, serial, HID) have no handlers; Electron's default may pick a Bluetooth device without asking. Fix: refuse them all.
- **F6** Signing runs on every branch push (build.yml). Fix: sign only on main and releases, and limit the `windows-signing` environment to those.

Low:
- **F7** Permission answers are stored for the asking frame's site, not the tab's (src/engine/electron.ts, src/main.ts).
- **F8** "Open in another app" can be allowed for schemes abused on Windows (ms-msdt, search-ms, ms-officecmd, …).
- **F9** Downloads keep right-to-left characters in names, and a page can start many downloads without a click (src/downloads.ts).
- **F10** No Content Security Policy on Firn's UI (index.html).
- **F11** Ctrl+Shift+D diagnostics print page addresses (src/main.ts, `printDiagnostics`).
- **F12** Actions pinned to major tags; downloads in the build not checksum-checked.
- **F13** Saved passwords can be shown in Settings without the computer's password.
- **F14** `react` and `react-dom` aren't pinned exactly.
