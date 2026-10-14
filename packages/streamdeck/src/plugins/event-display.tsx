import { Context, Effect, Layer, Ref, Semaphore, Stream } from 'effect';
import * as Plugin from '../plugin.ts';
import { DeckDisplay } from '../display.ts';
import * as Bindings from '../bindings.ts';
/** Any source of strings: SDK callbacks, PubSub, HTTP/SSE, socket events or polling. */
export const make = <E, R>(source: Stream.Stream<string, E, R>, key = 0) =>
  Effect.gen(function* () {
    const display = Context.get(yield* Layer.build(DeckDisplay.layer), DeckDisplay);
    const lock = yield* Semaphore.make(1);
    const state = yield* Ref.make({ message: 'Waiting', presses: 0 });
    const redraw = Effect.gen(function* () {
      const value = yield* Ref.get(state);
      yield* display.key(
        key,
        <div
          style={{
            width: '100%',
            height: '100%',
            background: '#252830',
            color: '#ecc589',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Liberation Sans',
            padding: 8,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700 }}>{value.message.slice(0, 24)}</div>
          <div
            style={{ fontSize: 12, marginTop: 8, color: '#e2e3e8' }}
          >{`${value.presses} presses`}</div>
        </div>,
      );
    });
    const update = (message: string) =>
      Semaphore.withPermits(
        lock,
        1,
      )(Ref.update(state, (value) => ({ ...value, message })).pipe(Effect.andThen(redraw)));
    const increment = Semaphore.withPermits(
      lock,
      1,
    )(
      Ref.update(state, (value) => ({ ...value, presses: value.presses + 1 })).pipe(
        Effect.andThen(redraw),
      ),
    );
    const binding = yield* Bindings.start({
      buttons: { [key]: { onPress: increment } },
      render: redraw,
    });
    return {
      state: Ref.get(state),
      update,
      increment,
      run: Effect.all([Plugin.listen(source, update), binding.run], { concurrency: 'unbounded' }),
    };
  });
export const plugin = <E, R>(source: Stream.Stream<string, E, R>, key = 0) =>
  Plugin.define({
    id: 'event-display',
    name: 'Exemple : événements',
    description: 'Un tick par seconde, une vue React et un compteur d’appuis.',
    controls: { keys: [key] },
    setup: Effect.gen(function* () {
      const controller = yield* make(source, key);
      const { run, ...api } = controller;
      return { api, run };
    }),
  });
