import { Effect, Layer, Option, Path, Schema } from 'effect';
import { PersistentState } from '@nixfiles/system-control/persistent-state.ts';
import * as FileStorage from '@nixfiles/system-control/state-storage-file.ts';
import { mergeDiscordPreferences } from './studio-profile-migrations.ts';

const Settings = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Record(Schema.String, Schema.Boolean),
});
/** Separate from key layout; unknown plugin preferences survive each mutation. */
export const makeWithState = (key: string) =>
  Effect.gen(function* () {
    const document = (yield* PersistentState).document(key, Settings);
    const loaded = Option.getOrUndefined(yield* document.get)?.enabled ?? {};
    const initial = mergeDiscordPreferences(loaded);
    if (initial !== loaded)
      yield* document.modify((value) =>
        Effect.succeed({
          version: 1,
          enabled: mergeDiscordPreferences(Option.getOrUndefined(value)?.enabled ?? {}),
        }),
      );
    return {
      initial,
      save: (id: string, enabled: boolean) =>
        document
          .modify((value) =>
            Effect.succeed({
              version: 1,
              enabled: { ...(Option.getOrUndefined(value)?.enabled ?? initial), [id]: enabled },
            }),
          )
          .pipe(Effect.asVoid),
    };
  });
export const make = (file: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const services = yield* Layer.build(
      PersistentState.layer.pipe(Layer.provide(FileStorage.layer(path.dirname(file)))),
    );
    return yield* makeWithState(path.basename(file)).pipe(Effect.provideContext(services));
  });
