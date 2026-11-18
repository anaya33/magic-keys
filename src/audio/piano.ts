/**
 * PianoEngine — the sampled grand piano.
 *
 * Sound source: the Salamander Grand Piano (Yamaha C5, CC-BY 3.0), sampled every
 * minor third from A0 to C8. Tone.js' Sampler repitches the nearest sample for
 * the notes in between, so 30 small files cover all 88 keys.
 *
 * Why it doesn't sound like a synth:
 *  - Real recorded piano samples with their natural decay (no oscillators).
 *  - "Velocity layers": a real piano gets brighter, not only louder, when you hit
 *    it harder. The free Salamander set has one recorded layer, so we build two
 *    from it (a mellow voice through a gentle low-pass filter and a bright,
 *    unfiltered voice) and blend them by velocity.
 *  - A natural release, a real sustain pedal, and a touch of room reverb.
 *
 * Instant first note, no loading screen (the "already in the queue" trick):
 *  - `preload()` runs as soon as the page opens. It downloads the 30 samples,
 *    decodes them and builds the whole piano: samplers, filter and reverb.
 *    The browser lets us do all of that in a *paused* audio engine without asking.
 *  - The only thing a browser forbids before the player interacts is making sound.
 *    So the first click, tap or key press calls `unlock()`, which just un-pauses
 *    the engine. That takes a few milliseconds, so the first note plays right away.
 *  - On the rare chance someone presses a key before preloading finishes, the note
 *    waits in a queue and plays the moment the piano is ready. Nothing is shown.
 *
 * Staying light on the computer:
 *  - At most MAX_RINGING notes ring at once; the oldest pedalled note is let go
 *    first, so mashing keys with the pedal down can never pile up hundreds of voices.
 */
import type * as ToneLib from 'tone';
import { toneName } from '../music/notes';
import { preferPlaybackAudio } from './session';

type Tone = typeof ToneLib;

const MAX_RINGING = 48;

/** Sample files in /public/samples, one per minor third (A0, C1, Ds1, Fs1, A1 …). */
function sampleFiles(): string[] {
  const names = ['A0'];
  for (let octave = 1; octave <= 7; octave++) names.push(`C${octave}`, `Ds${octave}`, `Fs${octave}`, `A${octave}`);
  names.push('C8');
  return names;
}

