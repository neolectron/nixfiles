import { Effect, Ref, Schema } from 'effect';
import * as Bindings from '../bindings.ts';
import * as Plugin from '../plugin.ts';
import { PluginHost } from '../plugin-host.ts';
import { StreamDeck } from '../stream-deck.ts';
import type { DialRotate } from '../model.ts';

interface Counter { readonly add: (amount: number) => Effect.Effect<void> }
const add = Plugin.action({ id: 'add', name: 'Add', description: 'Increment the demo counter.',
  input: Schema.Struct({ amount: Schema.Int }), defaults: { amount: 1 }, run: (api: Counter, input) => api.add(input.amount) });
const hold = Plugin.action({ id: 'hold', name: 'Hold', description: 'Log a simulated hold; no microphone is opened.',
  input: Plugin.NoInput, defaults: {}, interaction: 'hold', run: (_api: Counter, _input, context) => Effect.log('Hold started').pipe(
    Effect.andThen(context.released!), Effect.ensuring(Effect.log('Hold stopped')),
  ) });

const example = Plugin.define({ id: 'gesture-example', name: 'Gesture example', description: 'Shared actions, gestures, dials and touch.',
  controls: (deck) => ({ keys: deck.buttons.slice(0, 2).map((key) => key.index), dials: deck.dials.slice(0, 1).map((dial) => dial.index), lcds: deck.lcds.slice(0, 1).map((lcd) => lcd.index) }),
  actions: [add, hold], setup: Effect.gen(function*() {
    const deck = yield* StreamDeck; const count = yield* Ref.make(0);
    const api: Counter = { add: (amount) => Ref.updateAndGet(count, (n) => n + amount).pipe(Effect.flatMap((value) => Effect.log(`Counter: ${value}`))) };
    const binding = yield* Bindings.start({ buttons: {
      0: { label: '1 / 10 / 100', onShortPress: Plugin.handler(add, api), onLongPress: Plugin.handler(add, api, { amount: 10 }), onDoubleTap: Plugin.handler(add, api, { amount: 100 }) },
      1: { label: 'HOLD', onPress: Plugin.handler(hold, api) },
    }, knobs: deck.dials.length ? { 0: {
      onShortPress: Plugin.handler(add, api), onLongPress: Plugin.handler(add, api, { amount: 10 }), onDoubleTap: Plugin.handler(add, api, { amount: 100 }),
      onRotate: Plugin.mapHandler(add, api, (event: DialRotate) => ({ amount: event.delta })),
    } } : {}, touch: deck.lcds.length ? { 0: {
      onTap: Plugin.handler(add, api), onHold: Plugin.handler(add, api, { amount: 10 }), onSwipe: Plugin.handler(add, api, { amount: 100 }),
    } } : {} });
    return { api, run: binding.run };
  }) });

/** Business actions contain no input routing, timers, USB or editor code. */
export const gestures = Effect.gen(function*() {
  const host = yield* PluginHost; const deck = yield* StreamDeck;
  const handle = yield* host.install(example); yield* host.setEnabled(handle.id, true);
  yield* deck.awaitFailure;
}).pipe(Effect.provide(PluginHost.layer));
