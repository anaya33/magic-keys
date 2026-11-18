/**
 * Voice pitch tracking: pYIN-style, in plain TypeScript (no model to download).
 *
 * YIN (de Cheveigné & Kawahara, 2002) finds the period of a sound by asking "how
 * different is the wave from itself, shifted by τ samples?". The shift with the
 * smallest (normalised) difference is the period, and 1/period is the pitch.
 *
 * pYIN (Mauch & Dixon, 2014), used by the transcription tool Tony, makes this robust
 * for singing: instead of one fixed threshold it tries a whole range of thresholds,
 * so every frame gives a few pitch *candidates* with probabilities (plus a chance it
 * isn't pitched at all). A Viterbi pass then picks the most believable path through
 * the candidates over time: pitch tends to move smoothly, octave jumps and flickers
 * between voiced/unvoiced are unlikely. This removes most octave errors and blips.
 */

/** Analysis rate, frame and hop: 1024 samples ≈ 46 ms window, 256 ≈ 11.6 ms per frame. */
export const SAMPLE_RATE = 22050;
const FRAME = 1024;
const HOP = 256;
const MIN_HZ = 65; // C2: low male voice
const MAX_HZ = 1100; // C#6: high soprano / whistle
const SILENCE_RMS = 0.006;

export interface PitchFrame {
  time: number; // seconds (frame centre)
  midi: number | null; // fractional MIDI pitch, or null when not pitched
  rms: number; // loudness 0..1 (46 ms window)
  /** Loudness over a short 12 ms window: sharp enough to see a quick re-attack. */
  rmsShort: number;
}

interface Candidate {
  midi: number;
  p: number;
}

// pYIN's prior over thresholds: Beta(2, 18) (mean 0.1), on 100 thresholds 0.01 … 1.00.
const THRESHOLDS = Array.from({ length: 100 }, (_, i) => (i + 1) / 100);
const THRESHOLD_CDF = (() => {
  const pdf = THRESHOLDS.map((s) => s * Math.pow(1 - s, 17));
  const total = pdf.reduce((a, b) => a + b, 0);
  let acc = 0;
  return pdf.map((p) => (acc += p / total));
})();
/** Probability that the threshold is ≤ s. */
function thresholdCdf(s: number): number {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  return THRESHOLD_CDF[Math.min(99, Math.max(0, Math.round(s * 100) - 1))];
}

/**
 * One frame of pYIN: pitch candidates with probabilities.
 * `diff` is scratch space (length ≥ maxLag + 1) to avoid allocating per frame.
 */
export function pitchCandidates(frame: Float32Array, sampleRate: number, diff?: Float32Array): Candidate[] {
  const w = frame.length >> 1; // integration window
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(w - 1, Math.ceil(sampleRate / MIN_HZ));
  const d = diff ?? new Float32Array(maxLag + 2);

  // Difference function d(τ) = Σ (x[j] − x[j+τ])², then the cumulative-mean normalisation.
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const delta = frame[j] - frame[j + tau];
      sum += delta * delta;
    }
    running += sum;
    d[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  // Local minima below 1 are candidate periods. A threshold s picks the *first*
  // minimum under s, so minimum i wins for thresholds in (v_i, min of earlier minima].
  const candidates: Candidate[] = [];
  let lowestSoFar = 1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (d[tau] < d[tau - 1] && d[tau] <= d[tau + 1] && d[tau] < lowestSoFar) {
      const p = thresholdCdf(lowestSoFar) - thresholdCdf(d[tau]);
      // Parabolic interpolation for a sub-sample period, hence a precise pitch.
      const a = d[tau - 1];
      const b = d[tau];
      const c = d[tau + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      const period = tau + Math.max(-0.5, Math.min(0.5, shift));
      const hz = sampleRate / period;
      if (p > 0.001) candidates.push({ midi: 69 + 12 * Math.log2(hz / 440), p: p * (1 - b) });
      lowestSoFar = d[tau];
    }
  }
  return candidates;
}

/** Loudness (root mean square) of a frame. */
export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Track the pitch of a whole recording (mono, at SAMPLE_RATE). Works in slices and
 * yields to the browser between them so the page stays responsive.
 */
