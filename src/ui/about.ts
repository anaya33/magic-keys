/**
 * AboutView — what Magic Keys is, and the privacy promise behind it.
 * Opened from the logo in the top bar, or from the How to play page.
 */
export class AboutView {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'panel about';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'about-title');
    this.el.innerHTML = `
      <button class="close-btn" aria-label="Close About"><span></span><span></span></button>
      <div class="panel-body about-body">
        <img class="about-icon" src="${import.meta.env.BASE_URL}icons/icon-192.png" alt="" width="96" height="96" />
        <h2 class="panel-title" id="about-title">Magic Keys</h2>
        <p class="about-lead">A piano that makes anyone feel like a pianist. Press any key and the magic fingers play real music. When you're ready, Learn mode teaches it to you, note by note.</p>

        <h3 class="about-heading">Local-first and private</h3>
        <ul class="about-points">
          <li><span class="about-dot"></span><span><strong>Everything runs on your device.</strong> The piano, the sheet music and the music recognition all work inside your browser. There is no server.</span></li>
          <li><span class="about-dot"></span><span><strong>No accounts, no tracking.</strong> No sign-up, no analytics, no cookies, no ads.</span></li>
          <li><span class="about-dot"></span><span><strong>Your recordings stay yours.</strong> Listen turns audio into notes right here; the audio is never uploaded or kept. Your songs are saved only in this browser, and you can delete them any time.</span></li>
          <li><span class="about-dot"></span><span><strong>Works offline.</strong> After your first visit, the piano is kept on your device.</span></li>
        </ul>

        <h3 class="about-heading">Made with</h3>
        <ul class="about-credits">
          <li>The <strong>Salamander Grand Piano</strong> samples by Alexander Holm (CC BY 3.0), played with <strong>Tone.js</strong></li>
          <li>Sheet music drawn by <strong>OpenSheetMusicDisplay</strong></li>
          <li>Listen mode by Spotify's <strong>Basic Pitch</strong> (Apache 2.0)</li>
          <li>Song encodings from the <strong>PDMX</strong> public-domain collection, released as CC0 by their uploaders</li>
          <li>Set in <strong>Resoomie Sans</strong>, based on Figtree (SIL Open Font License)</li>
        </ul>
      </div>`;
    document.body.append(this.el);
    this.el.querySelector('.close-btn')!.addEventListener('click', () => this.hide());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.hide();
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.el.hidden = false;
    this.el.scrollTop = 0;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
