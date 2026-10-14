import { NodeHttpServer } from '@effect/platform-node';
import { ByteSize, Console, Crypto, Effect, Path, Option, PubSub, Ref, Schedule, Schema, Semaphore, Stream } from 'effect';
import { HttpIncomingMessage, HttpRouter, HttpServerRequest, HttpServerResponse as Response } from 'effect/http';
import { Sse } from 'effect/encoding';
import * as Bindings from '../bindings.ts';
import * as Preview from '../deck-preview.ts';
import * as DesktopApps from '../desktop-apps.ts';
import * as Actions from '../studio-actions.ts';
import { Navigate, Organize, Trigger, UpdateBinding, UpdatePlugin, type ApplicationEntry, type Snapshot } from '../studio-contract.ts';
import { StreamDeck } from '../stream-deck.ts';
import type { DeckEvent } from '../model.ts';
import { slotsFor } from '../plugins/audio-mixer.ts';
import * as AudioMixer from '../plugins/audio-mixer.ts';
import * as Shortcuts from '../plugins/shortcuts.ts';
import * as Plugins from '../plugin-host.ts';
import * as PluginSettings from '../plugin-settings.ts';
import * as Layout from '../studio-layout.ts';
import * as PersonalPlugins from '../studio-plugins.ts';
import type { RendererKind } from '../mixer-renderer.ts';

