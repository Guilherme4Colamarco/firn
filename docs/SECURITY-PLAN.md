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
| Fuse: GrantFileProtocolExtraPrivileges off | in place (was F1, fixed 14 Oct 2026) | forge.config.mts; Firn's UI loads from `firn://app` in its own session (`serveUi`, src/main.ts), so web pages can't reach it; the `fileaccess` check |
| `will-navigate` restricted (Firn's own UI never navigates away) | in place | `lockUi` (src/main.ts) |
| `setWindowOpenHandler` restricted (no new windows; only http/https become tabs) | yes (F2 and F3 fixed 14 Oct 2026) | UI: denied. Pages: only http/https become tabs, and only right after a real press or key (`guardWindowOpens`, src/engine/electron.ts; the `popups` check), sized popups open as real windows whose title starts with the real site (`showPopupSite`) |
| Permission request and check handlers deny by default | in place | src/engine/electron.ts; unknown kinds and Lookout/popups refused. Client certificates: none sent (F4 fixed 15 Oct 2026, `select-client-certificate` in src/main.ts; the `clientcert` check). Device pickers (Bluetooth, USB, serial, HID): all refused (F5 fixed 15 Oct 2026, src/main.ts; the `devices` check). Answers keyed on the tab's site, also for a frame from another site (F7 fixed 15 Oct 2026, `topOrigin` in src/engine/electron.ts; the `perm` check) |
| Every IPC handler checks its sender (right window or frame) and the message's shape | in place | UI: `uiContents.includes(event.sender)` + type checks (src/main.ts); page helper: top frame of a Firn page, site from the frame's real address |
| Content Security Policy on Firn's own UI pages | in place (was F10, fixed 15 Oct 2026) | sent with every `firn://app` file (`UI_CSP` in `serveUi`, src/main.ts): only Firn's own scripts, styles, and fonts; images also from sites (favicons) and data:. Not on Vite's dev server (it needs inline scripts); the `csp` check packages Firn and tests the real build |
| Certificate errors never silently accepted | in place | no `certificate-error` handler, so Electron refuses them |
| `<webview>` tag not used | in place | `webviewTag` never turned on |

## 2. Browser-specific risks to review

Each one: what could go wrong, and whether Firn handles it.

- **Address bar spoofing:** the address shown always matches the page actually loaded, including during slow loads, failed loads, redirects, and `javascript:`/`data:` addresses.
  *Status: in place for tabs, Lookout, and split view* (the address comes from the page's committed address, `getURL()`, refreshed on `did-navigate`; typed `javascript:` becomes a search). Popup windows have no address bar; their title starts with the committed address's host, which the page can't change (F3). A hand test of a hanging cross-site navigation would confirm.
- **Popups and `window.open` abuse:** a page can't flood tabs, open windows, or open one without a click.
  *Status: in place* (F2 fixed): Electron has no popup blocker, so Firn's own (`guardWindowOpens`, src/engine/electron.ts): tabs, Lookout, and popups open only within 5 seconds of a real press or key in that page, one per press, as Chrome does; popups follow the same rule.
- **Downloads:** dangerous file types, filename tricks (right-to-left characters, double extensions, very long names, path parts), and where files land.
  *Status: in place* (F9 fixed): names are cleaned (Windows' forbidden characters, direction marks, runs of spaces, trailing dots and spaces, over-long names) and land in Downloads; a page starts one download on its own, then one per real press, as Chrome does. Mark of the Web on Windows: in place (David checked, 14 Oct 2026: a downloaded .exe's Properties says it came from another computer).
- **Permission prompts:** camera, microphone, location, notifications, and clipboard. The prompt names the real site, and one site's answer never applies to another.
  *Status: in place (F7, F8).* Only tabs ask; answers are per site, the tab's (what the address bar shows), also when a frame from another site asks; notifications from another site's frame are refused. "Open in another app" is never offered for Windows tools abused from web pages (`REFUSED_SCHEMES` in src/engine/electron.ts).
- **Links from other apps:** the command line (Windows) and `open-url`/`open-file` (Mac). Only http, https, and existing local web files get through, and nothing can pass as a Chromium setting.
  *Status: in place.* src/defaultBrowser.ts (`linksFromArguments`, `--` before `%1`), `open-url`/`open-file` in src/main.ts.
- **Lookout and split view:** they never show one site's address over another site's page.
  *Status: in place* (same committed-address source as tabs).
- **The password fill path:** `src/page-preload.ts` and the main process's checks (top frame only, the real address, https or this computer, a real click first).
  *Status: in place.* Top frame and real address checked in the main process (`senderOrigin`); the click check is in the page helper (trusted events only). Popups get no fills.
- **Safe Browsing and ad blocking:** a fault in either fails safely and never leaks visited addresses.
  *Status: in place.* Both fail open by design (a page loads if the check breaks); their logs carry no addresses. One debug printout does (F11).
- **`file:` and other local addresses:** what a local page can reach.
  *Status: in place* (F1 fixed): Chrome's limits, no reading other local files; Firn's UI files (`firn://app`) are out of pages' reach.
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
  - Signing secrets sit behind the `windows-signing` environment. *In place (F6, 15 Oct 2026):* only main and releases run in that environment and see the Mac secrets; other branches build unsigned. GitHub setting to keep: the environment allows only `main` and `v*` tags (David sets it; optionally the Mac secrets move into it).
- **Releases stay signed:** Windows signing (Azure Artifact Signing) and Mac signing and notarization are required. A release without them must fail, never fall back. *In place:* a release fails without the secrets, and the build verifies both signatures and notarization.
- **The Safe Browsing key** ships inside every copy of Firn, so assume anyone can read it. It must be restricted in Google's console to the Safe Browsing API only. *In place* (David checked, 14 Oct 2026): restricted to the Safe Browsing API. No application restriction, rightly: Google's choices (websites, IP addresses, Android, iOS) don't fit a desktop app.

## 4. Review routine

- **Every Electron update:** recheck the checklist items it could change (fuses, defaults, the permission and window-open handlers), and run `npm audit --omit=dev` (stays at 0).
- **Every few releases:** a security-only look back, done by Opus, against this plan and the code.
  - Report findings in order of severity (high, medium, low), each with where it is and a suggested small fix.
  - Then fix them one at a time, each with a check.
  - Update the statuses and "Last audit" above.

## 5. Open findings (audit of 14 Oct 2026)

High:
- **F1** fixed (14 Oct 2026): local web pages could read other local files. The fuse is off, and Firn's UI loads from `firn://app` in its own session.

Medium:
- **F2** fixed (14 Oct 2026): pages could open tabs and popups without a click. Now only within 5 seconds of a real press or key in that page, one per press.
- **F3** fixed (14 Oct 2026): popup windows showed no address. Now the window title always starts with the real site's host (from the committed address), and the page's title only comes after it.
- **F4** fixed (15 Oct 2026): client certificates went to any site that asked (Electron picked the first). Now no site gets one.
- **F5** fixed (15 Oct 2026): device pickers (Bluetooth, USB, serial, HID) had no handlers. Now every one is refused and no device is ever allowed.
- **F6** fixed (15 Oct 2026): signing ran on every branch push. Now only main and releases sign; other branches build unsigned, outside `windows-signing`, without the signing secrets.

Low:
- **F7** fixed (15 Oct 2026): permission questions named, and answers were stored for, the asking frame's site, not the tab's. Now both use the tab's site (as Chrome does); notifications from another site's frame are refused.
- **F8** fixed (15 Oct 2026): "open in another app" could be allowed for kinds of link abused on Windows (ms-msdt, search-ms, ms-officecmd, …). Now those, and the old scripting and help-file kinds Chrome also refuses, are refused without asking; other apps' links still ask.
- **F9** fixed (15 Oct 2026): downloads kept right-to-left characters in names, and a page could start many downloads without a click. Now names are cleaned (`cleanName`, src/downloads.ts) and a page gets one download on its own, then one per press (`mayDownload`, src/engine/electron.ts).
- **F10** fixed (15 Oct 2026): Firn's UI had no Content Security Policy. Now the built UI is sent with a strict one: only its own scripts, styles, and fonts, so nothing injected into the UI can run.
- **F11** Ctrl+Shift+D diagnostics print page addresses (src/main.ts, `printDiagnostics`).
- **F12** Actions pinned to major tags; downloads in the build not checksum-checked.
- **F13** Saved passwords can be shown in Settings without the computer's password.
- **F14** `react` and `react-dom` aren't pinned exactly.