export async function trackPitch(samples: Float32Array, onProgress: (f: number) => void = () => {}): Promise<PitchFrame[]> {
  const count = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const scratch = new Float32Array(FRAME);
  const perFrame: { cands: Candidate[]; rms: number; rmsShort: number; time: number }[] = [];
  for (let f = 0; f < count; f++) {
    const start = f * HOP;
    const frame = samples.subarray(start, start + FRAME);
    const loud = rms(frame);
    const centre = start + FRAME / 2;
    perFrame.push({
      time: centre / SAMPLE_RATE,
      rms: loud,
      rmsShort: rms(samples.subarray(centre - HOP / 2, centre + HOP / 2)),
      cands: loud < SILENCE_RMS ? [] : pitchCandidates(frame, SAMPLE_RATE, scratch),
    });
    if (f % 200 === 199) {
      onProgress(f / count);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const path = viterbi(perFrame.map((x) => x.cands));
  return perFrame.map((x, i) => ({ time: x.time, rms: x.rms, rmsShort: x.rmsShort, midi: path[i] }));
}

/**
 * Pick the most likely pitch path through the candidates (sparse Viterbi):
 * each frame's states are its candidates plus "unpitched". Moving by a small
 * interval is cheap, big leaps cost more, and switching pitched ↔ unpitched costs a
 * little, so one-frame flickers and octave slips lose to a steady line.
 */
function viterbi(frames: Candidate[][]): (number | null)[] {
  const UNVOICED_COST = 2.2; // −log probability-ish of being unpitched when candidates exist
  const SWITCH_COST = 3; // voiced ↔ unvoiced
  type State = { midi: number | null; cost: number; from: number };
  const columns: State[][] = [];
  let prev: State[] = [{ midi: null, cost: 0, from: -1 }];
  for (const cands of frames) {
    const pTotal = cands.reduce((s, c) => s + c.p, 0);
    const states: State[] = [
      ...cands.map((c) => ({ midi: c.midi as number | null, cost: -Math.log(Math.max(1e-4, c.p)), from: 0 })),
      { midi: null, cost: cands.length ? UNVOICED_COST + Math.log1p(pTotal * 4) : 0, from: 0 },
    ];
    for (const s of states) {
      let best = Infinity;
      let bestFrom = 0;
      prev.forEach((p, j) => {
        let t: number;
        if (s.midi === null || p.midi === null) t = s.midi === p.midi ? 0 : SWITCH_COST;
        else {
          const jump = Math.abs(s.midi - p.midi);
          t = jump < 1 ? jump * 0.5 : 0.5 + (jump - 1) * 0.35 + (Math.abs(jump - 12) < 0.6 ? 2 : 0);
        }
        const total = p.cost + t;
        if (total < best) {
          best = total;
          bestFrom = j;
        }
      });
      s.cost += best;
      s.from = bestFrom;
    }
    columns.push(states);
    prev = states;
  }
  // Trace back the cheapest path.
  const path: (number | null)[] = new Array(frames.length).fill(null);
  if (columns.length === 0) return path;
  let idx = columns[columns.length - 1].reduce((bi, s, i, arr) => (s.cost < arr[bi].cost ? i : bi), 0);
  for (let f = columns.length - 1; f >= 0; f--) {
    const s = columns[f][idx];
    path[f] = s.midi;
    idx = s.from;
  }
  return path;
}

/** Resample any mono/stereo audio to SAMPLE_RATE mono with the browser's resampler. */
export async function toAnalysisRate(samples: Float32Array, sampleRate: number): Promise<Float32Array> {
  if (sampleRate === SAMPLE_RATE) return samples;
  const source = new AudioBuffer({ length: samples.length, sampleRate, numberOfChannels: 1 });
  source.copyToChannel(samples, 0);
  const offline = new OfflineAudioContext(1, Math.ceil((samples.length * SAMPLE_RATE) / sampleRate), SAMPLE_RATE);
  const node = offline.createBufferSource();
  node.buffer = source;
  node.connect(offline.destination);
  node.start();
  return (await offline.startRendering()).getChannelData(0);
}

export const FRAME_SECONDS = HOP / SAMPLE_RATE;
