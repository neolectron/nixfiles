import { Effect, Option, Schema } from 'effect';
import { ActionError, define, type Controller } from './actions.ts';
import { Audio } from './audio.ts';
import { Counters } from './counters.ts';
import { Spotify } from './spotify.ts';
import { MediaPlayers } from './media.ts';
import { Desktop } from './desktop.ts';
import { Discord } from './discord.ts';
import { Obs } from './obs.ts';
import { SystemAppearance } from './appearance.ts';
import { Notes } from './notes.ts';
import { Note, Update } from './notes-contract.ts';
import { DotCall, Status as CallStatus } from './dot-call.ts';
import { CodexPrompt, Request as Prompt } from './codex-prompt.ts';
import { TextTransform, Request as Transform } from './text-transform.ts';
import type * as Mpris from './mpris.ts';
import type { IntegrationError } from './errors.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);
const Done = Schema.Null;
const capability = <A>(service: Option.Option<A>) =>
  Effect.succeed({
    available: Option.isSome(service),
    ...(Option.isNone(service) ? { reason: 'Intégration non activée.' } : {}),
  });
const online = <A, E>(service: Option.Option<A>, read: (api: A) => Effect.Effect<unknown, E>) =>
  Option.isSome(service)
    ? read(service.value).pipe(
        Effect.match({
          onSuccess: () => ({ available: true }),
          onFailure: () => ({ available: false, reason: 'Intégration hors ligne.' }),
        }),
      )
    : capability(service);
const withService = <A, B, E, R>(
  id: string,
  service: Option.Option<A>,
  f: (api: A) => Effect.Effect<B, E, R>,
): Effect.Effect<B, E | ActionError, R> =>
  Option.isSome(service)
    ? f(service.value)
    : Effect.fail(
        new ActionError({ action: id, code: 'Unavailable', message: 'Intégration non activée.' }),
      );
const number = Schema.Number.check(Schema.isFinite());
const Application = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  volume: number,
  muted: Schema.Boolean,
});
const Playback = Schema.Struct({
  status: Schema.String,
  title: Schema.String,
  artists: Schema.Array(Schema.String),
  durationMicros: Schema.NullOr(number),
  positionMicros: Schema.NullOr(number),
  sampledAt: number,
  rate: number,
});
const ObsState = Schema.Struct({
  connected: Schema.Boolean,
  recording: Schema.Boolean,
  paused: Schema.Boolean,
  streaming: Schema.Boolean,
  virtualCamera: Schema.Boolean,
  replayBuffer: Schema.Boolean,
  currentScene: Schema.String,
});

