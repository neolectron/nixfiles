import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Console, Deferred, Effect, Fiber, Option, Ref, Schema, Stream } from 'effect';
import { CliError, Command, Flag } from 'effect/cli';
import { Audio, Hid, Mock, StreamDeck, discover, type DeckEvent } from './index.js';
import { startHello } from './scripts/hello.js';
import { playground } from './scripts/playground.js';
import { pages } from './scripts/pages.js';
import { mixer } from './scripts/audio-mixer.js';

const mockFlag = Flag.Boolean('mock').pipe(Flag.withDefault(false), Flag.withDescription('Use an in-memory device; never load native HID.'));
const demoFlag = Flag.Boolean('demo').pipe(Flag.withDefault(false), Flag.withDescription('Replay a finite mock input sequence. Requires --mock.'));
const connectionFlags = {
  mock: mockFlag,
  path: Flag.String('path').pipe(Flag.optional, Flag.withDescription('Exact device path from list; required when several devices are connected.')),
  duration: Flag.Finite('duration').pipe(
    Flag.withSchema(Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(86400))),
    Flag.optional, Flag.withDescription('Stop normally after this many seconds, in (0, 86400].'),
  ),
};
interface DeviceOptions {
  readonly mock: boolean;
  readonly path: Option.Option<string>;
  readonly duration: Option.Option<number>;
  readonly demo?: boolean;
  readonly lcd?: boolean;
  readonly step?: number;
}

const runDevice = (kind: 'hello' | 'events' | 'playground' | 'pages' | 'mixer', options: DeviceOptions) => Effect.gen(function*() {
  if (options.demo && !options.mock) return yield* new CliError.UserError({ cause: '--demo requires --mock.', userMessage: '--demo requires --mock.' });
  const mock = Mock.make();
  const body = Effect.scoped(Effect.gen(function*() {
    const deck = yield* StreamDeck;
    yield* Console.log(JSON.stringify({ kind: 'connected', path: deck.info.path, model: deck.info.model, buttons: deck.buttons.length, dials: deck.dials.length, lcds: deck.lcds.length, mock: options.mock }));
    const count = yield* Ref.make(0);
    const complete = yield* Deferred.make<void>();
    const observe = (event: DeckEvent) => Effect.gen(function*() {
      yield* Console.log(JSON.stringify(event));
      const n = yield* Ref.updateAndGet(count, (value) => value + 1);
      if (n === Mock.demoEvents.length) yield* Deferred.succeed(complete, undefined);
    });
    const hello = kind === 'hello' ? yield* startHello(!!options.lcd, observe) : undefined;
    const events = kind === 'events' ? yield* deck.subscribe : undefined;
    const run = hello?.run ?? (events ? Stream.runForEach(events, observe) : kind === 'pages' ? pages : kind === 'mixer'
      ? mixer(options.step === undefined ? {} : { step: options.step }).pipe(Effect.provide(options.mock ? Audio.mockLayer : Audio.layer)) : playground);
    if (options.demo) {
      const fiber = yield* Effect.forkScoped(run);
      for (const event of Mock.demoEvents) yield* mock.emit(event);
      yield* Effect.raceFirst(Deferred.await(complete), Fiber.join(fiber));
      const state = hello ? yield* hello.state : undefined;
      yield* Console.log(JSON.stringify({ kind: 'demo-complete', frames: mock.writes.filter((write) => write.kind === 'key').length, lcdFrames: mock.writes.filter((write) => write.kind === 'lcd').length, level: state?.level, events: yield* Ref.get(count) }));
    } else {
      yield* Console.log('Listening. Ctrl+C to stop.');
      yield* Option.match(options.duration, { onNone: () => run, onSome: (seconds) => Effect.raceFirst(run, Effect.sleep(seconds * 1000)) });
    }
  }));
  const openOptions = Option.match(options.path, { onNone: () => ({}), onSome: (path) => ({ path }) });
  yield* body.pipe(Effect.provide(options.mock ? mock.layer(openOptions) : Hid.layer(openOptions)));
});

const list = Command.make('list', { mock: mockFlag }, ({ mock }) => Effect.gen(function*() {
  const devices = yield* discover.pipe(Effect.provide(mock ? Mock.make().driverLayer : Hid.driverLayer));
  yield* Console.log(JSON.stringify(devices, null, 2));
})).pipe(Command.withDescription('Discover models, actual USB IDs and capabilities without opening a handle.'));

const hello = Command.make('hello', {
  ...connectionFlags, demo: demoFlag,
  lcd: Flag.Boolean('lcd').pipe(Flag.withDefault(false), Flag.withDescription('Also draw the first LCD strip, if supported.')),
}, (options) => runDevice('hello', options)).pipe(Command.withDescription('Draw HELLO/OK on the first LCD key with a simulated gauge.'));
const events = Command.make('events', { ...connectionFlags, demo: demoFlag }, (options) => runDevice('events', options))
  .pipe(Command.withDescription('Observe buttons, dials and completed touch gestures. Never write displays.'));
const playgroundCommand = Command.make('playground', connectionFlags, (options) => runDevice('playground', options))
  .pipe(Command.withDescription('Run the editable button, knob and touch-zone script.'));
const pagesCommand = Command.make('pages', connectionFlags, (options) => runDevice('pages', options))
  .pipe(Command.withDescription('Run the editable two-page behavior script.'));
const mixerCommand = Command.make('mixer', {
  ...connectionFlags,
  step: Flag.Finite('step').pipe(Flag.withSchema(Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(20))), Flag.withDefault(2), Flag.withDescription('Volume percentage points per dial tick, default 2.')),
}, (options) => runDevice('mixer', options)).pipe(Command.withDescription('Show playback apps above the dials: rotate for volume, click to mute, swipe for more apps. --mock also mocks audio.'));

const command = Command.make('streamdeck').pipe(
  Command.withDescription('Stream Deck USB HID scripting with Effect v4. Ctrl+C releases the device; images remain displayed.'),
  Command.withSubcommands([list, hello, events, playgroundCommand, pagesCommand, mixerCommand]),
);

NodeRuntime.runMain(Command.run(command, { version: '0.1.0' }).pipe(Effect.provide(NodeServices.layer)));
