// "Is it really you?": before Settings shows or copies a saved password,
// the computer's own check asks the person at the keyboard to prove
// they're its owner: Touch ID on a Mac, Windows Hello (PIN, fingerprint, or
// face) on Windows. Where the computer has no such check (a Mac without
// Touch ID, Windows without Hello set up, Linux), passwords aren't shown or
// copied at all; they still fill in on their own sites.
//
// Nothing here is sent anywhere or stored: the system only answers yes or
// no.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { systemPreferences } from 'electron';

export type OwnerCheck = 'yes' | 'no' | 'unavailable';

// Windows Hello, through the PowerShell that comes with Windows (Electron
// has no way to ask it). Two fixed scripts; nothing from outside goes in.
const HELLO_PREAMBLE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait() | Out-Null
  $task.Result
}
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$verifier = [Windows.Security.Credentials.UI.UserConsentVerifier]
$availability = Await ($verifier::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ($availability -ne 'Available') { 'unavailable'; exit }
`;
const HELLO_AVAILABLE = `${HELLO_PREAMBLE}'yes'`;
const HELLO_ASK = `${HELLO_PREAMBLE}
$result = Await ($verifier::RequestVerificationAsync('Firn wants to show your saved password.')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
if ($result -eq 'Verified') { 'yes' } else { 'no' }
`;

const powershell = (script: string, timeout: number): Promise<OwnerCheck> =>
  new Promise((resolve) => {
    // The full path, so a powershell.exe elsewhere on the PATH is never
    // the one run.
    const exe = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    execFile(
      exe,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { timeout, windowsHide: true },
      (_error, stdout) => {
        const answer = String(stdout).trim();
        if (answer === 'yes') resolve('yes');
        else if (answer === 'no') resolve('no');
        // Anything else (Windows too old, the script failing) counts as
        // no check available: refused, never let through.
        else resolve('unavailable');
      },
    );
  });

// For the automated checks only (see src/main.ts): the answer comes from
// the test, in the main process, and each question is counted.
interface TestHook {
  __firnOwnerAnswer?: OwnerCheck;
  __firnOwnerAsks?: number;
}

export class OwnerGate {
  // A "yes" is good for a minute (as in Chrome), or until the Saved
  // passwords sheet closes.
  private unlockedUntil = 0;
  private asking: Promise<OwnerCheck> | null = null;
  // Goes up on every lock, so a "yes" given after the sheet closed
  // unlocks nothing.
  private locks = 0;
  // "Available" is kept; "unavailable" is checked again after a while (the
  // person may set up Windows Hello meanwhile).
  private available: { value: boolean; at: number } | null = null;

  constructor(private test = false) {}

  async canCheck(): Promise<boolean> {
    if (this.test)
      return (globalThis as TestHook).__firnOwnerAnswer !== 'unavailable';
    if (this.available?.value) return true;
    if (this.available && Date.now() - this.available.at < 30_000) return false;
    let value = false;
    if (process.platform === 'darwin')
      value = systemPreferences.canPromptTouchID();
    else if (process.platform === 'win32')
      value = (await powershell(HELLO_AVAILABLE, 15_000)) === 'yes';
    this.available = { value, at: Date.now() };
    return value;
  }

  // True once the person has proved it's them (asking if need be).
  async confirm(): Promise<boolean> {
    if (Date.now() < this.unlockedUntil) return true;
    const locks = this.locks;
    // Several clicks while the question is up share the one question.
    this.asking ??= this.ask().finally(() => {
      this.asking = null;
    });
    const yes = (await this.asking) === 'yes' && locks === this.locks;
    if (yes) this.unlockedUntil = Date.now() + 60_000;
    return yes;
  }

  lock() {
    this.unlockedUntil = 0;
    this.locks++;
  }

  private async ask(): Promise<OwnerCheck> {
    if (!(await this.canCheck())) return 'unavailable';
    if (this.test) {
      const hook = globalThis as TestHook;
      hook.__firnOwnerAsks = (hook.__firnOwnerAsks ?? 0) + 1;
      return hook.__firnOwnerAnswer ?? 'no';
    }
    if (process.platform === 'darwin')
      return systemPreferences.promptTouchID('show your saved password').then(
        () => 'yes' as const,
        () => 'no' as const,
      );
    if (process.platform === 'win32') return powershell(HELLO_ASK, 5 * 60_000);
    return 'unavailable';
  }
}
