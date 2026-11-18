/**
 * Microphone permission, handled the way meeting apps do it.
 *
 * A website can't make the browser's permission pop-up appear on its own terms, and
 * once someone has blocked a site the browser never asks again. So we:
 *   1. check the current state first (Permissions API),
 *   2. if the browser hasn't decided yet, explain why we need the mic and then ask
 *      (that request is what shows the browser's own "Allow / Block" pop-up),
 *   3. if it's blocked, show the exact steps to allow it for *this* browser and device,
 *   4. watch the permission and carry on by itself the moment it's allowed.
 */

export type MicState = 'granted' | 'prompt' | 'denied' | 'unknown';

/** What the browser currently says about the microphone for this site. */
export async function micState(): Promise<MicState> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state as MicState;
  } catch {
    return 'unknown'; // some browsers can't tell us; we'll just ask
  }
}

/** Call `onChange` whenever the microphone permission changes (e.g. switched to Allow). */
export async function watchMic(onChange: (state: MicState) => void): Promise<() => void> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    const handler = () => onChange(status.state as MicState);
    status.addEventListener('change', handler);
    return () => status.removeEventListener('change', handler);
  } catch {
    return () => {};
  }
}

export type OS = 'mac' | 'windows' | 'linux' | 'chromeos' | 'ios' | 'android';
type Browser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

/** Which operating system this is (Fedora, Ubuntu etc. all report as Linux). */
export function detectOS(): OS {
  const ua = navigator.userAgent;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/CrOS/.test(ua) || /Chrome OS/i.test(platform)) return 'chromeos';
  if (/Win/.test(platform) || /Windows/.test(ua)) return 'windows';
  if (/Mac/.test(platform) || /Macintosh/.test(ua)) return 'mac';
  return 'linux';
}

function detectBrowser(): Browser {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\/|FxiOS/.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

const BROWSER_NAME: Record<Browser, string> = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', other: 'your browser' };

/** The few steps to allow the microphone, for this browser on this system. */
export function howToAllowMic(): { title: string; steps: string[] } {
  const os = detectOS();
  const browser = detectBrowser();
  const name = BROWSER_NAME[browser];

  if (os === 'ios') {
    return {
      title: name === 'your browser' ? 'iPhone' : `${name} on iPhone`,
      steps: ['Tap "aA" in the address bar → Website Settings → Microphone → Allow.', `Or: Settings app → ${browser === 'chrome' ? 'Chrome' : 'Safari'} → Microphone → Allow.`],
    };
  }
  if (os === 'android') {
    return {
      title: `${name} on Android`,
      steps: ['Tap the icon left of the address bar → Permissions → Microphone → Allow.', `Or: Settings → Apps → ${name === 'your browser' ? 'your browser' : name} → Permissions → Microphone → Allow.`],
    };
  }

  const inBrowser =
    browser === 'safari'
      ? 'Safari menu → Settings for This Website → Microphone → Allow.'
      : browser === 'firefox'
        ? 'Click the microphone icon in the address bar → clear "Blocked".'
        : 'Click the icon left of the address bar → Microphone → Allow.';
  const inSystem: Record<OS, string> = {
    mac: `Mac: System Settings → Privacy & Security → Microphone → turn on ${name}.`,
    windows: 'Windows: Settings → Privacy & security → Microphone → turn on access for apps and desktop apps.',
    chromeos: 'ChromeOS: Settings → Privacy and security → Privacy controls → Microphone access on.',
    linux: 'Linux: Settings → Sound → Input: pick your microphone and check it isn\'t muted.',
    ios: '',
    android: '',
  };
  const osName: Record<OS, string> = { mac: 'Mac', windows: 'Windows', chromeos: 'ChromeOS', linux: 'Linux', ios: 'iPhone', android: 'Android' };
  return { title: `${name[0].toUpperCase()}${name.slice(1)} on ${osName[os]}`, steps: [inBrowser, inSystem[os]] };
}