export const startStudio = (options: { profile: string; mock?: boolean; renderer?: RendererKind; applications?: ReadonlyArray<ApplicationEntry>; configurePlugins?: (host: Effect.Success<typeof Plugins.make>) => Effect.Effect<unknown, unknown, import('effect').Scope.Scope> }) => Effect.gen(function*() {
  const original = yield* StreamDeck;
  const sessionId = yield* (yield* Crypto.Crypto).randomUUIDv4();
  const preview = yield* Preview.make(original);
  const deck = preview.device;
  const applications = options.applications ?? (yield* DesktopApps.discover);
  const input = yield* Ref.make<{ readonly pressed: ReadonlySet<number>; readonly pressedDials: ReadonlySet<number>; readonly sequence: number }>({ pressed: new Set(), pressedDials: new Set(), sequence: 0 });
  const inputViews = yield* Effect.acquireRelease(PubSub.sliding<Snapshot>(64), PubSub.shutdown);
  const lastEvent = yield* Ref.make('');
  const host = yield* Plugins.make.pipe(Effect.provideService(StreamDeck, deck));
  const settings = yield* PluginSettings.make(`${options.profile}.plugins.json`);
  const pluginLock = yield* Semaphore.make(1);
  const mixer = yield* host.install(AudioMixer.plugin({ renderer: options.renderer ?? 'react' }));
  const audioPage = (direction: number) => mixer.use((api) => api.changePage(direction)).pipe(Effect.mapError((error) => new Actions.StudioError({ message: error.message, status: error instanceof Plugins.PluginError ? error.status : 500 })));
  const shortcuts = yield* host.install(Shortcuts.plugin({ profile: options.profile, applications, audioPage }));
  yield* (options.configurePlugins ?? PersonalPlugins.configure)(host);
  for (const { id } of (yield* host.snapshot).items) if (settings.initial[id] ?? ['audio-mixer', 'shortcuts'].includes(id)) yield* host.setEnabled(id, true).pipe(Effect.catch((error) => Effect.logWarning('Plugin startup', error.id, error.message)));
  const actions = {
    save: (...args: Parameters<Shortcuts.Controller['save']>) => shortcuts.use((api) => api.save(...args)),
    press: (...args: Parameters<Shortcuts.Controller['press']>) => shortcuts.use((api) => api.press(...args)),
    cancel: (...args: Parameters<Shortcuts.Controller['cancel']>) => shortcuts.use((api) => api.cancel(...args)),
    organize: (...args: Parameters<Shortcuts.Controller['organize']>) => shortcuts.use((api) => api.organize(...args)),
    navigate: (...args: Parameters<Shortcuts.Controller['navigate']>) => shortcuts.use((api) => api.navigate(...args)),
  };
  const emptyLayout = Layout.project({ version: 2, zones: [{ id: 'deck', name: 'Zone principale', keys: deck.buttons.map((key) => key.index), items: [], pinned: {} }], folders: [] }, {}, 0);
  const fallbackView = { layout: emptyLayout.layout, keys: new Map([...emptyLayout.keys].map(([key, slot]) => [key, { ...slot, state: { count: 0, status: 'idle' as const, detail: '' } }])) };
  const lastActions = yield* Ref.make<Effect.Success<Shortcuts.Controller['view']>>(fallbackView);
  const binding = yield* Bindings.start({
    onEvent: (event: DeckEvent) => Effect.gen(function*() {
      if (event._tag === 'KeyDown' || event._tag === 'KeyUp' || event._tag === 'DialDown' || event._tag === 'DialUp') {
        yield* Ref.update(input, (before) => {
          const keyEvent = event._tag === 'KeyDown' || event._tag === 'KeyUp';
          const next = new Set(keyEvent ? before.pressed : before.pressedDials);
          const index = keyEvent ? event.key : event.dial;
          if (event._tag === 'KeyDown' || event._tag === 'DialDown') next.add(index); else next.delete(index);
          return { pressed: keyEvent ? next : before.pressed, pressedDials: keyEvent ? before.pressedDials : next, sequence: before.sequence + 1 };
        });
        yield* PubSub.publish(inputViews, yield* readSnapshot);
      }
      yield* Ref.set(lastEvent, event._tag === 'KeyDown' ? `Touche ${event.key + 1} · appui` : event._tag === 'KeyUp' ? `Touche ${event.key + 1} · relâchement`
        : event._tag === 'DialRotate' ? `Potard ${event.dial + 1} · ${event.delta > 0 ? '+' : ''}${event.delta}`
        : event._tag === 'DialDown' || event._tag === 'DialUp' ? `Potard ${event.dial + 1} · ${event._tag === 'DialDown' ? 'appui' : 'relâchement'}`
        : event._tag === 'TouchSwipe' ? 'LCD · glissement' : event._tag === 'TouchHold' ? 'LCD · appui long' : 'LCD · toucher');
    }),
  }).pipe(Effect.provideService(StreamDeck, deck));
  const readSnapshot: Effect.Effect<Snapshot> = Effect.gen(function*() {
    const inputView = yield* Ref.get(input);
    const currentActions = yield* shortcuts.current;
    const actionView = Option.isSome(currentActions) ? yield* currentActions.value.view : yield* Ref.get(lastActions);
    yield* Ref.set(lastActions, actionView);
    const frames = yield* preview.frames;
    const currentMixer = yield* mixer.current;
    const mix = Option.isSome(currentMixer) ? yield* currentMixer.value.state : undefined;
    const slots = deck.lcds[0]?.pixelSize && deck.dials.length ? slotsFor(deck.dials, deck.lcds[0]) : [];
    const appSlots = slots.slice(0, -1); const page = mix?.page ?? 0;
    return { plugins: yield* host.snapshot, layout: actionView.layout, sessionId, model: deck.info.model, mock: options.mock ?? false,
      keys: deck.buttons.map((key) => {
        const slot = actionView.keys.get(key.index)!;
        return { index: key.index, row: key.row ?? 0, column: key.column ?? key.index,
        width: key.pixelSize?.width ?? 112, height: key.pixelSize?.height ?? 112,
        id: Option.isSome(currentActions) ? slot.entry?.id ?? null : null, address: slot.address, zone: slot.zone, pinned: slot.pinned, navigation: slot.virtual,
        binding: Option.isSome(currentActions) ? slot.entry?.binding ?? null : null, revision: frames.get(`key/${key.index}`)?.revision ?? 0,
        pressed: inputView.pressed.has(key.index), count: slot.state.count,
        status: slot.state.status, detail: slot.state.detail,
      }; }),
      lcds: deck.lcds.map((lcd) => ({ index: lcd.index, width: lcd.pixelSize!.width, height: lcd.pixelSize!.height, revision: frames.get(`lcd/${lcd.index}`)?.revision ?? 0 })),
      dials: slots.map((slot, i) => {
        const master = i === slots.length - 1;
        const app = master ? mix?.master : mix?.apps.find((app) => app.key === mix.assignments[page * appSlots.length + i]);
        return { index: slot.dial, name: master && mix ? 'Master' : app?.name ?? null, volume: app?.volume ?? null, muted: app?.muted ?? false, pressed: inputView.pressedDials.has(slot.dial), master, x: slot.x, width: slot.width };
      }),
      page, pages: Math.max(1, Math.ceil((mix?.assignments.length ?? 0) / Math.max(1, appSlots.length))), lastEvent: yield* Ref.get(lastEvent), inputSequence: inputView.sequence,
    } satisfies Snapshot;
  });
  const setPlugin = (command: typeof UpdatePlugin.Type) => Semaphore.withPermits(pluginLock, 1)(Effect.gen(function*() {
    const before = (yield* host.snapshot).items.find((plugin) => plugin.id === command.id);
    if (!before) return yield* Effect.fail(new Plugins.PluginError({ id: command.id, reason: 'Unknown', status: 400, message: 'Plugin introuvable.' }));
    if (before.enabled !== command.expected) return yield* Effect.fail(new Plugins.PluginError({ id: command.id, reason: 'Conflict', status: 409, message: 'L’état du plugin a changé. Recharge avant de continuer.' }));
    yield* host.setEnabled(command.id, command.enabled);
    yield* settings.save(command.id, command.enabled).pipe(Effect.tapError(() => host.setEnabled(command.id, before.enabled).pipe(Effect.ignore)));
  }));
  return { snapshot: readSnapshot, applications, actions, preview, plugins: host, setPlugin,
    inputViews: Stream.fromPubSub(inputViews),
    changePage: audioPage,
    run: binding.run,
  };
});
export type Controller = Effect.Success<ReturnType<typeof startStudio>>;

