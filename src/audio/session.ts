/**
 * Making sure phones actually play the piano.
 *
 * iPhone (Safari): web audio normally runs in iOS's "ambient" mode, which mixes with
 * Spotify/YouTube but is silenced by the Ring/Silent switch. iOS 17+ lets a page ask
 * for "playback" mode (navigator.audioSession.type), which plays through the silent
 * switch. iOS doesn't offer the web both at once: in playback mode other apps' music
 * pauses while the piano plays. We choose playback, so the piano is always heard.
 * Older iPhones get the long-standing fallback: a silent looping <audio> element
 * started in a tap switches the page to the same playback mode.
 *
 * Android (Chrome): the ringer doesn't affect web audio (it uses media volume), and
 * Web Audio doesn't take "audio focus", so it already mixes with other apps. The audio
 * engine can be interrupted (a phone call, the tab in the background); we resume it
 * on the next tap.
 */

interface AudioSessionLike {
  type: string;
}

function audioSession(): AudioSessionLike | undefined {
  return (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
}

/** iPhone / iPad (iPadOS reports itself as a Mac with a touch screen). */
function isAppleMobile(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

let silentLoop: HTMLAudioElement | null = null;

/**
 * Ask for "playback" audio, so the piano plays even with the silent switch on.
 * Must run inside a tap or key press (the fallback starts an <audio> element).
 */
export function preferPlaybackAudio(): void {
  const session = audioSession();
  if (session) {
    try {
      if (session.type !== 'playback') session.type = 'playback';
    } catch {
      /* not allowed right now: harmless */
    }
    return;
  }
  if (!isAppleMobile() || silentLoop) return;
  // Older iOS: a looping, silent media element moves the page into playback mode.
  silentLoop = document.createElement('audio');
  silentLoop.setAttribute('playsinline', '');
  silentLoop.loop = true;
  silentLoop.src = SILENT_WAV;
  void silentLoop.play().catch(() => {
    silentLoop = null; // try again on the next tap
  });
}

/** 0.1 s of silence as a tiny WAV, so nothing needs downloading. */
const SILENT_WAV = (() => {
  const sampleRate = 8000;
  const samples = 800;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8-bit
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence is the middle value
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(binary)}`;
})();
