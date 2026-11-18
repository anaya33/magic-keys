/**
 * Timed notes (seconds) → notes on a musical grid (beats), with triplets.
 *
 *  1. The beat. With the click track it's known exactly. Without it, we find the most
 *     common time gaps between notes by clustering them (Dixon's beat induction), try
 *     the likely beat lengths built from them, and keep the one that explains the notes
 *     best. A light beat *tracker* then follows the singer as they speed up or slow down.
 *  2. Each beat picks its own grid: whole beat, eighths, sixteenths, eighth-triplets or
 *     sixteenth-triplets. Like Cemgil's Bayesian quantizer, the choice balances how well a
 *     grid fits the notes against how complicated it is to read, so three evenly spaced
 *     notes become a triplet, while two slightly uneven eighths stay plain eighths.
 *  3. Note lengths snap to the same grid. A tiny gap before the next note is legato
 *     (no fussy rests), and a note never overlaps the next one in its staff.
 *
 * Time on the grid is counted in ticks: 12 per beat, so eighths (6), sixteenths (3),
 * eighth-triplets (4) and sixteenth-triplets (2) are all whole numbers.
 */
export const TICKS_PER_BEAT = 12;

export interface TimedNote {
  midi: number;
  start: number; // seconds
  duration: number; // seconds
  staff: 1 | 2;
  amplitude: number;
}

export interface GridNote {
  midi: number;
  start: number; // ticks
  length: number; // ticks
  staff: 1 | 2;
  amplitude: number;
}

export type BeatGrid = 1 | 2 | 4 | 3 | 6; // divisions of the beat; 3 and 6 are triplets

export interface RhythmResult {
  notes: GridNote[];
  bpm: number;
  /** Grid chosen for each beat that has notes (beat index → divisions). */
  grids: Map<number, BeatGrid>;
  tripletBeats: number;
}

/** Known beat from the click track: tempo, and when (in recording seconds) beat 1 of the count fell. */
export interface KnownBeat {
  bpm: number;
  firstBeat: number;
}

const GRIDS: BeatGrid[] = [1, 2, 4, 3, 6];
/** How much each grid "costs" to read (in squared beats): simpler grids win ties. */
const COMPLEXITY: Record<BeatGrid, number> = { 1: 0, 2: 0.0015, 4: 0.004, 3: 0.003, 6: 0.008 };
const TOGETHER = 0.05; // seconds: onsets this close are one chord

export function quantize(notes: TimedNote[], known?: KnownBeat): RhythmResult {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  // Onset groups (chords): everyone in a group shares the earliest start.
  const onsets: number[] = [];
  for (const n of sorted) {
    if (!onsets.length || n.start - onsets[onsets.length - 1] > TOGETHER) onsets.push(n.start);
    else n.start = onsets[onsets.length - 1];
  }

  // 1. Beat times.
  let beats: number[];
  if (known) {
    const period = 60 / known.bpm;
    let t = known.firstBeat;
    while (t > onsets[0]) t -= period;
    beats = [];
    const end = Math.max(...sorted.map((n) => n.start + n.duration)) + period * 2;
    for (; t < end; t += period) beats.push(t);
  } else {
    beats = trackBeats(onsets, estimatePeriod(onsets));
  }
  const toBeats = makeBeatMap(beats);
  const period = (beats[beats.length - 1] - beats[0]) / Math.max(1, beats.length - 1);

  // 2. Per-beat grids for the onsets.
  const onsetBeats = onsets.map(toBeats);
  const byBeat = new Map<number, number[]>();
  for (const x of onsetBeats) {
    const k = Math.floor(x + 1e-9);
    byBeat.set(k, [...(byBeat.get(k) ?? []), x - k]);
  }
  const grids = new Map<number, BeatGrid>();
  for (const [k, fracs] of byBeat) grids.set(k, bestGrid(fracs));
  const snapTick = (x: number): number => {
    const k = Math.floor(x + 1e-9);
    const g = grids.get(k) ?? 4;
    const step = TICKS_PER_BEAT / g;
    return k * TICKS_PER_BEAT + Math.round(((x - k) * TICKS_PER_BEAT) / step) * step;
  };
  const onsetTick = new Map<number, number>();
  onsets.forEach((t, i) => onsetTick.set(t, snapTick(onsetBeats[i])));

  // Shift so the music starts in the first bar.
  const firstTick = Math.min(...onsetTick.values());
  const barShift = Math.floor(firstTick / (TICKS_PER_BEAT * 4)) * TICKS_PER_BEAT * 4;

  // 3. Lengths, per staff (each staff is one line of notes/chords).
  const out: GridNote[] = [];
  for (const staff of [1, 2] as const) {
    const inStaff = sorted.filter((n) => n.staff === staff);
    const starts = [...new Set(inStaff.map((n) => onsetTick.get(n.start)!))].sort((a, b) => a - b);
    for (const n of inStaff) {
      const start = onsetTick.get(n.start)!;
      const next = starts.find((s) => s > start);
      const step = TICKS_PER_BEAT / (grids.get(Math.floor(start / TICKS_PER_BEAT)) ?? 4);
      let end = snapTick(toBeats(n.start + n.duration));
      end = Math.max(end, start + step);
      if (next !== undefined) {
        if (end > next) end = next; // never overlap the next note
        if (next - end <= 3) end = next; // a tiny gap is legato, not a rest
      }
      end = Math.min(end, start + TICKS_PER_BEAT * 8); // at most two bars
      const prev = out.find((o) => o.staff === staff && o.start === start - barShift && o.midi === n.midi);
      if (prev) continue; // same note twice at the same time
      out.push({ midi: n.midi, staff, amplitude: n.amplitude, start: start - barShift, length: end - start });
    }
  }

  // Re-key grids after the bar shift.
  const shiftedGrids = new Map<number, BeatGrid>();
  for (const [k, g] of grids) shiftedGrids.set(k - barShift / TICKS_PER_BEAT, g);
  return {
    notes: out.sort((a, b) => a.start - b.start || a.staff - b.staff || b.midi - a.midi),
    bpm: Math.round(60 / period),
    grids: shiftedGrids,
    tripletBeats: [...shiftedGrids.values()].filter((g) => g === 3 || g === 6).length,
  };
}

