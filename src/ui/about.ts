/**
 * AboutView — what Magic Keys is, its modes, and credits.
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
        <img class="about-icon" src="${import.meta.env.BASE_URL}icons/piano-icon-192.png?v=3" alt="" width="96" height="96" />
        <h2 class="panel-title" id="about-title">Magic Keys</h2>
        <p class="about-lead">Magic Keys is a piano. Press any key and it plays real songs.</p>

        <ul class="about-points">
          <li><span class="about-dot"></span><span><strong>Magic.</strong> Any key plays the next note of the song. Autoplay plays it all for you.</span></li>
          <li><span class="about-dot"></span><span><strong>Learn.</strong> The next key lights up. The song moves on when you press it.</span></li>
          <li><span class="about-dot"></span><span><strong>Free play.</strong> A normal piano.</span></li>
          <li><span class="about-dot"></span><span><strong>Listen.</strong> Play or hum something, and it becomes a song.</span></li>
        </ul>

        <h3 class="about-heading">Credits</h3>
        <ul class="about-credits">
          <li><strong>Salamander Grand Piano</strong> samples by Alexander Holm (CC BY 3.0)</li>
          <li><strong>OpenSheetMusicDisplay</strong>, Spotify's <strong>Basic Pitch</strong>, <strong>Tone.js</strong></li>
          <li>Songs from <strong>PDMX</strong> (CC0)</li>
          <li>Font: <a href="https://resoomie.com" target="_blank" rel="noopener">Resoomie</a> Sans</li>
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
