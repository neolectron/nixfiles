import { Context, Effect, Layer, Ref, Stream } from 'effect';
import { createElement as h } from 'react';
import * as Plugin from '../plugin.ts';
import { DeckDisplay } from '../display.ts';
import { StreamDeck } from '../stream-deck.ts';

/** Any source of strings: SDK callbacks, PubSub, HTTP/SSE, socket events or polling. */
export const make = <E, R>(source: Stream.Stream<string, E, R>, key = 0) => Effect.gen(function*() {
  const display = Context.get(yield* Layer.build(DeckDisplay.layer), DeckDisplay); const deck = yield* StreamDeck;
  const events = yield* deck.subscribe;
  const state = yield* Ref.make({ message: 'Waiting', presses: 0 });
  const redraw = Effect.gen(function*() {
    const value = yield* Ref.get(state);
    yield* display.key(key, h('div', { style: { width: '100%', height: '100%', background: '#252830', color: '#ecc589', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Liberation Sans', padding: 8 } },
      h('div', { style: { fontSize: 15, fontWeight: 700 } }, value.message.slice(0, 24)), h('div', { style: { fontSize: 12, marginTop: 8, color: '#e2e3e8' } }, `${value.presses} presses`)));
  });
  const update = (message: string) => Ref.update(state, (value) => ({ ...value, message })).pipe(Effect.andThen(redraw));
  const increment = Ref.update(state, (value) => ({ ...value, presses: value.presses + 1 })).pipe(Effect.andThen(redraw));
  yield* redraw;
  return { state: Ref.get(state), update, increment,
    run: Stream.runForEach(Stream.merge(source.pipe(Stream.map((message) => ({ kind: 'source' as const, message }))), events.pipe(Stream.filter((event) => event._tag === 'KeyDown' && event.key === key), Stream.map(() => ({ kind: 'press' as const })))),
      (event) => event.kind === 'press' ? increment : update(event.message)),
  };
 });
export const plugin = <E, R>(source: Stream.Stream<string, E, R>, key = 0) => Plugin.define({
  id: 'event-display', name: 'Exemple : événements', description: 'Un tick par seconde, une vue React et un compteur d’appuis.', controls: { keys: [key] },
  setup: Effect.gen(function*() { const controller = yield* make(source, key); const { run, ...api } = controller; return { api, run }; }),
});
