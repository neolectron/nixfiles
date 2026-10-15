import { Cause, Clock, Context, Data, Effect, Exit, Fiber, Layer, Option, Schema } from 'effect';
import { IntegrationControl } from './integration-control.ts';

export class ActionError extends Data.TaggedError('ActionError')<{
  readonly action: string;
  readonly code: 'Unknown' | 'InvalidInput' | 'InvalidOutput' | 'Unavailable' | 'Failed';
  readonly message: string;
}> {}
export const ErrorSchema = Schema.Struct({
  _tag: Schema.Literal('ActionError'),
  action: Schema.String,
  code: Schema.String,
  message: Schema.String,
});
export interface Choice {
  readonly value: string;
  readonly label: string;
}
export interface Capability {
  readonly available: boolean;
  readonly reason?: string;
}
export interface Descriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly error: unknown;
  readonly readOnly: boolean;
  readonly fields: ReadonlyArray<string>;
}
export interface Diagnostic {
  readonly sequence: number;
  readonly action: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: 'success' | 'failure' | 'cancelled';
  readonly code?: string;
}

/** An interface-independent action. Schemas validate scripts as well as HTTP/MCP requests. */
export const define = <I extends Schema.Constraint, O extends Schema.Constraint, E, R>(options: {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly input: I;
  readonly output: O;
  readonly readOnly?: boolean;
  readonly run: (input: I['Type']) => Effect.Effect<O['Type'], E, R>;
  readonly available?: Effect.Effect<Capability, E, R>;
  readonly choices?: Readonly<Record<string, Effect.Effect<ReadonlyArray<Choice>, E, R>>>;
}) => ({
  info: {
    id: options.id,
    name: options.name,
    description: options.description ?? '',
    input: Schema.toJsonSchemaDocument(options.input),
    output: Schema.toJsonSchemaDocument(options.output),
    error: Schema.toJsonSchemaDocument(ErrorSchema),
    readOnly: options.readOnly ?? false,
    fields: Object.keys(options.choices ?? {}),
  } satisfies Descriptor,
  available: options.available ?? Effect.succeed({ available: true } satisfies Capability),
  choices: options.choices ?? {},
  execute: (input: unknown) =>
    Schema.decodeUnknownEffect(options.input, { onExcessProperty: 'error' })(input).pipe(
      Effect.mapError(
        () =>
          new ActionError({
            action: options.id,
            code: 'InvalidInput',
            message: 'Paramètres invalides.',
          }),
      ),
      Effect.flatMap(options.run),
      Effect.flatMap((result) =>
        Schema.encodeEffect(Schema.toCodecJson(options.output))(result).pipe(
          Effect.mapError(
            () =>
              new ActionError({
                action: options.id,
                code: 'InvalidOutput',
                message: 'Résultat incompatible avec le contrat.',
              }),
          ),
        ),
      ),
    ),
});

const integration = (id: string) =>
  id.startsWith('spotify.') ? 'media' : (id.split('.')[0] ?? '');
