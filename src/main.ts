/**
 * Magic Keys — app entry point. Opens straight onto the piano, in Magic mode.
 *
 * Screen layout (top to bottom):
 *   1. One control row: logo · Magic / Learn / Free play tabs · controls for that mode
 *   2. The music card: sheet music with a moving cursor (or, in Free play, the notes you played)
 *   3. The piano
 *
 * Flow of a key press, whatever it comes from:
 *   input (mouse/touch · computer keys · MIDI)  →  press(midi, velocity)
 *     Magic:     the key is just a "go" signal → magic.playNext() plays the song's next note/chord
 *     Learn:     learn.press(midi) checks it against the glowing key(s)
 *     Free play: the key plays itself → piano.noteOn(midi) + the key lights up
 */
import './styles.css';
import { piano } from './audio/piano';
import { setPlaybackModeEarly } from './audio/session';
import { ComputerKeys } from './input/computerKeys';
import { connectMidi } from './input/midi';
import { isYourSong, listSongs, loadSong, restoreYourSongs } from './music/library';
import { noteName } from './music/notes';
import type { Song } from './music/types';
import { LearnMode, type Hands } from './modes/learn';
import { DuetMode } from './modes/duet';
import { MagicMode } from './modes/magic';
import { TilesGame, type TilesState } from './modes/tilesGame';
import { celebrate } from './ui/celebrate';
import { AboutView } from './ui/about';
import { InstructionsCard } from './ui/instructions';
import { KeyboardView } from './ui/keyboard';
import { LibraryView } from './ui/library';
import { ListenView } from './ui/listen';
import { SheetView } from './ui/sheet';
import { isOn } from './features';
import { TilesView } from './ui/tiles';

type Mode = 'magic' | 'learn' | 'free' | 'duet';

const app = document.querySelector<HTMLDivElement>('#app')!;

/**
 * A real phone or tablet: a touch screen and no mouse. Phone layouts (tiles, the
 * sideways full piano) are only for these. A narrow or short desktop window keeps
 * the desktop layout, however it's resized.
 */
const TOUCH_DEVICE = '(hover: none) and (pointer: coarse)';

/**
 * Chunky keys on desktop and phone-landscape. An upright phone shows about ten white
 * keys across (an octave and a bit, C to E), so each one is big enough for a thumb.
 */
function keyWidthForScreen(): number {
  if (window.matchMedia(`(orientation: portrait) and ${TOUCH_DEVICE}`).matches) {
    return Math.max(30, (window.innerWidth - 40) / 10); // 40: the screen's and the piano's side padding
  }
  if (window.innerWidth >= 1100) return 68;
  return 56;
}

/** Keys that should never count as "any key" in Magic mode. */
function isControlKey(code: string): boolean {
  return /^(Tab|Escape|Shift|Control|Alt|Meta|CapsLock|F\d+|Arrow|Page|Home|End|Insert|ContextMenu|OS)/.test(code);
}

const ICONS = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4a.8.8 0 0 0 1.2.7l8.4-5.2a.8.8 0 0 0 0-1.4L5.7 2.1a.8.8 0 0 0-1.2.7z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1"/><rect x="9.5" y="2.5" width="3" height="11" rx="1"/></svg>',
  notes: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.2v7.3a2.3 2.3 0 1 0 1.5 2.1V6.4l5-1.2v4.3a2.3 2.3 0 1 0 1.5 2.1V2.4a.6.6 0 0 0-.7-.6L6.5 2.6a.6.6 0 0 0-.5.6z"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.5 8 10l3.5-3.5"/></svg>',
  rotate: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="4" width="14" height="24" rx="3.5" fill="#87D0FB"/><rect x="13" y="24" width="6" height="1.6" rx=".8" fill="#33322D"/><path d="M26.5 12.5a8 8 0 0 0-4-5.5" fill="none" stroke="#33322D" stroke-width="2" stroke-linecap="round"/><path d="M26.8 9.3l-.3 3.2-3-1" fill="none" stroke="#33322D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // Full screen (hide the controls): four corners pointing out.
  fullscreen: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>',
  restart: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 1 0 1.5-3.5"/><path d="M3 2.5V5h2.5"/></svg>',
};

