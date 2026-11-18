/**
 * A small, flat celebration for finishing a song in Learn mode:
 * a short shower of geometric confetti (circles, squares, bars in the app's colours)
 * and a card with a "Play again" button.
 *
 * Kept light on purpose: 36 shapes, one CSS animation each, everything removed
 * after 2 seconds. Skipped entirely for people who prefer reduced motion.
 */
const COLORS = ['#87D0FB', '#5FB3E0', '#33322D', '#F3EEE3', '#DDD5C4'];
const SHAPES = ['dot', 'square', 'bar'];

export function celebrate(message: string, onAgain: () => void): void {
  document.querySelector('.celebration')?.remove();
  const layer = document.createElement('div');
  layer.className = 'celebration';

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (let i = 0; i < 36; i++) {
      const bit = document.createElement('span');
      bit.className = `confetti confetti-${SHAPES[i % SHAPES.length]}`;
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.background = COLORS[i % COLORS.length];
      bit.style.animationDelay = `${Math.random() * 0.35}s`;
      bit.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
      bit.style.setProperty('--spin', `${(Math.random() - 0.5) * 540}deg`);
      layer.append(bit);
    }
    window.setTimeout(() => layer.querySelectorAll('.confetti').forEach((c) => c.remove()), 2000);
  }

  const card = document.createElement('div');
  card.className = 'celebration-card';
  card.setAttribute('role', 'status');
  const title = document.createElement('p');
  title.className = 'celebration-title';
  title.textContent = message;
  const again = document.createElement('button');
  again.className = 'pill-btn';
  again.textContent = 'Play again';
  again.addEventListener('click', () => {
    layer.remove();
    onAgain();
  });
  card.append(title, again);
  layer.append(card);
  document.body.append(layer);

  // Any key or tap also closes it.
  const close = () => {
    layer.remove();
    window.removeEventListener('keydown', close);
  };
  window.addEventListener('keydown', close);
  layer.addEventListener('pointerdown', (e) => {
    if (e.target === layer) close();
  });
}
