# Firn's security plan

Firn is a browser: people trust it with their passwords, history, and everything they read. This is the fuller plan behind the "Security" rules in `CLAUDE.md`. Statuses are filled in by an audit against the real code; "unknown, check" means nobody has looked yet, not that it's fine.

Last audit: none yet (statuses below are from before the first one).

## 1. Electron hardening checklist

| Item | Status | Where / notes |
|---|---|---|
| `contextIsolation: true` for every web page and Firn's own UI | unknown, check | |
| `sandbox: true` for every web page | unknown, check | |
| `nodeIntegration` off for every web page | unknown, check | |
| `webSecurity` never disabled | unknown, check | |
| No `allowRunningInsecureContent` | unknown, check | |
| No remote module | unknown, check | |
| Fuse: RunAsNode off | unknown, check | `@electron-forge/plugin-fuses` is a dev dependency |
| Fuse: NODE_OPTIONS and inspect arguments off | unknown, check | |
| Fuse: cookie encryption on | unknown, check | |
| Fuse: ASAR integrity on | unknown, check | |
| Fuse: OnlyLoadAppFromAsar on | unknown, check | |
| `will-navigate` restricted (Firn's own UI never navigates away) | unknown, check | |
| `setWindowOpenHandler` restricted (no new windows; only http/https become tabs) | unknown, check | |
| Permission request and check handlers deny by default | unknown, check | |
| Every IPC handler checks its sender (right window or frame) and the message's shape | unknown, check | |
| Content Security Policy on Firn's own UI pages | unknown, check | |
| Certificate errors never silently accepted | unknown, check | |
| `<webview>` tag not used | unknown, check | |

## 2. Browser-specific risks to review

Each one: what could go wrong, and whether Firn handles it.

- **Address bar spoofing:** the address shown always matches the page actually loaded, including during slow loads, failed loads, redirects, and `javascript:`/`data:` addresses.
- **Popups and `window.open` abuse:** a page can't flood tabs, open windows, or open one without a click.
- **Downloads:** dangerous file types, filename tricks (right-to-left characters, double extensions, very long names, path parts), and where files land.
- **Permission prompts:** camera, microphone, location, notifications, and clipboard. The prompt names the real site, and one site's answer never applies to another.
- **Links from other apps:** the command line (Windows) and `open-url`/`open-file` (Mac). Only http, https, and existing local web files get through, and nothing can pass as a Chromium setting.
- **Lookout and split view:** they never show one site's address over another site's page.
- **The password fill path:** `src/page-preload.ts` and the main process's checks (top frame only, the real address, https or this computer, a real click first).
- **Safe Browsing and ad blocking:** a fault in either fails safely and never leaks visited addresses.
- **`file:` and other local addresses:** what a local page can reach.
- **The PDF viewer.**

## 3. Supply chain and build

- **Dependencies, and why each is there:**
  - Runtime:
    - `@ghostery/adblocker`: ad and tracker blocking (pinned exact).
    - `react` and `react-dom`: Firn's own interface (version ranges, not exact).
  - Build and dev only (never shipped as code):
    - Electron and Electron Forge with its makers and plugins: builds and packages Firn.
    - `@electron/fuses`: switches off unsafe Electron features in the built app.
    - Vite and its React plugin: build Firn's interface.
    - TypeScript.
    - oxlint and oxfmt: lint and formatting.
- **GitHub Actions:**
  - Secrets are never printed.
  - Actions are pinned to exact versions.
  - Each workflow has the least permissions it needs.
  - Signing secrets sit behind the `windows-signing` environment.
- **Releases stay signed:** Windows signing (Azure Artifact Signing) and Mac signing and notarization are required. A release without them must fail, never fall back.
- **The Safe Browsing key** ships inside every copy of Firn, so assume anyone can read it. It must be restricted in Google's console to the Safe Browsing API only.

## 4. Review routine

- **Every Electron update:** recheck the checklist items it could change (fuses, defaults, the permission and window-open handlers), and run `npm audit --omit=dev` (stays at 0).
- **Every few releases:** a security-only look back, done by Opus, against this plan and the code.
  - Report findings in order of severity (high, medium, low), each with where it is and a suggested small fix.
  - Then fix them one at a time, each with a check.
  - Update the statuses and "Last audit" above.
