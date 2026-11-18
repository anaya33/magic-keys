/**
 * Audio → raw notes, with Spotify's Basic Pitch (Apache-2.0), running in the browser.
 *
 * Basic Pitch is a small neural network (TensorFlow.js) that listens to audio and
 * says, frame by frame, which pitches are sounding and where notes begin. Its
 * helper functions then turn those frames into note events.
 *
 * It expects mono audio at 22,050 Hz, so we resample first. The model files are
 * served by this app (/models/basic-pitch), and the library is loaded only the
 * first time someone uses Listen mode, so it never slows down the piano.
 */
export interface RawNote {
  start: number; // seconds
  duration: number; // seconds
  midi: number;
  amplitude: number; // 0..1
  /** How far the note was from perfectly in tune, in semitones (−0.5 … +0.5). */
  bend: number;
}

const MODEL_URL = `${import.meta.env.BASE_URL}models/basic-pitch/model.json`;
const SAMPLE_RATE = 22050;

/** Basic Pitch's pitch bends come in thirds of a semitone. */
const BEND_BINS_PER_SEMITONE = 3;

type BasicPitchModule = typeof import('@spotify/basic-pitch');
let modulePromise: Promise<BasicPitchModule> | null = null;
let model: InstanceType<BasicPitchModule['BasicPitch']> | null = null;

/**
 * Start loading Basic Pitch early (e.g. when the Listen panel opens), and make sure
 * TensorFlow.js runs on the graphics card (WebGL): many times faster than the CPU.
 */
export function warmUp(): Promise<BasicPitchModule> {
  modulePromise ??= (async () => {
    const [bp, tf] = await Promise.all([import('@spotify/basic-pitch'), import('@tensorflow/tfjs')]);
    if (tf.getBackend() !== 'webgl') await tf.setBackend('webgl').catch(() => false);
    await tf.ready();
    return bp;
  })();
  return modulePromise;
}

export async function transcribe(audio: AudioBuffer, onProgress: (fraction: number) => void): Promise<RawNote[]> {
  const bp = await warmUp();
  model ??= new bp.BasicPitch(MODEL_URL);
  const mono = await toMono22k(audio);

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await model.evaluateModel(
    mono,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    onProgress,
  );

  // Onset threshold, frame threshold, and minimum note length (in frames, ~11.6 ms each):
  // slightly stricter than the defaults so room noise doesn't turn into notes.
  const events = bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 8);
  return bp.noteFramesToTime(bp.addPitchBendsToNoteEvents(contours, events)).map((n) => ({
    start: n.startTimeSeconds,
    duration: n.durationSeconds,
    midi: n.pitchMidi,
    amplitude: n.amplitude,
    bend: average(n.pitchBends ?? []) / BEND_BINS_PER_SEMITONE,
  }));
}

function average(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

/** Mix to one channel and resample to 22,050 Hz with the browser's own resampler. */
async function toMono22k(audio: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(audio.duration * SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, Math.max(1, length), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = audio;
  source.connect(offline.destination); // a 1-channel destination mixes channels down
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