/** Effect HTTP routes, independently testable without Vite or a browser. */
export const httpApp = (controller: Controller, origins: ReadonlyArray<string>) => Effect.gen(function*() {
  const router = yield* HttpRouter.make;
  const json = (body: unknown) => Response.jsonUnsafe(body, { headers: { 'cache-control': 'no-store' } });
  const recover = <A extends Response.HttpServerResponse, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.catch((error) => Effect.succeed(Response.jsonUnsafe({ message: error instanceof Error ? error.message : 'La requête a échoué.' }, { status: error instanceof Actions.StudioError || error instanceof Plugins.PluginError ? error.status : 400 }))));
  const mutate = <E, R>(body: Effect.Effect<Response.HttpServerResponse, E, R>) => recover(Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!origins.includes(request.headers.origin ?? '') || request.headers['x-streamdeck-studio'] !== '1') return Response.jsonUnsafe({ message: 'Origine de la requête refusée.' }, { status: 403 });
    return yield* body;
  }));
  yield* router.add('GET', '/api/state', Effect.map(controller.snapshot, json));
  yield* router.add('GET', '/api/catalogue', json({ actions: Actions.catalogue, applications: controller.applications.map(({ id, name }) => ({ id, name })) }));
  yield* router.add('GET', '/api/events', Effect.succeed(Response.stream(
    Stream.merge(Stream.fromEffectSchedule(controller.snapshot, Schedule.spaced(150)), controller.inputViews).pipe(
      Stream.map((snapshot) => JSON.stringify(snapshot)), Stream.changes,
      Stream.map((data) => new TextEncoder().encode(Sse.encoder.write({ _tag: 'Event', event: 'snapshot', data, id: undefined }))),
    ), { contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache', 'x-accel-buffering': 'no' } },
  )));
  yield* router.add('GET', '/api/image/:kind/:index', recover(Effect.gen(function*() {
    const { kind, index } = yield* HttpRouter.params;
    if ((kind !== 'key' && kind !== 'lcd') || !index || !/^\d+$/.test(index)) return Response.empty({ status: 404 });
    return Response.uint8Array(yield* controller.preview.png(kind, Number(index)), { contentType: 'image/png', headers: { 'cache-control': 'no-store' } });
  })));
  yield* router.add('PUT', '/api/binding', mutate(Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(UpdateBinding, { onExcessProperty: 'error' })));
    yield* controller.actions.save(body.key, body.binding, body.expected, body.address); return json(yield* controller.snapshot);
  })));
  yield* router.add('POST', '/api/trigger', mutate(Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Trigger, { onExcessProperty: 'error' })));
    yield* controller.actions.press(body.key, body.address); return json(yield* controller.snapshot);
  })));
  yield* router.add('POST', '/api/page', mutate(Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ direction: Schema.Literals([-1, 1]) }))));
    yield* controller.changePage(body.direction); return json(yield* controller.snapshot);
  })));
  yield* router.add('POST', '/api/cancel', mutate(Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Trigger, { onExcessProperty: 'error' })));
    yield* controller.actions.cancel(body.key, body.address); return json(yield* controller.snapshot);
  })));
  yield* router.add('POST', '/api/organize', mutate(Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Organize, { onExcessProperty: 'error' })));
    yield* controller.actions.organize(body); return json(yield* controller.snapshot);
  })));
  yield* router.add('POST', '/api/plugin', mutate(Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const command = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(UpdatePlugin, { onExcessProperty: 'error' })));
    yield* controller.setPlugin(command); return json(yield* controller.snapshot);
  })));
  yield* router.add('POST', '/api/navigate', mutate(Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Navigate, { onExcessProperty: 'error' })));
    yield* controller.actions.navigate(body); return json(yield* controller.snapshot);
  })));
  return router.asHttpEffect().pipe(Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(65536)));
});