function start(): KeyboardView {
  app.innerHTML = `
    <main class="play" data-mode="magic">
      <header class="topbar">
        <div class="brand">
          <button class="logo-btn" id="about" aria-label="About Magic Keys"><img src="${import.meta.env.BASE_URL}icons/piano-icon-64.png?v=5" alt="" width="26" height="26" /></button>
          <button class="song-btn" id="songs" aria-label="Choose a song">
            ${ICONS.notes}<span class="song-btn-title">Songs</span>${ICONS.chevron}
          </button>
        </div>
        <nav class="tabs" role="tablist" aria-label="Mode">
          <button role="tab" data-mode="magic">Magic</button>
          <button role="tab" data-mode="learn">Learn</button>
          <button role="tab" data-mode="free">Free play</button>
          ${isOn('duet') ? '<button role="tab" data-mode="duet">Duet</button>' : ''}
        </nav>
        <div class="controls">
          <button class="pill-btn" id="hands" data-only="learn">Right hand</button>
          <button class="icon-btn" id="autoplay" data-only="magic" aria-label="Autoplay" title="Autoplay">${ICONS.play}</button>
          <button class="icon-btn" id="restart" data-only="magic learn duet" aria-label="Start the song again">${ICONS.restart}</button>
          <button class="icon-btn" id="help" aria-label="How to play">?</button>
          <button class="icon-btn" id="hide-controls" aria-label="Full screen: hide the controls" title="Full screen">${ICONS.fullscreen}</button>
        </div>
      </header>

      <section class="music-card">
        <div class="music-card-head" data-only="magic learn duet" role="button" tabindex="0" title="Choose another song">
          <span class="song-title">Für Elise</span>
          <span class="song-composer">Beethoven</span>
        </div>
        <div class="sheet-slot" data-only="magic learn duet"></div>
        <div class="duet-status" data-only="duet" aria-live="polite">
          <span class="duet-side"><strong>Left hand</strong> keys left of middle C<em class="duet-count"></em></span>
          <span class="duet-side"><strong>Right hand</strong> middle C and up<em class="duet-count"></em></span>
        </div>
        <div class="played" data-only="free" aria-live="polite">
          <p class="played-empty">Play anything. The notes you play show up here.</p>
        </div>
        <button class="pill-btn clear-btn" data-only="free" hidden>Clear</button>
        <span class="counter" data-only="learn" aria-live="polite"></span>
        <div class="toast" hidden>Bravo! Press any key to play it again.</div>
        <div class="progress" data-only="magic learn duet" aria-hidden="true"><div class="progress-fill"></div></div>
      </section>

      <p class="turn-hint">${ICONS.rotate}<span>Turn your phone for the full piano</span></p>

      <section class="stage">
        <div class="piano-body"><span class="pedal-tag" aria-live="polite">Pedal</span></div>
      </section>

      <section class="tiles-slot" data-only="magic learn"></section>

      <!-- Upright phones: restart · mode tabs · play/pause, a bar at the bottom where
           thumbs are. The buttons move here from the top bar (see placeControls). -->
      <nav class="dock" aria-label="Playing controls"></nav>

      <!-- Shown only while the controls are hidden: brings them back. -->
      <button class="show-controls" id="show-controls" aria-label="Show the controls" title="Show the controls">${ICONS.chevron}</button>
    </main>`;

  const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
  const playEl = $<HTMLElement>('.play');
  const pedal = $<HTMLSpanElement>('.pedal-tag');
  const clearBtn = $<HTMLButtonElement>('.clear-btn');
  const autoplayBtn = $<HTMLButtonElement>('#autoplay');
  const handsBtn = $<HTMLButtonElement>('#hands');
  const counter = $<HTMLSpanElement>('.counter');
  const progressFill = $<HTMLDivElement>('.progress-fill');
  const toast = $<HTMLDivElement>('.toast');
  const played = $<HTMLDivElement>('.played');

  // ---- sound: build the piano now, in the background; un-pause it on the first interaction,
  // and wake it again on any later tap if a phone call or the background paused it.
  setPlaybackModeEarly(); // before the audio engine exists (see audio/session.ts)
  void piano.preload().catch((err) => console.warn(err));
  // iPhones only let sound start from a finished tap (touch-up or click), not from the
  // moment a finger lands, so we try at every step of a tap until the engine runs.
  const wakeAudio = () => piano.unlock();
  for (const type of ['pointerdown', 'touchend', 'pointerup', 'click', 'keydown']) window.addEventListener(type, wakeAudio, true);

  // ---- sheet music
  const sheet = new SheetView();
  $('.sheet-slot').append(sheet.el);
  const previewFor = (id: string) => `${import.meta.env.BASE_URL}sheet-previews/${id}.svg`;
  void sheet.showPreview(previewFor('fur-elise')); // the first song's opening bars, right away
  // The other songs' pictures download quietly afterwards, so switching songs is instant too.
  setTimeout(() => {
    void listSongs().then((songs) => {
      for (const s of songs) if (!isYourSong(s.id)) new Image().src = previewFor(s.id);
    });
  }, 1500);

  // ---- Free play: a trail of the notes you just played
  const emptyMessage = played.innerHTML;
  const showPlayed = (midi: number) => {
    played.querySelector('.played-empty')?.remove();
    const chip = document.createElement('span');
    chip.className = 'note-chip';
    chip.textContent = noteName(midi);
    played.append(chip);
    while (played.children.length > 24) played.firstElementChild!.remove();
    clearBtn.hidden = false;
  };
  clearBtn.addEventListener('click', () => {
    played.innerHTML = emptyMessage;
    clearBtn.hidden = true;
  });

  // ---- song + modes
  let mode: Mode = 'magic';
  let song: Song | null = null;
  let magic: MagicMode | null = null;
  let learn: LearnMode | null = null;
  let duet: DuetMode | null = null;
  let hands: Hands = 'right';

  const setProgress = (done: number, total: number) => {
    progressFill.style.transform = `scaleX(${total ? done / total : 0})`;
    counter.textContent = mode === 'learn' && total ? `${done} of ${total}` : '';
    if (!tilesGame) tiles.setPosition(done); // while a tiles game runs, it moves the tiles itself
  };

  // ---- phones held upright: piano tiles, played on tempo (see modes/tilesGame.ts)
  /**
   * Tiles speed. Thumbs on glass can't keep up with a pianist's fingers, so each song
   * plays its tiles at a comfortable tempo: its quick passages come at most about
   * 3 taps a second, and never faster than written. Für Elise slows to ~60%;
   * slow pieces like Gymnopédie keep their real tempo. Learn is never above 80%.
   */
  const COMFORTABLE_TAP_GAP = 0.33; // seconds between taps for the song's ordinary quick notes
  const MIN_TAP_GAP = 0.24; // anything closer than this (after slowing down) plays itself
  const comfortableSpeed = (times: number[]): number => {
    const gaps = times
      .slice(1)
      .map((t, i) => t - times[i])
      .filter((g) => g > 0.02)
      .sort((a, b) => a - b);
    // The song's ordinary quick notes (not its fastest runs, which play themselves).
    const quickGap = gaps.length ? gaps[Math.floor(gaps.length * 0.25)] : 1;
    return Math.min(1, Math.max(0.4, quickGap / COMFORTABLE_TAP_GAP));
  };
  /** Magic: which tiles are too quick to tap at this speed (they play themselves). */
  const selfPlaying = (times: number[], speed: number): boolean[] => {
    let lastTap = -Infinity;
    return times.map((t) => {
      if ((t - lastTap) / speed < MIN_TAP_GAP) return true;
      lastTap = t;
      return false;
    });
  };
  let tilesGame: TilesGame | null = null;
  /** A tap on the falling notes or on the piano under them (`lane`: the key, or -1). */
  const tapTiles = (lane: number) => {
    if (panelOpen()) return;
    instructions.hide();
    toast.hidden = true;
    if (tilesGame) return tilesGame.tap(lane);
    if (mode === 'magic') {
      // A tap during Autoplay hands the tiles back to you, and plays the next note too.
      magic?.stopAutoplay();
      (tilesGame as TilesGame | null)?.tap(lane); // stopping Autoplay just made a new tiles game
    }
  };
  const tiles = new TilesView(tapTiles);
  $('.tiles-slot').append(tiles.el);

  // One play button does it all. Not playing: ▶ starts Autoplay. Autoplay on: ⏸ stops it.
  // Tapping the tiles yourself: ⏸ pauses them, and ▶ carries on from there.
  let tilesState: TilesState = 'idle';
  const updatePlayButton = () => {
    const autoplaying = !!magic?.autoplaying;
    const tapping = tilesState === 'running';
    const paused = tilesState === 'paused';
    const showPause = autoplaying || tapping || (mode === 'learn' && tilesState === 'idle');
    // Paused: in Magic, ▶ means Autoplay from here (tapping the tiles carries on with you
    // playing); in Learn there's no Autoplay, so ▶ just carries on.
    const label = autoplaying || tapping ? 'Pause' : paused && mode === 'learn' ? 'Carry on' : 'Autoplay';
    // Learn (upright phone): there's no Autoplay, so the button waits, greyed out, until
    // you start tapping the tiles; then it pauses them.
    const waitingInLearn = mode === 'learn' && tilesState === 'idle';
    autoplayBtn.disabled = waitingInLearn;
    autoplayBtn.classList.toggle('is-on', autoplaying || (paused && mode === 'learn'));
    autoplayBtn.innerHTML = showPause ? ICONS.pause : ICONS.play;
    autoplayBtn.setAttribute('aria-label', label);
    autoplayBtn.title = label;
  };
  const showTilesState = (state: TilesState) => {
    tilesState = state;
    playEl.dataset.tiles = state;
    tiles.el.classList.toggle('is-paused', state === 'paused');
    tiles.el.dataset.pausedText = mode === 'magic' ? 'Paused · tap to play, ▶ to autoplay' : 'Paused · tap to carry on';
    updatePlayButton();
  };
  // Leaving the app (a call, another app) pauses the tiles, so no notes are missed.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) tilesGame?.pause();
  });

  /** Rebuild the tile column for the current mode and song, and start keeping time. */
  const refreshTiles = () => {
    tilesGame?.stop();
    tilesGame = null;
    showTilesState('idle');
    if (!tilesQuery.matches || !song) return; // tiles only exist on an upright phone
    if (mode === 'magic' && magic) {
      const times = song.steps.map((st) => st.start);
      const speed = comfortableSpeed(times);
      const auto = selfPlaying(times, speed);
      tiles.setTiles(
        song.steps.map((st, i) => {
          const top = Math.max(...st.notes.map((n) => n.midi));
          // The melody note's name on each tile you play (the small self-playing ones stay blank).
          return { top, time: st.start, auto: auto[i], label: auto[i] ? undefined : noteName(top, false) };
        }),
        magic.position,
      );
      if (magic.autoplaying) return; // Autoplay moves the tiles; the game starts again after it
      const m = magic;
      tilesGame = new TilesGame({
        view: tiles,
        kind: 'magic',
        speed,
        auto,
        startIndex: m.position,
        onHit: () => m.playNext(0.72),
        onState: showTilesState,
        onFinish: () =>
          celebrate(`You played ${song?.title ?? 'the song'}!`, () => {
            m.restart();
            refreshTiles();
          }),
      });
    } else if (mode === 'learn' && learn) {
      const l = learn;
      const times = l.targetTimes;
      tiles.setTiles(
        l.targetNotes.map((group, i) => ({
          top: Math.max(...group),
          time: times[i],
          label: group.map((midi) => noteName(midi, false)).join(' '),
          keys: group,
        })),
        l.position,
      );
      const speed = Math.min(0.8, comfortableSpeed(times));
      tilesGame = new TilesGame({
        view: tiles,
        kind: 'learn',
        speed,
        startIndex: l.position,
        onHit: () => l.playCurrent(0.72, 1 / speed),
        onState: showTilesState,
        onFinish: () => {}, // Learn mode celebrates by itself
      });
    }
  };

  const startLearn = () => {
    learn?.destroy();
    if (!song) return;
    learn = new LearnMode(
      song,
      {
        showTargets: (labels) => {
          keyboard.clearHighlights('target');
          for (const midi of labels.keys()) keyboard.setHighlight(midi, 'target', true);
          keyboard.setLabels(labels);
        },
        wiggle: (midi) => keyboard.wiggle(midi),
        light: (midi, on) => keyboard.setHighlight(midi, 'magic', on),
        follow: (groups) => keyboard.follow(groups),
        position: (beat) => sheet.goTo(beat),
        progress: setProgress,
        finished: () => celebrate(`You played ${song?.title ?? 'the song'}!`, () => learn?.restart()),
      },
      hands,
      (midi, chord) => learnShortcut(midi, chord),
    );
  };

  // ---- Duet: two players, one per hand (see modes/duet.ts). Off unless switched on.
  const duetCounts = app.querySelectorAll<HTMLElement>('.duet-count');
  const startDuet = () => {
    duet?.destroy();
    duet = null;
    if (!song) return;
    duet = new DuetMode(song, {
      light: (midi, on) => keyboard.setHighlight(midi, 'magic', on),
      follow: (groups) => keyboard.follow(groups),
      position: (beat) => sheet.goTo(beat),
      progress: (left, right) => {
        duetCounts[0].textContent = `${left[0]} of ${left[1]}`;
        duetCounts[1].textContent = `${right[0]} of ${right[1]}`;
        const total = left[1] + right[1];
        progressFill.style.transform = `scaleX(${total ? (left[0] + right[0]) / total : 0})`;
      },
      finished: () => celebrate(`You played ${song?.title ?? 'the song'} together!`, () => duet?.restart()),
    });
  };

  const setMode = (next: Mode) => {
    if (next !== 'magic') magic?.stopAutoplay();
    if (next !== 'duet') {
      duet?.destroy();
      duet = null;
    }
    if (next !== 'learn') {
      learn?.destroy();
      learn = null;
    }
    mode = next;
    playEl.dataset.mode = next;
    keyboard.glide = next === 'free' || next === 'learn'; // Magic and Duet: one tap, one step
    app.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.mode === next));
    });
    toast.hidden = true;
    counter.textContent = '';
    keyboard.clearHighlights();
    keyboard.setLabels(new Map());
    if (next === 'magic') magic?.restart();
    if (next === 'learn') startLearn();
    if (next === 'duet') startDuet();
    refreshTiles();
    fitToScreen(); // Free play gets a bigger piano in the tiles layout
  };
  app.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.mode as Mode));
  });

  const openSong = (next: Song) => {
    magic?.destroy();
    piano.allNotesOff();
    song = next;
    $('.song-title').textContent = next.title;
    $('.song-composer').textContent = next.composer;
    $('.song-btn-title').textContent = next.title;
    // Built-in songs have a ready-made picture of their opening bars, shown instantly.
    const preview = isYourSong(next.id) ? undefined : previewFor(next.id);
    if (next.musicXml) void sheet.show(next.musicXml, preview);
    magic = new MagicMode(next, {
      light: (midi, on) => keyboard.setHighlight(midi, 'magic', on),
      follow: (groups) => keyboard.follow(groups),
      progress: setProgress,
      position: (beat) => sheet.goTo(beat),
      autoplayChanged: () => {
        refreshTiles(); // Autoplay drives the tiles; afterwards the tempo game picks up where it stopped
        updatePlayButton();
      },
      finished: () => (toast.hidden = false),
    });
    setMode(mode);
  };

  autoplayBtn.addEventListener('click', () => {
    toast.hidden = true;
    instructions.hide();
    // ⏸ while you're tapping: pause. ▶ is always Autoplay in Magic (from wherever you
    // are, paused or not); tapping the tiles is always you playing. Learn: ▶ carries on.
    if (tilesGame && tilesState === 'running') return tilesGame.pause();
    if (tilesGame && tilesState === 'paused' && mode === 'learn') return tilesGame.resume();
    magic?.toggleAutoplay();
  });
  handsBtn.addEventListener('click', () => {
    hands = hands === 'right' ? 'both' : 'right';
    handsBtn.textContent = hands === 'right' ? 'Right hand' : 'Both hands';
    startLearn();
    refreshTiles();
  });
  $('#restart').addEventListener('click', () => {
    toast.hidden = true;
    if (mode === 'learn') learn?.restart();
    else if (mode === 'duet') duet?.restart();
    else magic?.restart();
    refreshTiles();
  });

  // ---- song library (button in the top bar, or click the title on the sheet music)
  const library = new LibraryView({
    onPick: (id) => loadSong(id).then(openSong, (err) => console.warn(err)),
    onUploaded: (uploaded) => {
      openSong(uploaded);
      if (mode === 'free') setMode('magic');
    },
    onRecord: () => listen.show(),
    // Deleting the song that's playing moves back to the first built-in song.
    onDeleted: (id) => {
      if (song?.id === id) loadSong('fur-elise').then(openSong, (err) => console.warn(err));
    },
  });
  const openLibrary = () => {
    magic?.stopAutoplay();
    instructions.hide();
    void library.show(song?.id ?? '');
  };
  $('#songs').addEventListener('click', openLibrary);
  const head = $('.music-card-head');
  head.addEventListener('click', openLibrary);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openLibrary();
  });

  // ---- Listen: record something, Basic Pitch turns it into a song
  const listen = new ListenView((recorded, nextMode) => {
    openSong(recorded);
    setMode(nextMode);
  });
  /** The piano rests while a full-screen panel (library, Listen) is open. */
  const panelOpen = () => library.open || listen.open || about.open;

  // ---- every input funnels into these functions
  /** Magic mode: any press means "play the next note". */
  const magicPress = (touch: number) => {
    if (panelOpen()) return;
    instructions.hide();
    toast.hidden = true;
    magic?.playNext(touch);
  };

  const press = (midi: number, velocity: number, row?: 'lower' | 'upper') => {
    if (panelOpen()) return; // the piano rests while you browse songs or record
    instructions.hide();
    if (mode === 'duet') {
      // Computer keyboard: bottom row = left hand, top row = right hand. Piano keys: split at middle C.
      const hand = row ? (row === 'lower' ? 'left' : 'right') : DuetMode.handFor(midi);
      duet?.press(hand, velocity);
      return;
    }
    if (tilesQuery.matches && (mode === 'magic' || mode === 'learn')) {
      // Upright phone: the piano plays the falling notes. Magic: any key plays the next
      // one (and the right key gives a little shake). Learn: it has to be the note's key.
      if (mode === 'learn') keyboard.setHighlight(midi, 'you', true);
      const expected = mode === 'magic' ? magic?.nextNotes ?? [] : [];
      tapTiles(midi);
      if (expected.length && !expected.includes(midi)) for (const right of expected) keyboard.wiggle(right);
      return;
    }
    if (mode === 'magic') {
      // Phone held sideways: if you tap a key that isn't the next note, the music still
      // plays (it's magic), and the right key shakes its head so you learn where it is.
      const expected = magic?.nextNotes ?? [];
      magicPress(velocity);
      const phoneSideways = phoneQuery.matches && !tilesQuery.matches;
      if (phoneSideways && expected.length && !expected.includes(midi)) {
        for (const right of expected) keyboard.wiggle(right);
      }
      return;
    }
    keyboard.setHighlight(midi, 'you', true);
    if (mode === 'learn') return learn?.press(midi, velocity);
    keyboard.ensureVisible([midi]);
    piano.noteOn(midi, velocity);
    showPlayed(midi);
  };
  const release = (midi: number) => {
    if (mode === 'magic' || mode === 'duet') return; // these notes end on their own, after their written length
    keyboard.setHighlight(midi, 'you', false);
    if (mode === 'learn' && tilesQuery.matches) return; // the falling notes handle Learn upright
    if (mode === 'learn') return learn?.release(midi);
    piano.noteOff(midi);
  };
  const sustain = (down: boolean) => {
    piano.setSustain(down);
    pedal.classList.toggle('is-down', down);
  };

  const keyboard = new KeyboardView({
    targetKeyWidth: keyWidthForScreen(),
    centerMidi: 64, // E4: puts both rows of computer keys (C3–G5) on screen
    onPress: press,
    onRelease: release,
  });
  $('.piano-body').append(keyboard.el);
  // Upright phone: the falling notes slide along with the keys under them.
  keyboard.onView = (animate) => tiles.syncKeys(animate);
  const keyGeometry = {
    box: (midi: number) => keyboard.keyBox(midi),
    offset: () =>
      keyboard.keysWindow.getBoundingClientRect().left - tiles.el.getBoundingClientRect().left - keyboard.scrollX,
  };

  // Three layouts:
  //  - "tiles": a phone held upright. Falling notes on top, the piano at the bottom,
  //    each note landing on its own key.
  //  - short screens (a phone held sideways): the full piano gets everything below the
  //    control row, measured from the real layout so nothing is ever cut off.
  //  - everything else: sheet music in the middle, the piano takes about 45% of the height.
  const tilesQuery = window.matchMedia(`(orientation: portrait) and (max-width: 700px) and ${TOUCH_DEVICE}`);
  // A real phone (touch screen, no mouse). Only then do we suggest turning it sideways.
  const phoneQuery = window.matchMedia(TOUCH_DEVICE);
  const topbar = $<HTMLElement>('.topbar');

  /** The visible screen height (on phones this excludes the browser's toolbars). */
  const screenHeight = () => window.visualViewport?.height ?? window.innerHeight;

  /** Room for the playing keys below the control row on a short (landscape) screen. */
  const keysRoomBelowTopbar = () => {
    const playStyle = getComputedStyle(playEl);
    const bottomPadding = parseFloat(playStyle.paddingBottom) || 0; // includes the home-bar safe area
    const rowGap = parseFloat(playStyle.rowGap) || 0;
    const body = $<HTMLElement>('.piano-body');
    const bodyStyle = getComputedStyle(body);
    const bodyChrome = (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
    const overview = body.querySelector<HTMLElement>('.overview');
    const overviewSpace = overview ? overview.offsetHeight + (parseFloat(getComputedStyle(overview).marginBottom) || 0) : 0;
    // With the controls hidden, the keys start right at the top padding.
    const top = playEl.dataset.chrome === 'hidden' ? parseFloat(playStyle.paddingTop) || 0 : topbar.getBoundingClientRect().bottom + rowGap;
    return screenHeight() - top - bottomPadding - bodyChrome - overviewSpace - 2;
  };

  /**
   * Upright phone: restart, the mode tabs and the play button live in a bar at the
   * bottom (thumb reach); the top keeps just the song and help. Otherwise they go
   * back into the top bar, in their usual order.
   */
  const dock = $<HTMLElement>('.dock');
  const tabsEl = $<HTMLElement>('.topbar .tabs');
  const controlsEl = $<HTMLElement>('.topbar .controls');
  const restartBtn = $<HTMLButtonElement>('#restart');
  const helpBtn = $<HTMLButtonElement>('#help');
  let hintShown = false;
  const placeControls = (inDock: boolean) => {
    if (inDock) dock.append(restartBtn, tabsEl, autoplayBtn);
    else {
      controlsEl.before(tabsEl);
      helpBtn.before(autoplayBtn, restartBtn); // hands · autoplay · restart · help
    }
  };

  const fitToScreen = () => {
    const tilesLayout = tilesQuery.matches;
    playEl.dataset.phone = String(phoneQuery.matches);
    const shortScreen = phoneQuery.matches && screenHeight() <= 520; // a phone held sideways
    const wasTiles = playEl.dataset.layout === 'tiles';
    if (tilesLayout !== wasTiles) placeControls(tilesLayout);
    if (tilesLayout && !hintShown) {
      // "Turn your phone for the full piano", for a few seconds, once per visit.
      hintShown = true;
      playEl.dataset.hint = 'on';
      window.setTimeout(() => delete playEl.dataset.hint, 4000);
    }
    playEl.dataset.layout = tilesLayout ? 'tiles' : 'wide';
    if (wasTiles && !tilesLayout) refreshTiles(); // turned sideways: stop the tiles clock
    keyboard.setTargetKeyWidth(keyWidthForScreen());
    keyboard.fillHeight = shortScreen && !tilesLayout; // sideways phone: keys fill the screen's height
    tiles.setKeys(tilesLayout ? keyGeometry : null);
    if (tilesLayout) keyboard.setMaxHeight(screenHeight() * 0.3);
    else if (shortScreen) keyboard.setMaxHeight(Math.max(90, keysRoomBelowTopbar()));
    else keyboard.setMaxHeight(Math.max(110, screenHeight() * 0.42 - 60));
    if (tilesLayout && !wasTiles) refreshTiles();
  };
  fitToScreen();
  keyboard.layoutNow(); // draw the keys before the first frame is shown

  /**
   * Re-fit whenever the screen changes. Turning a phone is caught three ways (the
   * orientation media query, the orientation event and the visible-area resize),
   * whichever fires first. Some iPhones report the old size at the very first signal,
   * so we check again twice in the next half-second; each check is cheap.
   */
  const refit = () => {
    fitToScreen();
    keyboard.layoutNow();
  };

  // ---- full screen: hide the top bar (and the bottom bar on an upright phone) so the
  // piano gets the whole screen. One small button in the corner brings them back.
  // Remembered for next time.
  const setControlsHidden = (hidden: boolean) => {
    if (hidden) playEl.dataset.chrome = 'hidden';
    else delete playEl.dataset.chrome;
    try {
      localStorage.setItem('magic-keys:controls-hidden', hidden ? '1' : '0');
    } catch {
      /* private browsing: just don't remember */
    }
    refit();
  };
  $('#hide-controls').addEventListener('click', () => setControlsHidden(true));
  $('#show-controls').addEventListener('click', () => setControlsHidden(false));
  try {
    if (localStorage.getItem('magic-keys:controls-hidden') === '1') setControlsHidden(true);
  } catch {
    /* ignore */
  }
  const refitAfterRotation = () => {
    refit();
    requestAnimationFrame(refit);
    window.setTimeout(refit, 150);
    window.setTimeout(refit, 450);
  };
  window.addEventListener('resize', refit);
  window.visualViewport?.addEventListener('resize', refit);
  tilesQuery.addEventListener('change', refitAfterRotation);
  phoneQuery.addEventListener('change', refit);
  window.addEventListener('orientationchange', refitAfterRotation);
  screen.orientation?.addEventListener('change', refitAfterRotation);

  // ---- instructions: full screen on the first visit, reopened with the "?" button
  const about = new AboutView();
  $('#about').addEventListener('click', () => {
    magic?.stopAutoplay();
    instructions.hide();
    about.show();
  });
  const instructions = new InstructionsCard(() => about.show());
  instructions.showIfFirstVisit();
  $('#help').addEventListener('click', () => instructions.show());

  const computerKeys = new ComputerKeys({
    onPress: press,
    onRelease: release,
    onSustain: sustain,
    onOctave: (base) => keyboard.centerOn(base + 16),
    onOtherKey: (code, down) => {
      if (!down || isControlKey(code)) return false;
      // Magic mode: literally any key plays the next note (letters, numbers, Enter …).
      if (mode === 'magic') {
        magicPress(0.72);
        return true;
      }
      // "Press any key to start": any key closes the instructions page.
      instructions.hide();
      return false;
    },
  });

  /**
   * Learn mode labels each glowing key with its computer key. The computer keyboard
   * covers 2½ octaves, so if the next notes fall outside it we quietly move the
   * whole mapping up or down an octave; the labels always show the right key.
   * Whenever the notes fit the usual position (Z = C3) we go back to it, so the
   * same note keeps the same key as much as possible.
   */
  const HOME_BASE = 48;
  const learnShortcut = (midi: number, chord: number[]): string | null => {
    if (phoneQuery.matches) return null; // a touch screen has no computer keys to show
    const fits = (base: number) => chord.every((m) => m - base >= 0 && m - base <= 31);
    if (fits(HOME_BASE)) computerKeys.baseMidi = HOME_BASE;
    else if (!fits(computerKeys.baseMidi)) {
      // Try the octaves closest to home first, so the keys move as little as possible.
      for (const base of [36, 60, 24, 72, 84]) {
        if (fits(base)) {
          computerKeys.baseMidi = base;
          break;
        }
      }
    }
    return computerKeys.shortcutFor(midi);
  };

  void connectMidi({ onPress: press, onRelease: release, onSustain: sustain });

  setMode('magic');
  loadSong('fur-elise').then(openSong, (err) => console.warn(err));
  void restoreYourSongs(); // bring back recordings and uploads saved on this device
  return keyboard;
}

