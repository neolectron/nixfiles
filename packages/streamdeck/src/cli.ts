import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Console, Deferred, Effect, Fiber, Layer, Option, Path, Ref, Schema, Stream } from 'effect';
import { CliError, Command, Flag } from 'effect/cli';
import * as Audio from '@nixfiles/system-control/audio.ts';
import * as Hid from './hid.ts';
import * as Mock from './mock.ts';
import * as StudioDevice from './studio-device.ts';
import { StateStorage } from '@nixfiles/system-control/state-storage.ts';
import { StreamDeck, discover } from './stream-deck.ts';
import type { DeckEvent } from './model.ts';
import { startHello } from './scripts/hello.ts';
import { playground } from './scripts/playground.ts';
import { pages } from './scripts/pages.ts';
import { gestures } from './scripts/gesture-playground.ts';
import { mixer } from './scripts/audio-mixer.ts';
import { preview } from './scripts/mixer-preview.ts';
import type { RendererKind } from './mixer-renderer.ts';
import { benchmark } from './scripts/render-benchmark.ts';

const mockFlag = Flag.Boolean('mock').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Use an in-memory device; never load native HID.'),
);
const demoFlag = Flag.Boolean('demo').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Replay a finite mock input sequence. Requires --mock.'),
);
const rendererFlag = Flag.Literals('renderer', ['svg', 'react']).pipe(
  Flag.withDefault('svg'),
  Flag.withDescription('LCD renderer: svg or React/Takumi, default svg.'),
);
const connectionFlags = {
  mock: mockFlag,
  path: Flag.String('path').pipe(
    Flag.optional,
    Flag.withDescription(
      'Exact device path from list; required when several devices are connected.',
    ),
  ),
  duration: Flag.Finite('duration').pipe(
    Flag.withSchema(
      Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(86400)),
    ),
    Flag.optional,
    Flag.withDescription('Stop normally after this many seconds, in (0, 86400].'),
  ),
};
interface DeviceOptions {
  readonly mock: boolean;
  readonly path: Option.Option<string>;
  readonly duration: Option.Option<number>;
  readonly demo?: boolean;
  readonly lcd?: boolean;
  readonly step?: number;
  readonly renderer?: RendererKind;
  readonly mockAudio?: boolean;
  readonly port?: number;
  readonly profile?: Option.Option<string>;
  readonly storage?: 'file' | 'memory';
}

const runDevice = (
  kind: 'hello' | 'events' | 'playground' | 'pages' | 'mixer' | 'studio' | 'gestures',
  options: DeviceOptions,
) =>
  Effect.gen(function* () {
    if (options.demo && !options.mock)
      return yield* new CliError.UserError({
        cause: '--demo requires --mock.',
        userMessage: '--demo requires --mock.',
      });
    const mock = Mock.make();
    const body = Effect.scoped(
      Effect.gen(function* () {
        const deck = yield* StreamDeck;
        yield* Console.log(
          JSON.stringify({
            kind: kind === 'studio' ? 'studio-ready' : 'connected',
            path: deck.info.path,
            model: deck.info.model,
            buttons: deck.buttons.length,
            dials: deck.dials.length,
            lcds: deck.lcds.length,
            mock: options.mock,
          }),
        );
        const count = yield* Ref.make(0);
        const complete = yield* Deferred.make<void>();
        const observe = (event: DeckEvent) =>
          Effect.gen(function* () {
            yield* Console.log(JSON.stringify(event));
            const n = yield* Ref.updateAndGet(count, (value) => value + 1);
            if (n === Mock.demoEvents.length) yield* Deferred.succeed(complete, undefined);
          });
        const hello = kind === 'hello' ? yield* startHello(!!options.lcd, observe) : undefined;
        const events = kind === 'events' ? yield* deck.subscribe : undefined;
        const studio =
          kind === 'studio'
            ? yield* Effect.gen(function* () {
                const module = yield* Effect.tryPromise(() => import('./scripts/studio.ts'));
                const path = yield* Path.Path;
                const fallback = yield* path.fromFileUrl(
                  new URL('../.studio/profile.json', import.meta.url),
                );
                return module
                  .studio({
                    port: options.port ?? 3900,
                    profile: Option.getOrElse(options.profile ?? Option.none(), () => fallback),
                    ...(options.storage === 'memory'
                      ? { persistence: StateStorage.layerMemory }
                      : {}),
                    mock: options.mock,
                    renderer: options.renderer ?? 'react',
                  })
                  .pipe(
                    Effect.provide(
                      options.mock || options.mockAudio ? Audio.demoLayer : Audio.layer,
                    ),
                  );
              })
            : undefined;
        const run =
          studio ??
          hello?.run ??
          (events
            ? Stream.runForEach(events, observe)
            : kind === 'gestures'
              ? gestures
              : kind === 'pages'
                ? pages
                : kind === 'mixer'
                  ? mixer({
                      ...(options.step === undefined ? {} : { step: options.step }),
                      ...(options.renderer === undefined ? {} : { renderer: options.renderer }),
                    }).pipe(
                      Effect.provide(
                        options.mockAudio
                          ? Audio.demoLayer
                          : options.mock
                            ? Audio.mockLayer
                            : Audio.layer,
                      ),
                    )
                  : playground);
        if (options.demo) {
          const fiber = yield* Effect.forkScoped(run);
          for (const event of Mock.demoEvents) yield* mock.emit(event);
          yield* Effect.raceFirst(Deferred.await(complete), Fiber.join(fiber));
          const state = hello ? yield* hello.state : undefined;
          yield* Console.log(
            JSON.stringify({
              kind: 'demo-complete',
              frames: mock.writes.filter((write) => write.kind === 'key').length,
              lcdFrames: mock.writes.filter((write) => write.kind === 'lcd').length,
              level: state?.level,
              events: yield* Ref.get(count),
            }),
          );
        } else {
          yield* Console.log('Listening. Ctrl+C to stop.');
          yield* Option.match(options.duration, {
            onNone: () => run,
            onSome: (seconds) => Effect.raceFirst(run, Effect.sleep(seconds * 1000)),
          });
        }
      }),
    );
    const openOptions = Option.match(options.path, {
      onNone: () => ({}),
      onSome: (path) => ({ path }),
    });
    yield* body.pipe(
      Effect.provide(
        options.mock
          ? mock.layer(openOptions)
          : kind === 'studio'
            ? StudioDevice.layer(openOptions).pipe(Layer.provide(Hid.driverLayer))
            : Hid.layer(openOptions),
      ),
    );
  });

