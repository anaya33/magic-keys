/**
 * Microphone recorder for Listen mode.
 *
 *  - Captures raw audio (every sample, through an AudioWorklet), so we know exactly
 *    when each sound happened. That's what lets the optional click track line up
 *    perfectly with what you sang.
 *  - While recording it reports loudness and, for singing, the live pitch: the note
 *    you're singing right now and how many cents sharp or flat you are.
 *  - Optional click track: four count-in clicks, then a click on every beat (the first
 *    beat of each bar higher). Headphones keep the clicks out of the recording.
 *
 * The browser's voice processing (echo cancellation, noise suppression, auto gain) is
 * switched off: it is tuned for speech and smears musical notes.
 */
import { doneRecordingAudio, preferRecordingAudio } from '../audio/session';
import type { KnownBeat } from './rhythm';
import { pitchCandidates, rms } from './pitch';

/** The longest recording we accept, in seconds (keeps analysis quick). */
export const MAX_SECONDS = 60;
const COUNT_IN = 4;

/** The browser (or the computer) refused the microphone. The panel shows how to allow it. */
export class MicBlockedError extends Error {
  constructor() {
    super('The microphone is blocked for this site.');
  }
}

export interface Recording {
  samples: Float32Array;
  sampleRate: number;
  /** When recorded with the click track: its exact tempo and where beat 1 fell. */
  beat?: KnownBeat;
}

/** Runs on the audio thread: forwards every block of microphone samples. */
const CAPTURE_WORKLET = `
class MagicKeysCapture extends AudioWorkletProcessor {
  constructor() { super(); this.started = false; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      if (!this.started) { this.started = true; this.port.postMessage({ start: currentFrame }); }
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor('magic-keys-capture', MagicKeysCapture);`;