/**
 * Phones: the app is a fixed instrument, so it never zooms. The viewport tag asks
 * for that, but iOS Safari ignores it, so pinch gestures are blocked here too
 * (double-tap zoom is turned off in CSS with touch-action: manipulation).
 */
for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(gesture, (e) => e.preventDefault(), { passive: false });
}
// Double-tap zoom, belt and braces: a second tap within 350 ms never zooms. If that
// second tap was on a button, it still counts as a click.
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = e.timeStamp;
    const quick = now - lastTouchEnd < 350;
    lastTouchEnd = now;
    if (!quick || e.touches.length > 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.keyboard-keys, .tiles, input, textarea, select')) return; // these handle their own touches
    e.preventDefault();
    target.closest<HTMLElement>('button, a, [role="button"], [role="tab"], label')?.click();
  },
  { passive: false },
);
// Newer iPhones also turn a double-tap into a "double click" and zoom unless it's stopped.
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1 && !(e.target as HTMLElement).closest('.keyboard-keys, .tiles')) e.preventDefault();
  },
  { passive: false },
);

/**
 * Keep the piano on the device for instant repeat visits and offline play.
 * Production only: in development a cache would hide code changes.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL; // "/" locally, "/magic-keys/" on GitHub Pages
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      /* not fatal: the app works the same, just without the offline cache */
    });
  });
}

/**
 * Show the app only once Resoomie Sans is ready and the keys are drawn, so the first
 * frame is already final: no flash of a backup font, no keys popping in on reload.
 * The files are tiny and preloaded in index.html, so this takes a few milliseconds;
 * the 1.5s cap means a slow network can never keep the piano hidden.
 */
async function revealWhenReady(keyboard: KeyboardView): Promise<void> {
  const weights = ['400', '500', '600'];
  const fontsLoaded = Promise.all(weights.map((w) => document.fonts.load(`${w} 1em "Resoomie Sans"`)));
  const cap = new Promise((resolve) => setTimeout(resolve, 1500));
  await Promise.race([Promise.all([fontsLoaded, keyboard.laidOut]), cap]).catch(() => {});
  app.classList.add('is-ready');
}

void revealWhenReady(start());