/** Register once in the system runtime. No action runs during registration. */
export const install = (catalogue: Controller) =>
  Effect.gen(function* () {
    const counters = yield* Effect.serviceOption(Counters);
    const CounterInput = Schema.Struct({
      id: Schema.NonEmptyString,
      start: Schema.Int,
      version: Schema.optionalKey(Schema.String),
    });
    for (const operation of ['value', 'increment'] as const)
      yield* catalogue.register(
        define({
          id: `counter.${operation}`,
          name: `Compteur · ${operation}`,
          input: CounterInput,
          output: Schema.Int,
          readOnly: operation === 'value',
          available: capability(counters),
          run: ({ id, start, version }) =>
            withService(`counter.${operation}`, counters, (api) =>
              operation === 'value'
                ? Effect.sync(() => api.initial(id, start, version))
                : api.increment(id, start, version),
            ),
        }),
      );
    const audio = yield* Effect.serviceOption(Audio);
    const spotify = yield* Effect.serviceOption(Spotify);
    const media = yield* Effect.serviceOption(MediaPlayers);
    const desktop = yield* Effect.serviceOption(Desktop);
    const discord = yield* Effect.serviceOption(Discord);
    const obs = yield* Effect.serviceOption(Obs);
    const appearance = yield* Effect.serviceOption(SystemAppearance);
    const notes = yield* Effect.serviceOption(Notes);
    const dot = yield* Effect.serviceOption(DotCall);
    const codex = yield* Effect.serviceOption(CodexPrompt);
    const transform = yield* Effect.serviceOption(TextTransform);
    yield* catalogue.register(
      define({
        id: 'codex.prompt',
        name: 'Exécuter un prompt Codex',
        input: Prompt,
        output: Schema.String,
        available: capability(codex),
        run: (input) => withService('codex.prompt', codex, (api) => api.run(input)),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'text.transform',
        name: 'Transformer un texte',
        input: Transform,
        output: Schema.String,
        available: capability(transform),
        run: (input) => withService('text.transform', transform, (api) => api.transform(input)),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'dot.state',
        name: 'État de l’appel',
        input: Empty,
        output: CallStatus,
        readOnly: true,
        available: capability(dot),
        run: () => withService('dot.state', dot, (api) => api.state),
      }),
    );
    for (const operation of ['call', 'hangup', 'toggle'] as const)
      yield* catalogue.register(
        define({
          id: `dot.${operation}`,
          name: `Appel · ${operation}`,
          input: Empty,
          output: CallStatus,
          available: capability(dot),
          run: () => withService(`dot.${operation}`, dot, (api) => api[operation]),
        }),
      );
    yield* catalogue.register(
      define({
        id: 'audio.state',
        name: 'État audio',
        input: Empty,
        output: Schema.Struct({
          applications: Schema.Array(Application),
          master: Schema.NullOr(Schema.Struct({ volume: number, muted: Schema.Boolean })),
        }),
        readOnly: true,
        available: online(audio, (api) => api.state),
        run: () =>
          withService('audio.state', audio, (api) =>
            api.state.pipe(
              Effect.map((s) => ({ applications: s.applications, master: s.master ?? null })),
            ),
          ),
      }),
    );
    for (const kind of ['volume', 'mute'] as const) {
      yield* catalogue.register(
        define({
          id: `audio.${kind}`,
          name: `Application · ${kind}`,
          input: Schema.Struct({
            application: Schema.String,
            value: kind === 'volume' ? number : Schema.Boolean,
          }),
          output: Done,
          available: online(audio, (api) => api.state),
          choices: {
            application: withService('audio.state', audio, (api) =>
              api.state.pipe(
                Effect.map((s) => s.applications.map((a) => ({ value: a.key, label: a.name }))),
              ),
            ),
          },
          run: (input) =>
            withService(`audio.${kind}`, audio, (api) =>
              (typeof input.value === 'number'
                ? api.setVolume(input.application, input.value)
                : api.setMuted(input.application, input.value)
              ).pipe(Effect.as(null)),
            ),
        }),
      );
      yield* catalogue.register(
        define({
          id: `audio.master.${kind}`,
          name: `Master · ${kind}`,
          input: Schema.Struct({ value: kind === 'volume' ? number : Schema.Boolean }),
          output: Done,
          available: online(audio, (api) => api.state),
          run: (input) =>
            withService(`audio.master.${kind}`, audio, (api) =>
              (typeof input.value === 'number'
                ? api.setMasterVolume(input.value)
                : api.setMasterMuted(input.value)
              ).pipe(Effect.as(null)),
            ),
        }),
      );
    }
    const players: ReadonlyArray<
      readonly [
        string,
        Option.Option<{
          state: Effect.Effect<Mpris.State, IntegrationError>;
          command: (command: Mpris.Command) => Effect.Effect<unknown, IntegrationError>;
        }>,
      ]
    > = [
      ['spotify', Option.map(spotify, (api) => ({ state: api.state, command: api.command }))],
      [
        'media',
        Option.map(media, (api) => ({
          state: api.state.pipe(Effect.map((state) => state.playback)),
          command: api.command,
        })),
      ],
    ];
    for (const [name, service] of players) {
      yield* catalogue.register(
        define({
          id: `${name}.state`,
          name: `${name} · état`,
          input: Empty,
          output: Playback,
          readOnly: true,
          available: online(service, (api) => api.state),
          run: () => withService(`${name}.state`, service, (api) => api.state),
        }),
      );
      for (const [id, command] of [
        ['play-pause', 'PlayPause'],
        ['play', 'Play'],
        ['pause', 'Pause'],
        ['next', 'Next'],
        ['previous', 'Previous'],
        ['stop', 'Stop'],
      ] as const)
        yield* catalogue.register(
          define({
            id: `${name}.${id}`,
            name: `${name} · ${id}`,
            input: Empty,
            output: Done,
            available: online(service, (api) => api.state),
            run: () =>
              withService(`${name}.${id}`, service, (api) =>
                api.command(command).pipe(Effect.as(null)),
              ),
          }),
        );
    }
    const windows = Schema.Array(
      Schema.Struct({
        id: Schema.Int,
        app_id: Schema.NullOr(Schema.String),
        title: Schema.optionalKey(Schema.String),
        is_focused: Schema.optionalKey(Schema.Boolean),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'desktop.windows',
        name: 'Fenêtres',
        input: Empty,
        output: windows,
        readOnly: true,
        available: capability(desktop),
        run: () => withService('desktop.windows', desktop, (api) => api.refresh),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'desktop.open',
        name: 'Ouvrir une application',
        input: Schema.Struct({ application: Schema.NonEmptyString }),
        output: Schema.String,
        available: capability(desktop),
        choices: {
          application: withService('desktop.open', desktop, (api) =>
            Effect.succeed(api.applications.map((a) => ({ value: a.id, label: a.name }))),
          ),
        },
        run: ({ application }) =>
          withService('desktop.open', desktop, (api) =>
            api.open({
              applications: [application],
              windows: [application.replace(/\.desktop$/, '')],
            }),
          ),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'desktop.open-target',
        name: 'Ouvrir ou activer une application',
        input: Schema.Struct({
          applications: Schema.Array(Schema.String),
          windows: Schema.Array(Schema.String),
        }),
        output: Schema.String,
        available: capability(desktop),
        run: (input) => withService('desktop.open-target', desktop, (api) => api.open(input)),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'discord.state',
        name: 'État vocal Discord',
        input: Empty,
        output: Schema.Struct({ mute: Schema.Boolean, deaf: Schema.Boolean }),
        readOnly: true,
        available: online(discord, (api) => api.state),
        run: () => withService('discord.state', discord, (api) => api.state),
      }),
    );
    for (const field of ['mute', 'deaf'] as const)
      yield* catalogue.register(
        define({
          id: `discord.${field}`,
          name: `Discord · ${field}`,
          input: Schema.Struct({ value: Schema.Boolean }),
          output: Done,
          available: online(discord, (api) => api.state),
          run: ({ value }) =>
            withService(`discord.${field}`, discord, (api) =>
              api.set(field, value).pipe(Effect.as(null)),
            ),
        }),
      );
    yield* catalogue.register(
      define({
        id: 'obs.state',
        name: 'État OBS',
        input: Empty,
        output: ObsState,
        readOnly: true,
        available: online(obs, (api) => api.state),
        run: () =>
          withService('obs.state', obs, (api) =>
            api.state.pipe(
              Effect.map((s) => ({
                connected: true,
                recording: s.recording ?? false,
                paused: s.paused ?? false,
                streaming: s.streaming ?? false,
                virtualCamera: s.virtualCamera ?? false,
                replayBuffer: s.replayBuffer ?? false,
                currentScene: s.currentScene ?? '',
              })),
            ),
          ),
      }),
    );
    const obsCommands = {
      record: 'ToggleRecord',
      'start-record': 'StartRecord',
      'stop-record': 'StopRecord',
      'pause-record': 'PauseRecord',
      'resume-record': 'ResumeRecord',
      'toggle-record-pause': 'ToggleRecordPause',
      stream: 'ToggleStream',
      'start-stream': 'StartStream',
      'stop-stream': 'StopStream',
      'virtual-camera': 'ToggleVirtualCam',
      'start-virtual-camera': 'StartVirtualCam',
      'stop-virtual-camera': 'StopVirtualCam',
      'start-replay': 'StartReplayBuffer',
      'stop-replay': 'StopReplayBuffer',
      'toggle-replay': 'ToggleReplayBuffer',
      'save-replay': 'SaveReplayBuffer',
    };
    for (const [id, request] of Object.entries(obsCommands))
      yield* catalogue.register(
        define({
          id: `obs.${id}`,
          name: `OBS · ${id}`,
          input: Empty,
          output: Done,
          available: online(obs, (api) => api.state),
          run: () =>
            withService(`obs.${id}`, obs, (api) => api.request(request).pipe(Effect.as(null))),
        }),
      );
    const choices = (request: string, field: string, property: string) =>
      withService('obs.choices', obs, (api) =>
        api.request(request).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))),
          Effect.map((reply) =>
            Array.isArray(reply[field])
              ? reply[field].flatMap((item) =>
                  typeof item?.[property] === 'string'
                    ? [{ value: item[property] as string, label: item[property] as string }]
                    : [],
                )
              : [],
          ),
        ),
      );
    yield* catalogue.register(
      define({
        id: 'obs.scene',
        name: 'Changer de scène OBS',
        input: Schema.Struct({ sceneName: Schema.NonEmptyString }),
        output: Done,
        available: online(obs, (api) => api.state),
        choices: { sceneName: choices('GetSceneList', 'scenes', 'sceneName') },
        run: (input) =>
          withService('obs.scene', obs, (api) =>
            api.request('SetCurrentProgramScene', input).pipe(Effect.as(null)),
          ),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'obs.mute-input',
        name: 'Mute source OBS',
        input: Schema.Struct({ inputName: Schema.NonEmptyString }),
        output: Done,
        available: online(obs, (api) => api.state),
        choices: { inputName: choices('GetInputList', 'inputs', 'inputName') },
        run: (input) =>
          withService('obs.mute-input', obs, (api) =>
            api.request('ToggleInputMute', input).pipe(Effect.as(null)),
          ),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'appearance.toggle',
        name: 'Basculer le thème',
        input: Empty,
        output: Done,
        available: online(appearance, (api) => api.state),
        run: () =>
          withService('appearance.toggle', appearance, (api) => api.toggle.pipe(Effect.as(null))),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'appearance.set',
        name: 'Changer le thème',
        input: Schema.Struct({ mode: Schema.Literals(['dark', 'light']) }),
        output: Done,
        available: online(appearance, (api) => api.state),
        run: ({ mode }) =>
          withService('appearance.set', appearance, (api) => api.set(mode).pipe(Effect.as(null))),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'notes.read',
        name: 'Lire une note',
        input: Schema.Struct({ id: Schema.String }),
        output: Note,
        readOnly: true,
        available: capability(notes),
        run: ({ id }) => withService('notes.read', notes, (api) => api.read(id)),
      }),
    );
    yield* catalogue.register(
      define({
        id: 'notes.save',
        name: 'Enregistrer une note',
        input: Update,
        output: Note,
        available: capability(notes),
        run: (input) => withService('notes.save', notes, (api) => api.save(input)),
      }),
    );
  });
