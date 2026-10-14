import type { Snapshot } from './studio-contract.ts';

/** Pixel refreshes are hardware metadata, not changes to declarative web state. */
export const webSnapshot = (snapshot: Snapshot): Snapshot => ({
  ...snapshot,
  keys: snapshot.keys.map((key) => (key.binding ? { ...key, revision: 0 } : key)),
  lcds: snapshot.lcds.map((lcd) => (lcd.scene ? { ...lcd, revision: 0 } : lcd)),
});
