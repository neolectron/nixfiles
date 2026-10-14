import {
  Cause,
  Context,
  Data,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Scope,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { invalid, invariant } from './errors.ts';
import { StreamDeck, type Device } from './stream-deck.ts';
import type { DeckEvent, Size } from './model.ts';
import type { ActionInfo, Invocation, Controls, Definition } from './plugin.ts';
import { failureMessage } from './failure-message.ts';
import { KeyFeedback } from './key-feedback.ts';
import * as Overlays from './deck-overlays.ts';
import type { RgbImage } from './image.ts';
import { View } from './presentation.tsx';
import { supports } from './tile-capabilities.ts';
export class PluginError extends Data.TaggedError('PluginError')<{
  readonly id: string;
  readonly message: string;
  readonly status: number;
  readonly reason: 'Conflict' | 'Disabled' | 'Unsupported' | 'Failed' | 'Unknown';
}> {}
export interface Status {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly phase: 'enabled' | 'disabled' | 'error' | 'unsupported';
  readonly detail: string;
  readonly keys: ReadonlyArray<number>;
  readonly dials: ReadonlyArray<number>;
  readonly lcds: ReadonlyArray<number>;
}
export interface Handle<Api> {
  readonly id: string;
  readonly current: Effect.Effect<Option.Option<Api>>;
  /** Calls run in the plugin's scope: disabling cancels work still in flight. */
  readonly use: <A, E, R>(
    f: (api: Api) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    A,
    E | PluginError,
    Exclude<Exclude<Exclude<R, StreamDeck>, Overlays.DeckOverlays>, Scope.Scope>
  >;
}
const error = (id: string, reason: PluginError['reason'], message: string) =>
  new PluginError({ id, reason, message, status: reason === 'Failed' ? 500 : 409 });
const owns = (controls: Controls, event: DeckEvent) =>
  event._tag === 'KeyDown' || event._tag === 'KeyUp' || event._tag === 'KeyCancel'
    ? (controls.keys?.includes(event.key) ?? false)
    : event._tag === 'DialDown' ||
        event._tag === 'DialUp' ||
        event._tag === 'DialRotate' ||
        event._tag === 'DialCancel'
      ? (controls.dials?.includes(event.dial) ?? false)
      : (controls.lcds?.includes(event.lcd) ?? false);
/** A revocable view, sharing the one physical connection and its serialized writes. */
const ownedDevice = (deck: Device, controls: Controls, active: () => boolean): Device => {
  const guard = <A>(
    effect: Effect.Effect<A, import('./errors.ts').StreamDeckError>,
    allowed = true,
  ) =>
    Effect.suspend(() =>
      active() && allowed
        ? effect
        : Effect.fail(invalid('plugin', 'Plugin disabled or control not owned.')),
    );
  const key = (index: number) => {
    const original = deck.key(index);
    const allowed = controls.keys?.includes(index) ?? false;
    return {
      setImage: (image: Parameters<typeof original.setImage>[0]) =>
        guard(original.setImage(image), allowed),
      label: (text: string, options?: Parameters<typeof original.label>[1]) =>
        guard(original.label(text, options), allowed),
      fill: (color: Parameters<typeof original.fill>[0]) => guard(original.fill(color), allowed),
      clear: guard(original.clear, allowed),
    };
  };
  const lcd = (index: number) => {
    const original = deck.lcd(index);
    const allowed = controls.lcds?.includes(index) ?? false;
    return {
      setImage: (image: Parameters<typeof original.setImage>[0]) =>
        guard(original.setImage(image), allowed),
      label: (text: string, options?: Parameters<typeof original.label>[1]) =>
        guard(original.label(text, options), allowed),
      fill: (color: Parameters<typeof original.fill>[0]) => guard(original.fill(color), allowed),
      clear: guard(original.clear, allowed),
      drawRegion: (
        position: Parameters<typeof original.drawRegion>[0],
        image: Parameters<typeof original.drawRegion>[1],
      ) => guard(original.drawRegion(position, image), allowed),
    };
  };
  const buttons = deck.buttons.filter((control) => controls.keys?.includes(control.index));
  const dials = deck.dials.filter((control) => controls.dials?.includes(control.index));
  const lcds = deck.lcds.filter((control) => controls.lcds?.includes(control.index));
  const subscribe = Effect.map(deck.subscribe, (events) =>
    events.pipe(Stream.filter((event) => owns(controls, event))),
  );
  return {
    ...deck,
    info: { ...deck.info, controls: [...buttons, ...dials, ...lcds] },
    buttons,
    dials,
    lcds,
    key,
    lcd,
    subscribe,
    events: Stream.unwrap(subscribe),
    setBrightness: () => Effect.fail(invalid('plugin', 'Brightness belongs to the host.')),
    resetToLogo: Effect.fail(invalid('plugin', 'Device reset belongs to the host.')),
  };
};
export const make = Effect.gen(function* () {
  const deck = yield* StreamDeck;
  const overlays = yield* Overlays.make(deck.buttons.map((key) => key.index));
  const owner = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  type Record = {
    status: Status;
    set: (enabled: boolean) => Effect.Effect<void, PluginError>;
    stop: Effect.Effect<void>;
    actions: ReadonlyArray<ActionInfo>;
    validate: (action: string, input: unknown) => Effect.Effect<void, PluginError>;
    invoke: (
      action: string,
      input: unknown,
      context: Invocation,
    ) => Effect.Effect<unknown, PluginError>;
    feedback?: (action: string, input: unknown) => Effect.Effect<KeyFeedback | null>;
    lcd?: (
      action: string,
      input: unknown,
      size: Size,
    ) => Effect.Effect<{ view: View; image: RgbImage } | undefined, PluginError>;
  };
  const records = new Map<string, Record>();
  let revision = 0;
  const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Semaphore.withPermits(lock, 1)(effect);
  const clear = (controls: Controls) =>
    Effect.forEach(
      [
        ...(controls.keys ?? [])
          .filter(
            (index) => deck.buttons.find((key) => key.index === index)?.feedbackType === 'lcd',
          )
          .map((index) => deck.key(index).clear),
        ...(controls.lcds ?? []).map((index) => deck.lcd(index).clear),
      ],
      (effect) =>
        effect.pipe(
          Effect.catch((cause) => Effect.logWarning('Plugin feedback cleanup', cause.message)),
        ),
      { discard: true },
    );
  yield* Effect.addFinalizer(() =>
    locked(Effect.forEach(records.values(), (record) => record.stop, { discard: true })),
  );
  const install = <Api, E, R>(definition: Definition<Api, E, R>) =>
    Effect.gen(function* () {
      const context =
        yield* Effect.context<
          Exclude<Exclude<Exclude<R, StreamDeck>, Overlays.DeckOverlays>, Scope.Scope>
        >();
      return yield* locked(
        Effect.gen(function* () {
          if (!/^[a-z][a-z0-9.-]*$/.test(definition.id) || records.has(definition.id))
            return yield* Effect.fail(
              error(
                definition.id,
                'Conflict',
                'Plugin ID must be unique and use lowercase letters, numbers, dots or hyphens.',
              ),
            );
          const controls =
            typeof definition.controls === 'function'
              ? definition.controls(deck)
              : definition.controls;
          for (const [kind, indices, available] of [
            ['key', controls.keys, deck.buttons],
            ['dial', controls.dials, deck.dials],
            ['lcd', controls.lcds, deck.lcds],
          ] as const) {
            if (indices?.some((index) => !available.some((control) => control.index === index)))
              return yield* Effect.fail(
                error(definition.id, 'Unsupported', `Unknown ${kind} control.`),
              );
          }
          const declared = definition.actions ?? [];
          if (
            new Set(declared.map((action) => action.info.id)).size !== declared.length ||
            declared.some((action) => !/^[a-z][a-z0-9.-]*$/.test(action.info.id))
          )
            return yield* Effect.fail(
              error(definition.id, 'Conflict', 'Action IDs must be unique within the plugin.'),
            );
          for (const action of declared)
            yield* action
              .validate(action.info.defaults)
              .pipe(
                Effect.mapError((cause) =>
                  error(
                    definition.id,
                    'Failed',
                    `Invalid defaults for ${action.info.id}: ${String(cause)}`,
                  ),
                ),
              );
          for (const action of declared) {
            const tile = action.info.tile;
            if (
              tile &&
              ((tile.width !== undefined &&
                (!Number.isSafeInteger(tile.width) || tile.width < 40 || tile.width > 8192)) ||
                (tile.surfaces &&
                  (!tile.surfaces.length ||
                    tile.surfaces.some((surface) => surface !== 'key' && surface !== 'lcd'))))
            )
              return yield* Effect.fail(
                error(definition.id, 'Failed', `Invalid tile metadata for ${action.info.id}.`),
              );
          }
          let scope: Scope.Closeable | undefined;
          let api:
            | {
                readonly value: Api;
                readonly device: Device;
                readonly presentations: Overlays.Controller;
              }
            | undefined;
          let active = false;
          let cleanupDetail = '';
          const supported = definition.supported?.(deck) ?? true;
          const record: Record = {
            status: {
              id: definition.id,
              name: definition.name,
              description: definition.description,
              enabled: false,
              phase: supported ? 'disabled' : 'unsupported',
              detail: supported ? '' : 'Ce modèle ne possède pas les contrôles nécessaires.',
              keys: controls.keys ?? [],
              dials: controls.dials ?? [],
              lcds: controls.lcds ?? [],
            },
            set: () => Effect.void,
            stop: Effect.void,
            actions: declared.map((action) => action.info),
            validate: () => Effect.void,
            invoke: () => Effect.void,
          };
          const status = (phase: Status['phase'], detail = '') =>
            Effect.sync(() => {
              record.status = { ...record.status, enabled: phase === 'enabled', phase, detail };
              revision++;
            });
          const stop = Effect.gen(function* () {
            const closing = scope;
            scope = undefined;
            active = false;
            api = undefined;
            if (closing) {
              const exit = yield* Scope.close(closing, Exit.void).pipe(Effect.exit);
              cleanupDetail = Exit.isFailure(exit) ? failureMessage(exit.cause) : '';
              if (cleanupDetail)
                yield* Effect.logWarning('Plugin cleanup failed', definition.id, cleanupDetail);
              yield* clear(controls);
            }
          });
          record.stop = stop;
          record.set = (enabled) =>
            Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                if (!enabled) {
                  yield* stop;
                  yield* status(
                    supported ? (cleanupDetail ? 'error' : 'disabled') : 'unsupported',
                    cleanupDetail,
                  );
                  return;
                }
                if (active) return;
                if (!supported)
                  return yield* Effect.fail(
                    error(definition.id, 'Unsupported', record.status.detail),
                  );
                const conflict = [...records.values()].find(
                  (other) =>
                    other !== record &&
                    other.status.enabled &&
                    (controls.keys?.some((index) => other.status.keys.includes(index)) ||
                      controls.dials?.some((index) => other.status.dials.includes(index)) ||
                      controls.lcds?.some((index) => other.status.lcds.includes(index))),
                );
                if (conflict)
                  return yield* Effect.fail(
                    error(
                      definition.id,
                      'Conflict',
                      `${definition.name} et ${conflict.status.name} utilisent les mêmes contrôles. Désactive ${conflict.status.name} avant d’activer ce plugin.`,
                    ),
                  );
                scope = yield* Scope.make();
                const startedScope = scope;
                active = true;
                const device = ownedDevice(deck, controls, () => active && scope === startedScope);
                const presentations = overlays.forOwner(
                  definition.id,
                  () => active && scope === startedScope,
                );
                const setup = yield* restore(
                  definition.setup.pipe(
                    Effect.provideService(StreamDeck, device),
                    Effect.provideService(Overlays.DeckOverlays, presentations),
                    Scope.provide(startedScope),
                    Effect.provideContext(context),
                  ),
                ).pipe(Effect.exit);
                if (Exit.isFailure(setup)) {
                  yield* stop;
                  yield* Effect.logDebug(
                    'Plugin setup failed',
                    definition.id,
                    Cause.pretty(setup.cause),
                  );
                  const detail = failureMessage(setup.cause);
                  yield* status('error', detail);
                  return yield* Effect.fail(error(definition.id, 'Failed', detail));
                }
                api = { value: setup.value.api, device, presentations };
                yield* status('enabled');
                if (setup.value.run) {
                  const fiber = yield* Effect.forkIn(
                    setup.value.run.pipe(
                      Effect.provideService(StreamDeck, device),
                      Effect.provideService(Overlays.DeckOverlays, presentations),
                      Scope.provide(startedScope),
                      Effect.provideContext(context),
                      Effect.andThen(Effect.never),
                    ),
                    startedScope,
                  );
                  yield* Effect.forkIn(
                    Effect.gen(function* () {
                      const exit = yield* Fiber.await(fiber);
                      if (Exit.isFailure(exit))
                        yield* locked(
                          Effect.gen(function* () {
                            if (scope !== startedScope) return;
                            yield* stop;
                            yield* Effect.logDebug(
                              'Plugin source failed',
                              definition.id,
                              Cause.pretty(exit.cause),
                            );
                            yield* status('error', failureMessage(exit.cause));
                          }),
                        );
                    }),
                    owner,
                  );
                }
              }),
            );
          records.set(definition.id, record);
          revision++;
          const handle = {
            id: definition.id,
            current: Effect.sync(() =>
              active && api !== undefined ? Option.some(api.value) : Option.none(),
            ),
            use: <A, E2, R2>(f: (api: Api) => Effect.Effect<A, E2, R2>) =>
              Effect.flatMap(
                locked(
                  Effect.gen(function* () {
                    if (!active || api === undefined || !scope)
                      return yield* Effect.fail(
                        error(
                          definition.id,
                          'Disabled',
                          `Active ${definition.name} pour utiliser cette fonctionnalité.`,
                        ),
                      );
                    const current = api;
                    return yield* Effect.forkIn(
                      Effect.suspend(() => f(current.value)).pipe(
                        Effect.provideService(StreamDeck, current.device),
                        Effect.provideService(Overlays.DeckOverlays, current.presentations),
                        Scope.provide(scope),
                        Effect.provideContext(context),
                      ),
                      scope,
                    );
                  }),
                ),
                (fiber) => Fiber.join(fiber).pipe(Effect.ensuring(Fiber.interrupt(fiber))),
              ),
          } satisfies Handle<Api>;
          record.validate = (id, input) =>
            Effect.suspend(() => {
              const action = declared.find((candidateAction) => candidateAction.info.id === id);
              return action
                ? action
                    .validate(input)
                    .pipe(
                      Effect.mapError((cause) =>
                        error(
                          definition.id,
                          'Failed',
                          `Paramètres invalides pour ${action.info.name}: ${String(cause)}`,
                        ),
                      ),
                    )
                : Effect.fail(error(definition.id, 'Unknown', 'Action de plugin introuvable.'));
            });
          record.invoke = (id, input, candidateContext) =>
            Effect.gen(function* () {
              yield* record.validate(id, input);
              const action = invariant(
                declared.find((currentAction) => currentAction.info.id === id),
                'plugin-host',
              );
              const result = yield* handle
                .use((candidateApi) => action.execute(candidateApi, input, candidateContext))
                .pipe(Effect.exit);
              if (Exit.isFailure(result))
                return yield* Effect.fail(
                  error(definition.id, 'Failed', failureMessage(result.cause)),
                );
              return result.value;
            });
          record.feedback = (id, input) =>
            Effect.suspend(() => {
              const action = declared.find((currentAction) => currentAction.info.id === id);
              if (!action?.feedback) return Effect.succeed(null);
              return handle
                .use((candidateApi) =>
                  invariant(action.feedback, 'plugin-host')(candidateApi, input),
                )
                .pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(KeyFeedback)),
                  Effect.catchCause(() =>
                    Effect.succeed(
                      action.unavailable ?? {
                        text: 'HORS LIGNE',
                        tone: 'neutral' as const,
                        icon: 'plugin' as const,
                      },
                    ),
                  ),
                );
            });
          record.lcd = (id, input, size) => {
            const action = declared.find((entry) => entry.info.id === id);
            if (!action?.lcd) return Effect.succeed(undefined);
            return handle
              .use((value) =>
                Effect.gen(function* () {
                  const frame = yield* invariant(action.lcd, 'plugin-host')(value, input, size);
                  if (!frame.view) return undefined;
                  return {
                    view: yield* Schema.decodeUnknownEffect(View)(frame.view),
                    image: yield* frame.draw,
                  };
                }),
              )
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.fail(error(definition.id, 'Failed', failureMessage(cause))),
                ),
              );
          };
          return handle;
        }),
      );
    });
  return {
    overlays,
    install,
    catalogue: Effect.sync(() =>
      [...records.values()].flatMap((record) =>
        record.actions.map((action) => ({
          ...action,
          plugin: record.status.id,
          pluginName: record.status.name,
        })),
      ),
    ),
    interaction: (plugin: string, action: string) =>
      Effect.sync(
        () =>
          records.get(plugin)?.actions.find((entry) => entry.id === action)?.interaction ?? 'press',
      ),
    validateAction: (plugin: string, action: string, input: unknown, surface?: 'key' | 'lcd') =>
      Effect.suspend(() => {
        const record = records.get(plugin);
        const info = record?.actions.find((entry) => entry.id === action);
        if (surface && info && !supports(info, surface))
          return Effect.fail(
            error(plugin, 'Unsupported', 'Cette action ne prend pas en charge cette surface.'),
          );
        return (
          record?.validate(action, input) ??
          Effect.fail(error(plugin, 'Unknown', 'Plugin introuvable.'))
        );
      }),
    invoke: (
      plugin: string,
      action: string,
      input: unknown,
      context: Invocation = { output: () => Effect.void },
    ) =>
      Effect.suspend(
        () =>
          records.get(plugin)?.invoke(action, input, context) ??
          Effect.fail(error(plugin, 'Unknown', 'Plugin introuvable.')),
      ),
    feedback: (plugin: string, action: string, input: unknown) =>
      Effect.suspend(() => records.get(plugin)?.feedback?.(action, input) ?? Effect.succeed(null)),
    lcdFrame: (plugin: string, action: string, input: unknown, size: Size) =>
      Effect.suspend(
        () => records.get(plugin)?.lcd?.(action, input, size) ?? Effect.succeed(undefined),
      ),
    snapshot: Effect.sync(() => ({
      revision,
      items: [...records.values()].map((record) => record.status),
    })),
    // Run lifecycle changes outside the plugin being stopped, including self-disable.
    setEnabled: (id: string, enabled: boolean) =>
      Effect.flatMap(
        Effect.forkIn(
          locked(
            Effect.suspend(
              () =>
                records.get(id)?.set(enabled) ??
                Effect.fail(error(id, 'Unknown', 'Plugin introuvable.')),
            ),
          ),
          owner,
        ),
        Fiber.join,
      ),
  };
});
export class PluginHost extends Context.Service<PluginHost, Effect.Success<typeof make>>()(
  '@nixfiles/streamdeck/PluginHost',
) {
  static readonly layer = Layer.effect(PluginHost, make);
}
export type Controller = Effect.Success<typeof make>;
