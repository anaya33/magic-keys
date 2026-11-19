/**
 * InstructionsCard — a full-screen "how to play" page shown over the piano.
 *
 * It appears only on the first visit (so it never gets in the way of returning
 * players), closes with the ✕, Esc, or simply by playing a key, and comes back
 * from the "?" button. Remembering that it was closed is a per-browser convenience,
 * so if storage is blocked (private mode) it just shows again next time.
 */
const SEEN_KEY = 'magic-keys:instructions-seen';

import { isOn } from '../features';
export class InstructionsCard {
  private el: HTMLDivElement;

  constructor(onAbout: () => void) {
    const touch = window.matchMedia('(hover: none)').matches;
    this.el = document.createElement('div');
    this.el.className = 'panel instructions';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'instructions-title');
    this.el.innerHTML = `
      <button class="close-btn" aria-label="Close instructions"><span></span><span></span></button>
      <div class="instructions-body">
        <h2 class="instructions-title" id="instructions-title">How to play</h2>
        <ol class="steps">
          <li><span class="step-num">1</span><span>${
            touch ? 'Tap any key' : 'Press any key'
          }. The magic fingers play Für Elise, one note at a time, at your pace.</span></li>
          <li><span class="step-num">2</span><span>Press <strong>Autoplay</strong> to hear it all, or open <strong>Learn</strong> and play it yourself: the glowing key shows what to press next.</span></li>
          <li><span class="step-num">3</span><span><strong>Free play</strong> is your own piano${
            touch ? '.' : ': <kbd>Z</kbd> to <kbd>/</kbd> and <kbd>Q</kbd> to <kbd>]</kbd>, with <kbd>Space</kbd> for the pedal.'
          }</span></li>
          <li><span class="step-num">4</span><span>Tap the song name at the top to pick another piece or upload sheet music${isOn('listen') ? ', or <strong>record your own</strong> with Listen' : ''}.</span></li>
        </ol>
        <p class="instructions-foot">${touch ? 'Tap ✕ to start' : 'Press any key to start'} · <button class="link-btn" id="about-link">About Magic Keys</button></p>
      </div>`;
    document.body.append(this.el);
    this.el.querySelector('.close-btn')!.addEventListener('click', () => this.hide());
    this.el.querySelector('#about-link')!.addEventListener('click', () => {
      this.hide();
      onAbout();
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  showIfFirstVisit(): void {
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      /* storage blocked: just show it */
    }
    if (!seen) this.show();
  }

  show(): void {
    this.el.hidden = false;
  }

  hide(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* fine: it will show again next time */
    }
  }
}
