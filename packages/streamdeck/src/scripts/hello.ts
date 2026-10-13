import { Effect, Ref } from 'effect';
import type { DeckEvent } from '../model.ts';
import * as Bindings from '../bindings.ts';
import { StreamDeck } from '../stream-deck.ts';
import { StreamDeckError } from '../errors.ts';

/** Example behavior. All USB lifecycle and rendering live in the library. */
export const startHello = (drawLcd = false, onEvent: (event: DeckEvent) => Effect.Effect<void> = (event) => Effect.log(JSON.stringify(event))) => Effect.gen(function*() {
  const deck = yield* StreamDeck;
  const key = deck.buttons.find((control) => control.feedbackType === 'lcd' && control.pixelSize)?.index;
  if (key === undefined) return yield* Effect.fail(new StreamDeckError({ reason: 'Unsupported', operation: 'hello', message: 'This model has no LCD key; use events.' }));
  const state = yield* Ref.make({ pressed: false, level: 50 });
  const draw = Effect.gen(function*() {
    const { pressed, level } = yield* Ref.get(state);
    const options = { level, background: pressed ? [28, 140, 66] as const : [20, 45, 105] as const };
    yield* deck.key(key).label(pressed ? 'OK' : 'HELLO', options);
    if (drawLcd) yield* deck.lcd(deck.lcds[0]?.index ?? 0).label(pressed ? 'OK' : 'HELLO', options);
  });
  const binding = yield* Bindings.start({
    buttons: { [key]: {
      onPress: Ref.update(state, (s) => ({ ...s, pressed: true })).pipe(Effect.andThen(draw)),
      onRelease: Ref.update(state, (s) => ({ ...s, pressed: false })).pipe(Effect.andThen(draw)),
    } },
    knobs: Object.fromEntries(deck.dials.map(({ index }) => [index, {
      onRotate: ({ delta }: import('../model.ts').DialRotate) => Ref.update(state, (s) => ({ ...s, level: Math.min(100, Math.max(0, s.level + delta)) })).pipe(Effect.andThen(draw)),
    }])),
    onEvent, render: draw,
  });
  return { run: binding.run, state: Ref.get(state) };
});
export const hello = (drawLcd = false) => Effect.scoped(Effect.flatMap(startHello(drawLcd), ({ run }) => run));