export const make = Effect.gen(function* () {
  const control = yield* Effect.serviceOption(IntegrationControl);
  const enabled = (id: string) =>
    Option.isSome(control) ? control.value.enabled(integration(id)) : Effect.succeed(true);
  const owner = yield* Effect.scope;
  type Registered = {
    info: Descriptor;
    available: Effect.Effect<Capability, ActionError>;
    choices: (field: string) => Effect.Effect<ReadonlyArray<Choice>, ActionError>;
    execute: (input: unknown) => Effect.Effect<Schema.Json, ActionError>;
  };
  const entries = new Map<string, Registered>();
  const diagnostics: Diagnostic[] = [];
  let sequence = 0;
  const register = <E, R>(action: {
    readonly info: Descriptor;
    readonly available: Effect.Effect<Capability, E, R>;
    readonly choices: Readonly<Record<string, Effect.Effect<ReadonlyArray<Choice>, E, R>>>;
    readonly execute: (input: unknown) => Effect.Effect<Schema.Json, E, R>;
  }) =>
    Effect.gen(function* () {
      if (entries.has(action.info.id))
        return yield* new ActionError({
          action: action.info.id,
          code: 'Failed',
          message: 'Action déjà enregistrée.',
        });
      const context = yield* Effect.context<R>();
      const wrap = <A>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideContext(context),
          Effect.mapError((error) =>
            error instanceof ActionError
              ? error
              : new ActionError({
                  action: action.info.id,
                  code: 'Failed',
                  message: error instanceof Error ? error.message : 'Action échouée.',
                }),
          ),
        );
      const record: Registered = {
        info: action.info,
        available: wrap(action.available),
        choices: (field) =>
          action.choices[field] ? wrap(action.choices[field]) : Effect.succeed([]),
        execute: (input) => wrap(Effect.scoped(action.execute(input))),
      };
      entries.set(action.info.id, record);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (entries.get(action.info.id) === record) entries.delete(action.info.id);
        }),
      );
    });
  const get = (id: string) =>
    Effect.suspend(() => {
      const entry = entries.get(id);
      return entry
        ? Effect.succeed(entry)
        : Effect.fail(
            new ActionError({ action: id, code: 'Unknown', message: 'Action inconnue.' }),
          );
    });
  const perform = (id: string, input: unknown) =>
    Effect.gen(function* () {
      const action = yield* get(id);
      if (!(yield* enabled(id)))
        return yield* new ActionError({
          action: id,
          code: 'Unavailable',
          message: 'Intégration désactivée.',
        });
      const run = Effect.gen(function* () {
        const capability = yield* action.available;
        if (!capability.available)
          return yield* new ActionError({
            action: id,
            code: 'Unavailable',
            message: capability.reason ?? 'Action indisponible.',
          });
        return yield* action.execute(input);
      });
      return yield* Option.isSome(control)
        ? Effect.raceFirst(
            run,
            control.value.until(integration(id), false).pipe(
              Effect.andThen(
                Effect.fail(
                  new ActionError({
                    action: id,
                    code: 'Unavailable',
                    message: 'Intégration désactivée pendant l’action.',
                  }),
                ),
              ),
            ),
          )
        : run;
    });
  const invoke = (id: string, input: unknown) =>
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      return yield* perform(id, input).pipe(
        Effect.onExit((result) =>
          Effect.gen(function* () {
            const error = Exit.isFailure(result)
              ? Cause.findErrorOption(result.cause)
              : Option.none();
            diagnostics.push({
              sequence: ++sequence,
              action: id,
              startedAt,
              durationMs: (yield* Clock.currentTimeMillis) - startedAt,
              outcome: Exit.isSuccess(result)
                ? 'success'
                : Exit.hasInterrupts(result)
                  ? 'cancelled'
                  : 'failure',
              ...(Option.isSome(error) ? { code: error.value.code } : {}),
            });
            if (diagnostics.length > 256) diagnostics.shift();
          }),
        ),
      );
    });
  return {
    register,
    catalogue: Effect.sync(() => [...entries.values()].map((entry) => entry.info)),
    capability: (id: string) =>
      Effect.flatMap(enabled(id), (active) =>
        active
          ? Effect.flatMap(get(id), (entry) => entry.available)
          : Effect.succeed({ available: false, reason: 'Intégration désactivée.' }),
      ),
    choices: (id: string, field: string) =>
      Effect.flatMap(enabled(id), (active) =>
        active ? Effect.flatMap(get(id), (entry) => entry.choices(field)) : Effect.succeed([]),
      ),
    invoke: (id: string, input: unknown) =>
      Effect.acquireUseRelease(
        Effect.forkIn(invoke(id, input), owner),
        Fiber.join,
        Fiber.interrupt,
      ),
    diagnostics: Effect.sync(() => [...diagnostics]),
  };
});
export type Controller = Effect.Success<typeof make>;
export class ActionCatalog extends Context.Service<ActionCatalog, Controller>()(
  '@nixfiles/system-control/ActionCatalog',
) {
  static readonly layer = Layer.effect(ActionCatalog, make);
}
