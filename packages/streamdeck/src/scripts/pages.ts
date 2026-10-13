import { Effect } from 'effect';
import { Bindings, StreamDeck, type StreamDeckError } from '../index.js';

/** A page is just behavior + feedback; switching can come from any Effect. */
export const pages = Effect.scoped(Effect.gen(function*() {
  const deck = yield* StreamDeck;
  const switchTo = (name: 'home' | 'tools'): Effect.Effect<void, StreamDeckError> => Effect.suspend(() => controller.select(name));
  const controller = yield* Bindings.pages({
    home: { buttons: {
      0: { label: 'TOOLS', onPress: () => switchTo('tools') },
      1: { label: 'HELLO', onPress: Effect.log('Home action') },
    } },
    tools: { buttons: {
      0: { label: 'BACK', onPress: () => switchTo('home') },
      2: { label: 'ACTION', onPress: Effect.log('Tools action') },
    } },
  }, 'home');
  if (deck.lcds.length) yield* deck.lcd(0).label('PRESS TOOLS');
  yield* controller.run;
}));
