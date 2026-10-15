import {
  Clock,
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { IntegrationError } from './errors.ts';
import * as State from './state.ts';

const CallId = Schema.NonEmptyString.check(Schema.isMaxLength(256));
export const Status = Schema.Union([
  Schema.Struct({ phase: Schema.Literal('idle'), callId: Schema.Null, startedAt: Schema.Null }),
  Schema.Struct({
    phase: Schema.Literals(['connecting', 'ending']),
    callId: CallId,
    startedAt: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  Schema.Struct({
    phase: Schema.Literal('active'),
    callId: CallId,
    startedAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
]);
export type Status = typeof Status.Type;
export const idle: Status = { phase: 'idle', callId: null, startedAt: null };
export class DotCallBackend extends Context.Service<
  DotCallBackend,
  {
    readonly read: Effect.Effect<Status, IntegrationError>;
    readonly call: Effect.Effect<Status, IntegrationError>;
    /** Must target this exact call, including when a newer call has replaced it. */
    readonly hangup: (callId: string) => Effect.Effect<Status, IntegrationError>;
  }
>()('@nixfiles/system-control/DotCallBackend') {
  static readonly layer = Layer.effect(
    DotCallBackend,
    Effect.gen(function* () {
      const processes = yield* ChildProcessSpawner.ChildProcessSpawner;
      const argv = Schema.Array(Schema.String).check(Schema.isMinLength(1));
      const config = yield* Effect.result(
        Effect.all([
          Config.schema(Schema.fromJsonString(argv), 'STREAMDECK_DOT_CALL').pipe(Config.option),
          Config.schema(Schema.fromJsonString(argv), 'STREAMDECK_DOT_HANGUP').pipe(Config.option),
          Config.schema(Schema.fromJsonString(argv), 'STREAMDECK_DOT_STATUS').pipe(Config.option),
        ]),
      );
      const unavailable = new IntegrationError({
        message:
          'Contrôle d’appel du dot non connecté. Fournis un DotCallBackend ou les bridges STREAMDECK_DOT_CALL, STREAMDECK_DOT_HANGUP et STREAMDECK_DOT_STATUS.',
      });
      if (Result.isFailure(config) || config.success.some(Option.isNone))
        return {
          read: Effect.fail(unavailable),
          call: Effect.fail(unavailable),
          hangup: () => Effect.fail(unavailable),
        };
      const [start, stop, status] = config.success.map(Option.getOrThrow);
      const run = (
        arguments_: ReadonlyArray<string> | undefined,
        extra: ReadonlyArray<string> = [],
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const [executable, ...args] = arguments_ ?? [];
            if (!executable) return yield* unavailable;
            const handle = yield* processes.spawn(
              ChildProcess.make(executable, [...args, ...extra], {
                stdin: 'ignore',
                forceKillAfter: '500 millis',
              }),
            );
            const [code, text] = yield* Effect.all(
              [
                handle.exitCode,
                Stream.mkString(Stream.decodeText(handle.stdout)),
                Stream.runDrain(handle.stderr),
              ],
              { concurrency: 'unbounded' },
            );
            if (code !== 0)
              return yield* new IntegrationError({
                message: 'Le contrôle d’appel du dot a refusé la commande.',
              });
            return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Status))(text);
          }),
        ).pipe(
          Effect.timeout('5 seconds'),
          Effect.mapError(
            () =>
              new IntegrationError({
                message: 'Bridge du dot indisponible, réponse invalide ou délai dépassé.',
              }),
          ),
        );
      return {
        read: run(status),
        call: run(start),
        hangup: (callId: string) => run(stop, [callId]),
      };
    }),
  );
}

export const make = Effect.gen(function* () {
  const backend = yield* DotCallBackend;
  const lock = yield* Semaphore.make(1);
  const validate = (value: Status) =>
    Schema.decodeUnknownEffect(Status)(value).pipe(
      Effect.mapError(() => new IntegrationError({ message: 'État de l’appel du dot invalide.' })),
    );
  const store = yield* State.polling(
    backend.read.pipe(Effect.flatMap(validate)),
    '1 second',
    new IntegrationError({ message: 'État de l’appel du dot indisponible.' }),
    'dot',
  );
  const execute = (operation: 'call' | 'hangup' | 'toggle') =>
    store.guard(
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const current = yield* store.refresh;
          if (current.phase === 'ending') return current;
          const start =
            operation === 'call' || (operation === 'toggle' && current.phase === 'idle');
          if ((start && current.phase !== 'idle') || (!start && current.phase === 'idle'))
            return current;
          const next = yield* (
            start
              ? backend.call
              : current.callId === null
                ? Effect.fail(new IntegrationError({ message: 'Aucun appel à raccrocher.' }))
                : backend.hangup(current.callId)
          ).pipe(Effect.flatMap(validate));
          yield* store.publish(Result.succeed(next));
          if (start && next.phase === 'idle')
            return yield* new IntegrationError({ message: 'Le dot n’a pas démarré l’appel.' });
          if (!start && next.phase !== 'idle' && next.phase !== 'ending')
            return yield* new IntegrationError({
              message: 'L’appel est toujours actif ; le raccrochage n’a pas été confirmé.',
            });
          return next;
        }),
      ),
    );
  return {
    state: store.state,
    snapshot: store.snapshot,
    observe: store.observe,
    refresh: store.refresh,
    view: Effect.gen(function* () {
      const state = yield* store.state;
      const now = yield* Clock.currentTimeMillis;
      return {
        ...state,
        elapsedSeconds:
          state.startedAt === null ? 0 : Math.max(0, Math.floor((now - state.startedAt) / 1000)),
      };
    }),
    call: execute('call'),
    hangup: execute('hangup'),
    toggle: execute('toggle'),
  };
});
export type Controller = Effect.Success<typeof make>;
export class DotCall extends Context.Service<DotCall, Controller>()(
  '@nixfiles/system-control/DotCall',
) {
  static readonly serviceLayer = Layer.effect(DotCall, make);
  static readonly layer = DotCall.serviceLayer.pipe(Layer.provide(DotCallBackend.layer));
}
export const shared = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(DotCall);
  return Option.isSome(service)
    ? service.value
    : Context.get(yield* Layer.build(DotCall.layer), DotCall);
});