export class Recorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private chunks: Float32Array[] = [];
  private startFrame = 0;
  private frame = 0;
  private stopTimer = 0;
  private clickTimer = 0;
  private countTimers: number[] = [];
  private beat: KnownBeat | undefined;
  private livePitches: number[] = [];

  /** Loudness, 0..1, about 30 times a second. */
  onLevel: (level: number) => void = () => {};
  /** Live sung note (fractional MIDI) or null when nothing clear is heard. */
  onLivePitch: (midi: number | null) => void = () => {};
  /** Count-in: 4, 3, 2, 1, then 0 when recording for real. */
  onCountIn: (n: number) => void = () => {};
  /** Called if recording stops on its own (the time limit). */
  onAutoStop: () => void = () => {};

  /** Ask for the microphone and start. Throws a friendly error if it's not possible. */
  async start(options: { clickBpm: number | null; livePitch: boolean }): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot record audio. Try Chrome, Edge, Firefox or Safari.');
    }
    preferRecordingAudio(); // iPhone: the microphone is only allowed in this audio mode
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      doneRecordingAudio();
      const name = err instanceof DOMException ? err.name : '';
      // NotReadableError: the system (e.g. macOS privacy settings) or another app has it.
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotReadableError') throw new MicBlockedError();
      if (name === 'NotFoundError') throw new Error('No microphone was found.');
      throw new Error('The microphone could not be started.');
    }

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.resume();
    const source = ctx.createMediaStreamSource(this.stream);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    silent.connect(ctx.destination);
    this.chunks = [];
    await this.startCapture(ctx, source, silent);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    this.startMeter(analyser, options.livePitch);

    this.beat = undefined;
    if (options.clickBpm) this.startClick(ctx, options.clickBpm);
    else this.onCountIn(0);
    this.stopTimer = window.setTimeout(() => this.onAutoStop(), MAX_SECONDS * 1000);
  }

  /** Stop and return the recording. */
  async stop(): Promise<Recording> {
    const ctx = this.ctx;
    if (!ctx) throw new Error('Nothing is being recorded.');
    const sampleRate = ctx.sampleRate;
    this.release();
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(length);
    let at = 0;
    for (const c of this.chunks) {
      samples.set(c, at);
      at += c.length;
    }
    this.chunks = [];
    return { samples, sampleRate, beat: this.beat };
  }

  /** Stop without keeping anything (closing the panel mid-recording). */
  cancel(): void {
    this.release();
    this.chunks = [];
  }

  /** AudioWorklet capture (sample-exact), with an older fallback for old browsers. */
  private async startCapture(ctx: AudioContext, source: MediaStreamAudioSourceNode, sink: AudioNode): Promise<void> {
    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(ctx, 'magic-keys-capture');
        node.port.onmessage = (e) => {
          if (e.data && typeof e.data.start === 'number') this.startFrame = e.data.start;
          else this.chunks.push(e.data as Float32Array);
        };
        source.connect(node).connect(sink);
        return;
      } catch {
        /* fall through to the fallback */
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    let first = true;
    processor.onaudioprocess = (e) => {
      if (first) {
        first = false;
        this.startFrame = Math.round((e.playbackTime - e.inputBuffer.duration) * ctx.sampleRate);
      }
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(processor).connect(sink);
  }

  /** Loudness meter and live pitch, about 30 times a second. */
  private startMeter(analyser: AnalyserNode, livePitch: boolean): void {
    const samples = new Float32Array(analyser.fftSize);
    const scratch = new Float32Array(analyser.fftSize);
    let odd = false;
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      odd = !odd;
      if (odd) return; // every other frame is plenty, and kind to phones
      analyser.getFloatTimeDomainData(samples);
      const level = rms(samples);
      this.onLevel(Math.min(1, level * 6));
      if (!livePitch) return;
      let midi: number | null = null;
      if (level > 0.01) {
        const cands = pitchCandidates(samples, analyser.context.sampleRate, scratch);
        const best = cands.reduce<{ midi: number; p: number } | null>((a, c) => (!a || c.p > a.p ? c : a), null);
        if (best && best.p > 0.25) midi = best.midi;
      }
      // A short median keeps the display steady without lagging behind the voice.
      if (midi === null) this.livePitches = [];
      else {
        this.livePitches.push(midi);
        if (this.livePitches.length > 5) this.livePitches.shift();
        midi = [...this.livePitches].sort((a, b) => a - b)[this.livePitches.length >> 1];
      }
      this.onLivePitch(midi);
    };
    tick();
  }

  /** Count-in, then a click on every beat. Records where beat 1 falls in the recording. */
  private startClick(ctx: AudioContext, bpm: number): void {
    const period = 60 / bpm;
    const first = ctx.currentTime + 0.35; // first count-in click
    const beatOne = first + COUNT_IN * period; // recording "beat 1"
    // Where beat 1 is, in seconds from the first recorded sample. The click reaches the
    // ears a little after it's scheduled (output latency), and the singer follows the ear.
    const outputLatency = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0.02;
    this.beat = { bpm, firstBeat: beatOne - this.startFrame / ctx.sampleRate + outputLatency };

    for (let i = 0; i < COUNT_IN; i++) {
      const delay = (first + i * period - ctx.currentTime) * 1000;
      this.countTimers.push(window.setTimeout(() => this.onCountIn(COUNT_IN - i), Math.max(0, delay)));
    }
    this.countTimers.push(window.setTimeout(() => this.onCountIn(0), (beatOne - ctx.currentTime) * 1000));

    // Book clicks a little ahead on the audio clock (sample-accurate), refilled by a timer.
    let next = 0;
    const schedule = () => {
      while (first + next * period < ctx.currentTime + 0.25) {
        const t = first + next * period;
        const accent = next < COUNT_IN || (next - COUNT_IN) % 4 === 0;
        click(ctx, t, accent);
        next++;
      }
    };
    schedule();
    this.clickTimer = window.setInterval(schedule, 50);
  }

  /** Microphone off (the browser's recording light goes out), clicks and meter stopped. */
  private release(): void {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.stopTimer);
    clearInterval(this.clickTimer);
    this.countTimers.forEach(clearTimeout);
    this.countTimers = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    doneRecordingAudio(); // using the microphone changes the iPhone's audio mode; switch back
  }
}

/** A short, soft woodblock-like click. */
function click(ctx: AudioContext, time: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1760 : 1320;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.06);
}