const list = Command.make('list', { mock: mockFlag }, ({ mock }) =>
  Effect.gen(function* () {
    const devices = yield* discover.pipe(
      Effect.provide(mock ? Mock.make().driverLayer : Hid.driverLayer),
    );
    yield* Console.log(JSON.stringify(devices, null, 2));
  }),
).pipe(
  Command.withDescription(
    'Discover models, actual USB IDs and capabilities without opening a handle.',
  ),
);

const hello = Command.make(
  'hello',
  {
    ...connectionFlags,
    demo: demoFlag,
    lcd: Flag.Boolean('lcd').pipe(
      Flag.withDefault(false),
      Flag.withDescription('Also draw the first LCD strip, if supported.'),
    ),
  },
  (options) => runDevice('hello', options),
).pipe(Command.withDescription('Draw HELLO/OK on the first LCD key with a simulated gauge.'));
const events = Command.make('events', { ...connectionFlags, demo: demoFlag }, (options) =>
  runDevice('events', options),
).pipe(
  Command.withDescription(
    'Observe buttons, dials and completed touch gestures. Never write displays.',
  ),
);
const playgroundCommand = Command.make('playground', connectionFlags, (options) =>
  runDevice('playground', options),
).pipe(Command.withDescription('Run the editable button, knob and touch-zone script.'));
const pagesCommand = Command.make('pages', connectionFlags, (options) =>
  runDevice('pages', options),
).pipe(Command.withDescription('Run the editable two-page behavior script.'));
const mixerCommand = Command.make(
  'mixer',
  {
    ...connectionFlags,
    renderer: rendererFlag,
    mockAudio: Flag.Boolean('mock-audio').pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        'Eight simulated apps and output; can use real HID but never executes pactl.',
      ),
    ),
    step: Flag.Finite('step').pipe(
      Flag.withSchema(Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(20))),
      Flag.withDefault(2),
      Flag.withDescription('Volume percentage points per dial tick, default 2.'),
    ),
  },
  (options) => runDevice('mixer', options),
).pipe(
  Command.withDescription(
    'App volume and mute on the left dials; default-output MASTER on the rightmost dial. Swipe for more apps. --mock also mocks audio.',
  ),
);
const previewCommand = Command.make(
  'preview',
  {
    renderer: rendererFlag,
    output: Flag.String('output').pipe(
      Flag.withDefault('/tmp/streamdeck-mixer-preview.png'),
      Flag.withDescription('PNG destination, parent directory must exist.'),
    ),
  },
  ({ output, renderer }) => preview(output, renderer),
).pipe(
  Command.withDescription(
    'Render mixer appearance and states with illustrative values; no USB or audio connection.',
  ),
);
const studioCommand = Command.make(
  'studio',
  {
    ...connectionFlags,
    storage: Flag.Literals('storage', ['file', 'memory']).pipe(
      Flag.withDefault('file'),
      Flag.withDescription(
        'Application state backend; memory starts empty and is discarded on exit.',
      ),
    ),
    renderer: Flag.Literals('renderer', ['svg', 'react']).pipe(Flag.withDefault('react')),
    mockAudio: Flag.Boolean('mock-audio').pipe(Flag.withDefault(false)),
    port: Flag.Finite('port').pipe(
      Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 }))),
      Flag.withDefault(3900),
    ),
    profile: Flag.String('profile').pipe(
      Flag.optional,
      Flag.withDescription(
        'Local action profile JSON; defaults to the ignored .studio/profile.json in this clone.',
      ),
    ),
  },
  (options) => runDevice('studio', options),
).pipe(
  Command.withDescription(
    'Local React editor, live deck preview and configurable key actions alongside the audio mixer.',
  ),
);

const command = Command.make('streamdeck').pipe(
  Command.withDescription(
    'Stream Deck USB HID scripting with Effect v4. Ctrl+C releases the device and scoped plugin resources.',
  ),
  Command.withSubcommands([
    Command.make('gestures', connectionFlags, (options) => runDevice('gestures', options)).pipe(
      Command.withDescription(
        'Shared actions on short/long/double presses, encoders and touch; simulated hold, no microphone.',
      ),
    ),
    list,
    hello,
    events,
    playgroundCommand,
    pagesCommand,
    mixerCommand,
    previewCommand,
    studioCommand,
    Command.make('benchmark', {}, () => benchmark).pipe(
      Command.withDescription(
        'Compare warm SVG and React/Takumi raster timings without USB or audio.',
      ),
    ),
  ]),
);

NodeRuntime.runMain(
  Command.run(command, { version: '0.1.0' }).pipe(Effect.provide(NodeServices.layer)),
);