/** Vite serves the frontend on demand; Effect platform owns each API request. */
export const studio = (options: { port: number; profile: string; mock: boolean; renderer?: RendererKind; configurePlugins?: NonNullable<Parameters<typeof startStudio>[0]['configurePlugins']> }) => Effect.gen(function*() {
  const controller = yield* startStudio(options);
  const scope = yield* Effect.scope;
  const app = yield* httpApp(controller, [`http://127.0.0.1:${options.port}`, `http://localhost:${options.port}`]);
  const handler = yield* NodeHttpServer.makeHandler(app, { scope });
  const path = yield* Path.Path;
  const root = yield* path.fromFileUrl(new URL('../../web', import.meta.url));
  const vite = yield* Effect.tryPromise(() => import('vite'));
  const server = yield* Effect.acquireRelease(Effect.tryPromise(() => vite.createServer({ configFile: false, root, server: { host: '127.0.0.1', port: options.port, strictPort: true },
      plugins: [{ name: 'effect-studio-api', configureServer(server) {
        server.middlewares.use((request, response, next) => request.url?.startsWith('/api/') ? handler(request, response) : next());
      } }],
    })), (server) => Effect.promise(() => {
      if (server.httpServer && 'closeAllConnections' in server.httpServer) server.httpServer.closeAllConnections();
      return server.close();
    }));
  yield* Effect.tryPromise(() => server.listen());
  yield* Console.log(JSON.stringify({ kind: 'studio-ready', url: `http://127.0.0.1:${options.port}`, profile: options.profile, mock: options.mock }));
  yield* controller.run;
});
