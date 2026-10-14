import { Context, Effect, Layer, Option, Ref, Stream } from 'effect';
import type { Size } from '../model.ts';
import type { ReactElement } from 'react';
import * as Plugin from '../plugin.ts';
import { StreamDeck } from '../stream-deck.ts';
import { DeckDisplay } from '../display.ts';

interface Options<State, E, R> {
  readonly id: string; readonly name: string; readonly description?: string;
  readonly source: Stream.Stream<State, E, R>; readonly view: (state: State, size: Size) => ReactElement;
  readonly frameMillis?: number;
}
const make = <State, E, R>(target: { readonly key: number } | { readonly lcd: number }, options: Options<State, E, R>) => Plugin.define({
  id: options.id, name: options.name, description: options.description ?? '', controls: 'key' in target ? { keys: [target.key] } : { lcds: [target.lcd] },
  setup: Effect.gen(function*() {
    const deck = yield* StreamDeck;
    yield* ('key' in target ? deck.key(target.key).clear : deck.lcd(target.lcd).clear);
    const display = Context.get(yield* Layer.build(DeckDisplay.layer), DeckDisplay);
    const state = yield* Ref.make<Option.Option<State>>(Option.none());
    const source = options.source.pipe(Stream.tap((value) => Ref.set(state, Option.some(value))));
    const timing = options.frameMillis === undefined ? {} : { frameMillis: options.frameMillis };
    return { api: { state: Ref.get(state) }, run: 'key' in target ? display.watchKey(target.key, source, options.view, timing) : display.watchLcd(target.lcd, source, options.view, timing) };
  }),
});
export const key = <State, E, R>(index: number, options: Options<State, E, R>) => make({ key: index }, options);
export const lcd = <State, E, R>(index: number, options: Options<State, E, R>) => make({ lcd: index }, options);
