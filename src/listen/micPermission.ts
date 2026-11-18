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

/** Step-by-step instructions to allow the microphone, for the browser and device in use. */
export function howToAllowMic(): { title: string; steps: string[] } {
  const ua = navigator.userAgent;
  const iPhone = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const mac = /Macintosh/.test(ua) && !iPhone;
  const edge = /Edg\//.test(ua);
  const firefox = /Firefox\//.test(ua);
  const chrome = /Chrome\//.test(ua) && !edge;
  const safari = /Safari\//.test(ua) && !chrome && !edge && !firefox;

  if (iPhone) {
    return {
      title: 'On your iPhone or iPad',
      steps: [
        'Tap the "aA" (or page) button at the left of the address bar.',
        'Tap "Website Settings", then set Microphone to "Allow" (or "Ask").',
        'If that doesn\'t help: open the Settings app → Safari (or Chrome) → Microphone → "Allow".',
        'Come back and tap Listen.',
      ],
    };
  }
  if (android) {
    return {
      title: 'On your Android phone (Chrome)',
      steps: [
        'Tap the icon at the left of the address bar, then "Permissions".',
        'Turn Microphone on (or tap "Reset permissions").',
        'If Chrome itself is blocked: Settings app → Apps → Chrome → Permissions → Microphone → "Allow".',
        'Come back and tap Listen.',
      ],
    };
  }
  const macTip = mac
    ? ['Still blocked? On the Mac: System Settings → Privacy & Security → Microphone → switch on your browser, then reopen it.']
    : ['Still blocked? Check your computer\'s privacy settings allow this browser to use the microphone.'];
  if (safari) {
    return {
      title: 'In Safari',
      steps: ['In the menu bar choose Safari → Settings for This Website…', 'Set Microphone to "Allow".', ...macTip],
    };
  }
  if (firefox) {
    return {
      title: 'In Firefox',
      steps: ['Click the microphone (or lock) icon at the left of the address bar.', 'Remove the "Blocked" setting for the microphone, then tap Listen again.', ...macTip],
    };
  }
  return {
    title: edge ? 'In Edge' : 'In Chrome',
    steps: [
      'Click the icon at the left of the address bar (it looks like two sliders or a lock).',
      'Switch Microphone to "Allow" (or click "Reset permission").',
      ...macTip,
    ],
  };
}