/** The grid for one beat: best fit plus a readability cost (fracs are 0..1 within the beat). */
function bestGrid(fracs: number[]): BeatGrid {
  let best: BeatGrid = 4;
  let bestCost = Infinity;
  for (const g of GRIDS) {
    let cost = COMPLEXITY[g];
    for (const f of fracs) {
      const d = f - Math.round(f * g) / g;
      cost += d * d;
    }
    // Two onsets landing on the same grid point means the grid is too coarse.
    const slots = new Set(fracs.map((f) => Math.round(f * g)));
    if (slots.size < fracs.length) cost += 1;
    if (cost < bestCost) {
      bestCost = cost;
      best = g;
    }
  }
  return best;
}

/**
 * Beat induction: cluster the gaps between onsets (each onset with its next few),
 * score each cluster by how many other gaps are whole multiples of it, then try the
 * musically plausible beat lengths built from the best cluster (½×, 1×, 2×, 3×, 4×) and
 * keep the one whose grid explains the onsets best.
 */
function estimatePeriod(onsets: number[]): number {
  if (onsets.length < 3) return 0.6;
  const gaps: number[] = [];
  for (let i = 0; i < onsets.length; i++) {
    for (let j = i + 1; j < Math.min(onsets.length, i + 9); j++) {
      const d = onsets[j] - onsets[i];
      if (d >= 0.1 && d <= 2.5) gaps.push(d);
    }
  }
  gaps.sort((a, b) => a - b);
  const clusters: { interval: number; count: number }[] = [];
  for (const g of gaps) {
    const c = clusters.find((k) => Math.abs(k.interval - g) < 0.025);
    if (c) {
      c.interval = (c.interval * c.count + g) / (c.count + 1);
      c.count++;
    } else clusters.push({ interval: g, count: 1 });
  }
  let best = clusters[0];
  let bestScore = -1;
  for (const c of clusters) {
    let score = 0;
    for (const k of clusters) {
      const n = Math.round(k.interval / c.interval);
      if (n >= 1 && n <= 8 && Math.abs(k.interval - n * c.interval) < 0.025 * n) score += k.count * (n <= 4 ? 6 - n : 1);
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  // Candidate beat lengths in a singable range (≈ 60–170 bpm); pick the best explainer.
  const candidates = [0.5, 1, 2, 3, 4].map((m) => best.interval * m).filter((p) => p >= 0.35 && p <= 1.0);
  if (!candidates.length) return Math.min(1, Math.max(0.35, best.interval));
  let bestPeriod = candidates[0];
  let bestFit = Infinity;
  for (const p of candidates) {
    // Fit: average per-onset grid cost at the best phase, plus a gentle pull to ~100 bpm.
    let fit = Infinity;
    for (let s = 0; s < 24; s++) {
      const phase = onsets[0] - (s / 24) * p;
      let cost = 0;
      for (const t of onsets) {
        const x = (t - phase) / p;
        const f = x - Math.floor(x);
        cost += Math.min(...GRIDS.map((g) => (f - Math.round(f * g) / g) ** 2 + COMPLEXITY[g]));
      }
      fit = Math.min(fit, cost / onsets.length);
    }
    fit += 0.002 * Math.abs(Math.log2(p / 0.6));
    if (fit < bestFit) {
      bestFit = fit;
      bestPeriod = p;
    }
  }
  return bestPeriod;
}

/**
 * Follow the beat through the recording (people drift). Starting at the first onset,
 * each next beat is predicted one period later; onsets near a predicted beat pull it
 * (phase) and nudge the period (tempo) a little.
 */
function trackBeats(onsets: number[], period: number): number[] {
  const beats = [onsets[0]];
  let p = period;
  const last = onsets[onsets.length - 1] + period * 2;
  while (beats[beats.length - 1] < last) {
    const predicted = beats[beats.length - 1] + p;
    const near = onsets.filter((t) => Math.abs(t - predicted) < p * 0.15);
    if (near.length) {
      const closest = near.reduce((a, b) => (Math.abs(a - predicted) < Math.abs(b - predicted) ? a : b));
      const error = closest - predicted;
      beats.push(predicted + error * 0.6);
      p = Math.min(period * 1.3, Math.max(period * 0.75, p + error * 0.15));
    } else beats.push(predicted);
  }
  return beats;
}

/** Seconds → beat position (beat index + fraction), through the tracked beat times. */
function makeBeatMap(beats: number[]): (t: number) => number {
  return (t) => {
    if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
    for (let k = 0; k < beats.length - 1; k++) {
      if (t < beats[k + 1]) return k + (t - beats[k]) / (beats[k + 1] - beats[k]);
    }
    const n = beats.length - 1;
    return n + (t - beats[n]) / (beats[n] - beats[n - 1]);
  };
}
