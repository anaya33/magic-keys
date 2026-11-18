# Magic Keys

A playful piano that makes anyone feel like a pianist. Press any key and the
"magic fingers" play real music on a sampled grand piano. When you're ready,
Learn mode teaches you the piece, note by note.

Everything runs in the browser: no backend, no accounts, no tracking.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

## What it does

| Mode | What happens |
| --- | --- |
| **Magic** | Any key (keyboard, mouse, touch or MIDI) plays the *next* note or chord of the song, on the right piano keys, for its written length. You set the pace. **Autoplay** performs the whole piece with phrasing and dynamics. |
| **Learn** | The next key glows with its note name and computer-key shortcut. The song waits for the right key; a wrong key gives the right one a gentle wiggle. Right-hand practice has the left hand played for you. |
| **Free play** | Your own piano, with a sustain pedal (Space), MIDI, multi-touch and glissando. |
| **Listen** | Record yourself playing or humming. Spotify's Basic Pitch turns it into notes, which are cleaned up into a real score and saved to *Your songs*. |

Songs: Für Elise, Moonlight Sonata (1st mvt.), Bach's Prelude in C, Clair de Lune
(opening) and Gymnopédie No. 1 (opening), plus anything you upload (MusicXML) or record.
On a phone held upright, Magic and Learn become a **piano-tiles** game.

## How the code is organised

```
src/
  main.ts              App shell: layout, modes, and where every input is routed
  audio/piano.ts       The sampled grand piano (Tone.js + Salamander samples)
  input/               Computer keyboard (tracker layout) and Web MIDI
  music/
    types.ts           Song / SongNote / Step: the one shape every song takes
    musicxml.ts        MusicXML → Song (repeats, ties, pedal, tempo, dynamics)
    library.ts         Built-in songs (auto-discovered in /songs) + your songs
    storage.ts         Your songs in IndexedDB, on this device only
  modes/
    magic.ts           Magic mode + Autoplay (audio-clock scheduling)
    expression.ts      The "magic fingers" performance rules
    learn.ts           Learn mode
  listen/              Record → Basic Pitch → clean-up → MusicXML
  ui/                  Keyboard, sheet music, tiles, library, Listen, About…
songs/                 Built-in MusicXML (drop a file here and it appears) + CREDITS.md
public/                Piano samples, Basic Pitch model, fonts, icons, service worker
```

### The flow of a key press

```
input (mouse/touch · computer keys · MIDI)  →  press(midi, velocity)   [main.ts]
  Magic:     the key is just "go"  →  magic.playNext()  →  next step of the song
  Learn:     learn.press(midi)     →  right key? advance : wiggle the right key
  Free play: piano.noteOn(midi)    →  that key sounds and lights up
```

The keyboard view never makes sound and the modes never touch the page: each
mode talks to a small "view" interface (`light`, `follow`, `progress`, …), which
keeps the pieces independent and easy to test.

## Design decisions worth talking about

- **It must not sound like a synth.** Real Salamander Grand samples (one every minor
  third, repitched in between), a natural release, a real sustain pedal and a touch
  of reverb. The free sample set has one velocity layer, so harder notes blend from a
  mellow filtered voice into a bright one: a real piano gets *brighter*, not just louder.
- **Instant first note, no loading screen.** The whole piano (samples, reverb) is built
  in a *paused* audio engine while the page opens; browsers only forbid *sound* before
  a gesture, so the first key press just un-pauses it. A note pressed in the first
  split second waits in a queue instead of being lost.
- **Perfect timing.** Autoplay never plays notes from JavaScript timers (they drift).
  A timer wakes every 25 ms and books the next 150 ms of notes on the audio clock,
  which is sample-accurate. Timers only drive the key lights.
- **One song format, many sources.** Built-in files, uploads and microphone recordings
  all become MusicXML and go through the same parser. A recording therefore gets real
  sheet music and every mode with no extra code.
- **Real scores are messy.** The parser unrolls repeats and 1st/2nd endings, joins ties,
  lets the pedal hold notes, merges duplicate notes and ignores impossible tempo marks.
- **Listen clean-up is musical, not just filtering.** It drops overtones (the quiet echo
  an octave up), finds the key (Krumhansl–Schmuckler), and only nudges notes that were
  measurably *out of tune* toward the key, so intentional notes like Für Elise's D♯ survive.
- **Light on the device.** Nothing animates on its own; key presses are a single GPU
  transform. The 88 keys sit on one track that slides; the tiles view keeps ~17 tiles in
  the page even for an 800-note piece; at most 48 notes ring at once. Sheet music (OSMD)
  and Listen (TensorFlow.js) are loaded only when first needed.
- **Proportions never squish.** Everything on the keyboard scales from one number, the
  white-key width. Bigger screens show more keys instead of stretching them.
- **Private by design.** No server, no accounts, no analytics. Fonts and the Basic Pitch
  model are served by the app itself. A service worker keeps the piano offline after the
  first visit.

## Credits

- Salamander Grand Piano samples, Alexander Holm (CC BY 3.0), via Tone.js
- OpenSheetMusicDisplay (BSD-3-Clause) for sheet music
- Spotify Basic Pitch (Apache-2.0) for Listen mode
- Song encodings: PDMX public-domain MusicXML (CC0); see `songs/CREDITS.md`
- Resoomie Sans, based on Figtree by Erik Kennedy (SIL Open Font License 1.1)
