/**
 * Feature switches. A feature that's off doesn't show anywhere in the app.
 *
 * For testing, add `?features=listen,duet` to the address to turn features on for
 * that visit only.
 */
const DEFAULTS = {
  /** Record a song by singing or playing into the microphone. Off until it's fixed. */
  listen: false,
  /** Two players at one piano: one plays the right hand, the other the left. */
  duet: false,
};

export type Feature = keyof typeof DEFAULTS;

const fromAddress = new Set(
  (new URLSearchParams(location.search).get('features') ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean),
);

export function isOn(feature: Feature): boolean {
  return DEFAULTS[feature] || fromAddress.has(feature);
}