/** Fetch every sample file. Keys are Tone.js note names ("Ds4" file -> "D#4"). */
async function downloadSamples(): Promise<Record<string, ArrayBuffer>> {
  const entries = await Promise.all(
    sampleFiles().map(async (file) => {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${file}.mp3`);
      if (!res.ok) throw new Error(`Could not load piano sample ${file}`);
      return [file.replace('s', '#'), await res.arrayBuffer()] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** Perceptual loudness curve: soft touches stay audible, hard hits get loud. */
function velocityToGain(velocity: number): number {
  const v = Math.min(1, Math.max(0, velocity));
  return 0.12 + 0.88 * Math.pow(v, 1.6);
}

export class PianoEngine {
  private tone: Tone | null = null;
  private soft: ToneLib.Sampler | null = null;
  private bright: ToneLib.Sampler | null = null;

  private preloading: Promise<void> | null = null;
  /** Notes pressed before the piano was ready: midi → velocity. */
  private pending = new Map<number, number>();

  /** How many inputs (mouse, keys, MIDI, magic fingers…) are holding each note down. */
  private holdCount = new Map<number, number>();
  /** Notes released while the pedal was down; they ring until pedal-up. */
  private pedalled = new Set<number>();
  /** Every note currently sounding, oldest first (Map keeps insertion order). */
  private ringing = new Map<number, true>();
  private sustainOn = false;

  get ready(): boolean {
    return this.soft !== null;
  }

  /** Build the whole piano in the background. Call on page load; safe to call again. */
  preload(): Promise<void> {
    this.preloading ??= this.build().catch((err) => {
      this.preloading = null; // allow a retry later
      throw err;
    });
    return this.preloading;
  }

  /**
   * Allow sound. Call from inside a user gesture (click, tap or key press).
   * If the piano is already built, this only un-pauses the audio engine.
   */
  unlock(): void {
    preferPlaybackAudio(); // phones: play through the silent switch (see audio/session.ts)
    if (this.tone) {
      // Also wakes the engine after an interruption (a call, the app in the background).
      if (this.tone.getContext().state !== 'running') void this.tone.start();
    } else void this.preload().then(() => this.tone?.start()).catch((err) => console.warn(err));
  }

  private async build(): Promise<void> {
    // Keep the console clean: Tone.js prints a banner on import unless told not to.
    (window as unknown as { TONE_SILENCE_LOGGING: boolean }).TONE_SILENCE_LOGGING = true;

    // Download the audio library and the samples at the same time.
    const [Tone, raw] = await Promise.all([import('tone'), downloadSamples()]);
    this.tone = Tone;
    const context = Tone.getContext(); // created paused; un-paused later by unlock()
    context.lookAhead = 0.02; // tight timing for scheduled notes, no lag for live ones

    const buffers: Record<string, AudioBuffer> = {};
    await Promise.all(
      Object.entries(raw).map(async ([note, data]) => {
        buffers[note] = await context.decodeAudioData(data);
      }),
    );

    // Output chain: both voices -> room reverb -> gentle limiter -> speakers.
    const limiter = new Tone.Limiter(-1).toDestination();
    const reverb = new Tone.Reverb({ decay: 2.4, preDelay: 0.012, wet: 0.16 }).connect(limiter);
    await reverb.ready;
    const mellow = new Tone.Filter({ type: 'lowpass', frequency: 1600, rolloff: -12, Q: 0.3 }).connect(reverb);

    const options = { urls: buffers, release: 1.1, curve: 'exponential' as const };
    this.soft = new Tone.Sampler(options).connect(mellow);
    this.bright = new Tone.Sampler(options).connect(reverb);
    this.soft.volume.value = -4;
    this.bright.volume.value = -4;

    // Play anything that was pressed while we were getting ready.
    for (const [midi, velocity] of this.pending) this.strike(midi, velocity);
    this.pending.clear();
  }

  /** Current audio clock time, for scheduling notes ahead (used by Autoplay). */
  now(): number {
    return this.tone ? this.tone.now() : 0;
  }

  /** Press a key. `velocity` is 0..1. `time` (audio-clock seconds) schedules it ahead. */
  noteOn(midi: number, velocity = 0.7, time?: number): void {
    this.holdCount.set(midi, (this.holdCount.get(midi) ?? 0) + 1);
    this.pedalled.delete(midi);
    if (!this.ready) {
      this.pending.set(midi, velocity); // queued: plays the moment the piano is ready
      void this.preload().catch((err) => console.warn(err));
      return;
    }
    this.strike(midi, velocity, time);
  }

  /** Let go of a key. With the pedal down the note keeps ringing until pedal-up. */
  noteOff(midi: number, time?: number): void {
    const count = (this.holdCount.get(midi) ?? 0) - 1;
    if (count > 0) {
      this.holdCount.set(midi, count);
      return; // another input is still holding this key
    }
    this.holdCount.delete(midi);
    if (this.sustainOn) this.pedalled.add(midi);
    else this.release(midi, time);
  }

  /** Sustain pedal (spacebar / MIDI CC64). Lifting it releases everything not held. */
  setSustain(down: boolean): void {
    this.sustainOn = down;
    if (down) return;
    for (const midi of this.pedalled) if (!this.holdCount.has(midi)) this.release(midi);
    this.pedalled.clear();
  }

  /** Silence everything (used when leaving a song or stopping Autoplay). */
  allNotesOff(): void {
    this.holdCount.clear();
    this.pedalled.clear();
    this.pending.clear();
    this.ringing.clear();
    this.soft?.releaseAll();
    this.bright?.releaseAll();
  }

  private strike(midi: number, velocity: number, time?: number): void {
    if (!this.soft || !this.bright) return;
    this.ringing.delete(midi);
    this.ringing.set(midi, true);
    this.enforceVoiceLimit();

    const note = toneName(midi);
    const gain = velocityToGain(velocity);
    const brightness = Math.pow(Math.min(1, Math.max(0, velocity)), 1.3); // 0 mellow … 1 brilliant
    this.soft.triggerAttack(note, time, gain * (1 - brightness * 0.85));
    this.bright.triggerAttack(note, time, gain * brightness);
  }

  /** Too many notes ringing? Let go of the oldest ones nobody is holding. */
  private enforceVoiceLimit(): void {
    for (const midi of this.ringing.keys()) {
      if (this.ringing.size <= MAX_RINGING) break;
      if (this.holdCount.has(midi)) continue;
      this.pedalled.delete(midi);
      this.release(midi);
    }
  }

  private release(midi: number, time?: number): void {
    this.pending.delete(midi);
    this.ringing.delete(midi);
    const note = toneName(midi);
    this.soft?.triggerRelease(note, time);
    this.bright?.triggerRelease(note, time);
  }
}

/** One shared piano for the whole app. */
export const piano = new PianoEngine();
