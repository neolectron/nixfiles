import { Config, Context, Effect, Layer, Redacted, Result } from 'effect';
import { IntegrationError } from './errors.ts';
import { JsonSocket, type Message } from './json-socket.ts';
import * as Rpc from './obs-rpc.ts';
import * as State from './state.ts';

const offline = () =>
  new IntegrationError({
    message: 'OBS WebSocket hors ligne. Ouvre OBS et active son serveur WebSocket.',
  });
export interface Status {
  readonly connected: true;
  readonly recording?: boolean;
  readonly paused?: boolean;
  readonly streaming?: boolean;
  readonly virtualCamera?: boolean;
  readonly replayBuffer?: boolean;
  readonly currentScene?: string;
  readonly inputMute?: Readonly<Record<string, boolean>>;
}
/** Activation is independent of connectivity. The scope owns reconnects and sockets. */
export const make = (options: Parameters<typeof Rpc.make>[0]) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<JsonSocket | import('effect').Crypto.Crypto>();
    const store = yield* State.make<Status, IntegrationError>(offline(), 'obs');
    let active: Effect.Success<ReturnType<typeof Rpc.make>> | undefined;
    let eventRevision = 0;
    const publish = (patch: Partial<Status>) =>
      Effect.gen(function* () {
        const current = yield* store.snapshot;
        yield* store.publish(
          Result.succeed({
            ...(Result.isSuccess(current) ? current.success : {}),
            connected: true,
            ...patch,
          }),
        );
      });
    const onEvent = (type: string, data: Message) =>
      Effect.gen(function* () {
        eventRevision++;
        if (type === 'RecordStateChanged')
          yield* publish({
            recording: data.outputActive === true,
            paused: data.outputState === 'OBS_WEBSOCKET_OUTPUT_PAUSED',
          });
        else if (type === 'StreamStateChanged')
          yield* publish({ streaming: data.outputActive === true });
        else if (type === 'VirtualcamStateChanged')
          yield* publish({ virtualCamera: data.outputActive === true });
        else if (type === 'ReplayBufferStateChanged')
          yield* publish({ replayBuffer: data.outputActive === true });
        else if (type === 'CurrentProgramSceneChanged' && typeof data.sceneName === 'string')
          yield* publish({ currentScene: data.sceneName });
        else if (type === 'InputMuteStateChanged' && typeof data.inputName === 'string') {
          const current = yield* store.snapshot;
          yield* publish({
            inputMute: {
              ...(Result.isSuccess(current) ? current.success.inputMute : {}),
              [data.inputName]: data.inputMuted === true,
            },
          });
        }
      });
    const refresh = Effect.gen(function* () {
      const api = active;
      if (!api) return yield* offline();
      const revision = eventRevision;
      const values = yield* Effect.all(
        {
          record: api.request('GetRecordStatus').pipe(Effect.orElseSucceed((): Message => ({}))),
          stream: api.request('GetStreamStatus').pipe(Effect.orElseSucceed((): Message => ({}))),
          scene: api
            .request('GetCurrentProgramScene')
            .pipe(Effect.orElseSucceed((): Message => ({}))),
          camera: api
            .request('GetVirtualCamStatus')
            .pipe(Effect.orElseSucceed((): Message => ({}))),
          replay: api
            .request('GetReplayBufferStatus')
            .pipe(Effect.orElseSucceed((): Message => ({}))),
        },
        { concurrency: 'unbounded' },
      );
      if (eventRevision === revision)
        yield* publish({
          recording: values.record.outputActive === true,
          paused: values.record.outputPaused === true,
          streaming: values.stream.outputActive === true,
          virtualCamera: values.camera.outputActive === true,
          replayBuffer: values.replay.outputActive === true,
          currentScene:
            typeof values.scene.currentProgramSceneName === 'string'
              ? values.scene.currentProgramSceneName
              : '',
        });
    });
    const session = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            active = undefined;
          }),
        );
        active = yield* Rpc.make({ ...options, onEvent });
        yield* store.publish(Result.succeed({ connected: true }));
        yield* refresh;
        return yield* active.failure;
      }),
    ).pipe(
      Effect.provideContext(context),
      Effect.catch((error) => store.publish(Result.fail(error))),
    );
    yield* Effect.forkScoped(
      Effect.forever(store.session(session).pipe(Effect.andThen(Effect.sleep('1 second')))),
    );
    return {
      state: store.state,
      snapshot: store.snapshot,
      observe: store.observe,
      refresh: store.guard(refresh),
      request: (requestType: string, requestData: Message = {}) =>
        store.guard(
          Effect.suspend(() =>
            active
              ? active
                  .request(requestType, requestData)
                  .pipe(
                    Effect.mapError((error) =>
                      error instanceof IntegrationError
                        ? error
                        : new IntegrationError({ message: 'Requête OBS échouée.' }),
                    ),
                  )
              : Effect.fail(offline()),
          ),
        ),
    };
  });
export type Controller = Omit<Effect.Success<ReturnType<typeof make>>, 'refresh'> & {
  readonly refresh?: Effect.Effect<void, IntegrationError>;
};
export class Obs extends Context.Service<Obs, Controller>()('@nixfiles/system-control/Obs') {
  static readonly serviceLayer = (options: Parameters<typeof make>[0]) =>
    Layer.effect(Obs, make(options));
  static readonly layer = Layer.effect(
    Obs,
    Effect.gen(function* () {
      const url = yield* Config.String('STREAMDECK_OBS_URL').pipe(
        Config.withDefault('ws://127.0.0.1:4455'),
      );
      const password = yield* Config.Redacted('STREAMDECK_OBS_PASSWORD').pipe(
        Config.withDefault(Redacted.make('')),
      );
      return yield* make({ url, password });
    }),
  ).pipe(Layer.provide(JsonSocket.layer));
}
