import { Effect, Ref } from 'effect';
import * as Bindings from '../bindings.ts';
import { StreamDeck } from '../stream-deck.ts';

/** Edit only this file to experiment. No real OS / microphone / recording actions. */
export const playground = Effect.gen(function*() {
  const deck = yield* StreamDeck;
  const level = yield* Ref.make(50);
  const drawLevel = Effect.gen(function*() {
    const value = yield* Ref.get(level);
    yield* deck.key(0).label(String(value), { level: value });
    if (deck.lcds.length) yield* deck.lcd(0).label(`LEVEL ${value}`, { level: value });
  });
  yield* Bindings.run({
    buttons: {
      0: { label: 'HELLO', onPress: deck.key(0).label('PRESSED'), onRelease: drawLevel },
      1: { label: 'RESET', onPress: Ref.set(level, 50).pipe(Effect.andThen(drawLevel)) },
    },
    knobs: deck.dials.length ? { 0: {
      onRotate: ({ delta }) => Ref.update(level, (n) => Math.max(0, Math.min(100, n + delta))).pipe(Effect.andThen(drawLevel)),
      onPress: Effect.log('Knob clicked'),
    } } : {},
    touch: deck.lcds.length ? { 0: [
      { area: { x: 0, y: 0, width: Math.floor(deck.lcds[0]!.pixelSize!.width / 2), height: deck.lcds[0]!.pixelSize!.height }, onTap: Effect.log('Left touch zone') },
      { onTap: Effect.log('Right touch zone'), onSwipe: ({ from, to }) => Effect.log('Swipe', from, to), onHold: Effect.log('Touch held') },
    ] } : {},
    render: drawLevel,
  });
});
