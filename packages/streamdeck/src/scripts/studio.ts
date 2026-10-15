import * as SystemRuntime from '@nixfiles/system-control/runtime.ts';
import { PersistentState } from '@nixfiles/system-control/persistent-state.ts';
import { StateStorage } from '@nixfiles/system-control/state-storage.ts';
import * as FileStorage from '@nixfiles/system-control/state-storage-file.ts';
import * as Notes from '@nixfiles/system-control/notes.ts';
import { Update as NoteUpdate } from '@nixfiles/system-control/notes-contract.ts';
import * as Speech from '@nixfiles/system-control/speech.ts';
import * as NotesPlugin from '../plugins/notes.ts';
import { Discord as SystemDiscord } from '@nixfiles/system-control/discord.ts';
import { invariant } from '../errors.ts';
import { NodeHttpServer } from '@effect/platform-node';
import {
  ByteSize,
  Console,
  Context,
  Crypto,
  Effect,
  FileSystem,
  Layer,
  Path,
  Option,
  PubSub,
  Ref,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse as Response,
} from 'effect/http';
import { Sse } from 'effect/encoding';
import * as Bindings from '../bindings.ts';
import * as Preview from '../deck-preview.ts';
import * as PresentationAssets from '../presentation-assets.ts';
import { webSnapshot } from '../studio-presentation.ts';
import * as Events from '../studio-events.ts';
import * as DesktopApps from '@nixfiles/system-control/desktop.ts';
import * as Actions from '../studio-actions.tsx';
import { StudioError } from '../studio-errors.ts';
import {
  KeyInput,
  DialInput,
  LcdTap,
  Navigate,
  Organize,
  Trigger,
  UpdateBinding,
  UpdateProfile,
  UpdatePlugin,
  type ApplicationEntry,
  type Snapshot,
} from '../studio-contract.ts';
import { StreamDeck } from '../stream-deck.ts';
import type { DeckEvent } from '../model.ts';
import { slotsFor } from '../plugins/audio-mixer.ts';
import * as AudioMixer from '../plugins/audio-mixer.ts';
import * as Commands from '../plugins/commands.ts';
import * as Shortcuts from '../plugins/shortcuts.ts';
import * as Plugins from '../plugin-host.ts';
import * as PluginSettings from '../plugin-settings.ts';
import * as Layout from '../studio-layout.ts';
import * as Takumi from '../takumi.ts';
import * as PersonalPlugins from '../studio-plugins.ts';
import {
  DiscordConnection,
  DiscordOAuth,
  make as makeDiscordConnection,
} from '@nixfiles/system-control/discord-connection.ts';
import { AppInput } from '@nixfiles/system-control/discord-contract.ts';
import { DiscordTransport } from '@nixfiles/system-control/discord-ipc.ts';
import type { RendererKind } from '../mixer-renderer.ts';
import * as Cards from '../mixer-cards.ts';
import * as LcdSurface from '../lcd-surface.tsx';
import * as LcdLayout from '../lcd-layout.ts';
import { LcdSpace } from '../lcd-space.ts';
import { Desktop as SystemDesktop } from '@nixfiles/system-control/desktop.ts';
const json = (body: unknown) =>
  Response.jsonUnsafe(body, { headers: { 'cache-control': 'no-store' } });
const recover = <A extends Response.HttpServerResponse, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.succeed(
        Response.jsonUnsafe(
          { message: error instanceof Error ? error.message : 'La requête a échoué.' },
          {
            status:
              error instanceof StudioError ||
              error instanceof Plugins.PluginError ||
              error instanceof Notes.NoteError
                ? error.status
                : 400,
          },
        ),
      ),
    ),
  );
export const startStudio = (options: {
  profile: string;
  mock?: boolean;
  renderer?: RendererKind;
  applications?: ReadonlyArray<ApplicationEntry>;
  origin?: string;
  /** Provide one scoped adapter for layout, plugin preferences, notes and plugin state. */
  persistence?: Layer.Layer<
    StateStorage,
    unknown,
    FileSystem.FileSystem | Path.Path | Crypto.Crypto
  >;
  configurePlugins?: (
    host: Effect.Success<typeof Plugins.make>,
  ) => Effect.Effect<unknown, unknown, import('effect').Scope.Scope | PersistentState>;
}) =>
  Effect.gen(function* () {
    const original = yield* StreamDeck;
    const platform = yield* Effect.context<Crypto.Crypto | FileSystem.FileSystem | Path.Path>();
    const sessionId = yield* (yield* Crypto.Crypto).randomUUIDv4();
    const events = yield* Events.make(original);
    const preview = yield* Preview.make(events.device);
    const renderer = Context.get(
      yield* Layer.build(Takumi.ReactRenderer.layer),
      Takumi.ReactRenderer,
    );
    const lcdSurface = yield* LcdSurface.make(preview.device, renderer);
    const deck = lcdSurface.device;
    const applications = options.applications ?? (yield* DesktopApps.discover);
    const input = yield* Ref.make<{
      readonly pressed: ReadonlySet<number>;
      readonly pressedDials: ReadonlySet<number>;
      readonly dialRotations: ReadonlyMap<number, number>;
      readonly sequence: number;
    }>({ pressed: new Set(), pressedDials: new Set(), dialRotations: new Map(), sequence: 0 });
    const inputViews = yield* Effect.acquireRelease(PubSub.sliding<Snapshot>(64), PubSub.shutdown);
    const heldKeys = new Map<string, number>();
    const heldDials = new Map<string, number>();
    const lastEvent = yield* Ref.make('');
    const cards = yield* Cards.make;
    const assets = yield* PresentationAssets.make;
    const host = yield* Plugins.make.pipe(Effect.provideService(StreamDeck, deck));
    const path = yield* Path.Path;
    const persistenceServices = yield* Layer.build(
      PersistentState.layer.pipe(
        Layer.provideMerge(options.persistence ?? FileStorage.layer(path.dirname(options.profile))),
      ),
    );
    const persistentState = Context.get(persistenceServices, PersistentState);
    const notes = yield* Notes.makeWithState().pipe(Effect.provideContext(persistenceServices));
    const speech = Context.get(yield* Layer.build(Speech.Speech.layer), Speech.Speech);
    const noteOpener = yield* NotesPlugin.opener(options.origin ?? 'http://127.0.0.1:3900');
    const settings = yield* PluginSettings.makeWithState(
      `${path.basename(options.profile)}.plugins.json`,
    ).pipe(Effect.provideContext(persistenceServices));
    const discordConnection = yield* makeDiscordConnection(
      `${options.profile}.discord-connection.json`,
    );
    const pluginLock = yield* Semaphore.make(1);
    const mixer = yield* host
      .install(AudioMixer.plugin({ renderer: options.renderer ?? 'react' }))
      .pipe(
        Effect.provideService(Takumi.ReactRenderer, renderer),
        Effect.provideService(Cards.MixerCards, cards),
        Effect.provideService(LcdSpace, lcdSurface.space),
      );
    const audioPage = (direction: number) =>
      mixer
        .use((api) => api.changePage(direction))
        .pipe(
          Effect.mapError(
            (error) =>
              new StudioError({
                message: error.message,
                status: error instanceof Plugins.PluginError ? error.status : 500,
              }),
          ),
        );
    yield* host.install(Commands.plugin(applications));
    const shortcuts = yield* host
      .install(
        Shortcuts.plugin({
          profile: options.profile,
          overlays: host.overlays,
          applications,
          audioPage,
          pluginActions: {
            validate: (plugin, command, currentInput) =>
              host
                .validateAction(plugin, command, currentInput, 'key')
                .pipe(
                  Effect.mapError(
                    (error) => new StudioError({ message: error.message, status: 400 }),
                  ),
                ),
            invoke: (plugin, command, currentInput, context) =>
              host
                .invoke(plugin, command, currentInput, context)
                .pipe(
                  Effect.mapError(
                    (error) => new StudioError({ message: error.message, status: error.status }),
                  ),
                ),
            feedback: host.feedback,
            interaction: host.interaction,
          },
        }),
      )
      .pipe(
        Effect.provideService(Takumi.ReactRenderer, renderer),
        Effect.provideContext(persistenceServices),
      );
    const systemServices =
      options.configurePlugins || options.mock
        ? Context.empty()
        : yield* Layer.build(
            SystemRuntime.integrationsLayer.pipe(
              Layer.provide(Layer.succeed(DiscordConnection, discordConnection)),
            ),
          );
    if (options.configurePlugins)
      yield* options
        .configurePlugins(host)
        .pipe(
          Effect.provideService(Takumi.ReactRenderer, renderer),
          Effect.provideService(Cards.MixerCards, cards),
          Effect.provideContext(persistenceServices),
          Effect.provideService(PresentationAssets.PresentationAssets, assets),
        );
    else
      yield* PersonalPlugins.configure(host).pipe(
        Effect.provideService(LcdSurface.LcdSurface, lcdSurface),
        Effect.provideService(PresentationAssets.PresentationAssets, assets),
        Effect.provideContext(persistenceServices),
        Effect.provideService(Notes.Notes, notes),
        Effect.provideService(Speech.Speech, speech),
        Effect.provideService(NotesPlugin.NoteOpener, noteOpener),
        Effect.provideContext(systemServices),
        Effect.provideService(Takumi.ReactRenderer, renderer),
        Effect.provideService(DiscordConnection, discordConnection),
        Effect.provideService(Cards.MixerCards, cards),
      );
    for (const { id } of (yield* host.snapshot).items)
      if (
        settings.initial[id] ??
        (['audio-mixer', 'shortcuts', 'commands'].includes(id) ||
          (id === 'system' && !options.mock))
      )
        yield* host
          .setEnabled(id, true)
          .pipe(
            Effect.catch((error) => Effect.logWarning('Plugin startup', error.id, error.message)),
          );
    const actions = {
      saveProfile: (...args: Parameters<Shortcuts.Controller['saveProfile']>) =>
        Effect.gen(function* () {
          const candidate = yield* Schema.decodeUnknownEffect(UpdateProfile.fields.profile)(
            args[0],
          );
          yield* lcdSurface.validate(candidate.lcd ?? LcdLayout.empty, host);
          yield* shortcuts.use((api) => api.saveProfile(...args));
          yield* refreshSurface;
        }),
      save: (...args: Parameters<Shortcuts.Controller['save']>) =>
        shortcuts.use((api) => api.save(...args)),
      press: (...args: Parameters<Shortcuts.Controller['press']>) =>
        shortcuts.use((api) => api.press(...args)),
      keyInput: (...args: Parameters<Shortcuts.Controller['keyInput']>) =>
        shortcuts.use((api) => api.keyInput(...args)),
      release: (...args: Parameters<Shortcuts.Controller['release']>) =>
        shortcuts.use((api) => api.release(...args)),
      cancel: (...args: Parameters<Shortcuts.Controller['cancel']>) =>
        shortcuts.use((api) => api.cancel(...args)),
      organize: (...args: Parameters<Shortcuts.Controller['organize']>) =>
        shortcuts.use((api) => api.organize(...args)),
      navigate: (...args: Parameters<Shortcuts.Controller['navigate']>) =>
        shortcuts.use((api) => api.navigate(...args)),
    };
    const emptyLayout = Layout.project(
      {
        version: 2,
        zones: [
          {
            id: 'deck',
            name: 'Zone principale',
            keys: deck.buttons.map((key) => key.index),
            items: [],
            pinned: {},
          },
        ],
        folders: [],
      },
      {},
      0,
    );
    const fallbackView = {
      configuration: {
        profile: {
          version: 2 as const,
          zones: [
            {
              id: 'deck',
              name: 'Zone principale',
              keys: deck.buttons.map((key) => key.index),
              items: [],
              pinned: {},
            },
          ],
          folders: [],
        },
        navigation: {},
        revision: 0,
      },
      layout: emptyLayout.layout,
      keys: new Map(
        [...emptyLayout.keys].map(([key, slot]) => [
          key,
          {
            ...slot,
            overlay: undefined,
            state: { count: 0, status: 'idle' as const, detail: '', feedback: null },
          },
        ]),
      ),
    };
    const lastActions = yield* Ref.make<Effect.Success<Shortcuts.Controller['view']>>(fallbackView);
    const binding = yield* Bindings.start({
      onEvent: (event: DeckEvent) =>
        Effect.gen(function* () {
          if (
            'key' in event ||
            event._tag === 'DialDown' ||
            event._tag === 'DialUp' ||
            event._tag === 'DialCancel'
          ) {
            const keyEvent = 'key' in event;
            const index = keyEvent ? event.key : event.dial;
            const held = keyEvent ? heldKeys : heldDials;
            const channel = `${event.origin?.source ?? 'physical'}/${index}`;
            if (event._tag === 'KeyDown' || event._tag === 'DialDown') held.set(channel, index);
            else held.delete(channel);
            yield* Ref.update(input, (before) => ({
              ...before,
              pressed: new Set(heldKeys.values()),
              pressedDials: new Set(heldDials.values()),
              sequence: before.sequence + 1,
            }));
            yield* PubSub.publish(inputViews, yield* readSnapshot);
          }
          if (event._tag === 'DialRotate') {
            yield* Ref.update(input, (before) => ({
              ...before,
              dialRotations: new Map(before.dialRotations).set(
                event.dial,
                (before.dialRotations.get(event.dial) ?? 0) + event.delta,
              ),
              sequence: before.sequence + 1,
            }));
            yield* PubSub.publish(inputViews, yield* readSnapshot);
          }
          yield* Ref.set(
            lastEvent,
            event._tag === 'KeyDown'
              ? `Touche ${event.key + 1} · appui`
              : event._tag === 'KeyUp' || event._tag === 'KeyCancel'
                ? `Touche ${event.key + 1} · relâchement`
                : event._tag === 'DialRotate'
                  ? `Potard ${event.dial + 1} · ${event.delta > 0 ? '+' : ''}${event.delta}`
                  : event._tag === 'DialDown' ||
                      event._tag === 'DialUp' ||
                      event._tag === 'DialCancel'
                    ? `Potard ${event.dial + 1} · ${event._tag === 'DialDown' ? 'appui' : 'relâchement'}`
                    : event._tag === 'TouchSwipe'
                      ? 'LCD · glissement'
                      : event._tag === 'TouchHold'
                        ? 'LCD · appui long'
                        : 'LCD · toucher',
          );
        }),
    }).pipe(Effect.provideService(StreamDeck, deck));
    const sharedDesktop = Context.getOption(systemServices, SystemDesktop);
    const focusedApplication = Option.isSome(sharedDesktop)
      ? sharedDesktop.value.focused.pipe(
          Effect.map((window) => window?.app_id ?? null),
          Effect.orElseSucceed(() => null),
        )
      : Effect.succeed(null);
    const refreshSurface = Effect.gen(function* () {
      const current = yield* shortcuts.current;
      const profile = Option.isSome(current)
        ? yield* current.value.profile
        : (yield* Ref.get(lastActions)).configuration.profile;
      const before = yield* lcdSurface.snapshot;
      yield* lcdSurface.refresh(profile.lcd ?? LcdLayout.empty, host, yield* focusedApplication);
      if ((yield* lcdSurface.snapshot).revision !== before.revision) {
        const currentMixer = yield* mixer.current;
        if (Option.isSome(currentMixer)) yield* currentMixer.value.redraw;
      }
    }).pipe(Effect.catch((cause) => Effect.logWarning('LCD surface', cause)));
    const readSnapshot: Effect.Effect<Snapshot> = Effect.gen(function* () {
      const inputView = yield* Ref.get(input);
      const currentActions = yield* shortcuts.current;
      const actionView = Option.isSome(currentActions)
        ? yield* currentActions.value.view
        : yield* Ref.get(lastActions);
      yield* Ref.set(lastActions, actionView);
      const frames = yield* preview.frames;
      const currentMixer = yield* mixer.current;
      const mix = Option.isSome(currentMixer) ? yield* currentMixer.value.state : undefined;
      const regions = Option.isSome(currentMixer) ? yield* currentMixer.value.regions : [];
      const scene = Option.isSome(currentMixer) ? yield* currentMixer.value.scene : undefined;
      const slots =
        deck.lcds[0]?.pixelSize && deck.dials.length ? slotsFor(deck.dials, deck.lcds[0]) : [];
      const appSlots = slots.slice(0, -1);
      const page = mix?.page ?? 0;
      const dials = yield* Effect.forEach(slots, (slot, i) =>
        Effect.gen(function* () {
          const master = i === slots.length - 1;
          const app = master
            ? mix?.master
            : mix?.apps.find(
                (candidateApp) => candidateApp.key === mix.assignments[page * appSlots.length + i],
              );
          const key = app && 'key' in app ? app.key : null;
          const interaction = app && 'key' in app ? ((yield* cards.label(app)) ?? null) : null;
          return {
            index: slot.dial,
            key,
            interaction,
            cardWidth: regions.find((region) => region.dial === slot.dial)?.width ?? slot.width,
            name: master && mix ? 'Master' : (app?.name ?? null),
            volume: app?.volume ?? null,
            muted: app?.muted ?? false,
            pressed: inputView.pressedDials.has(slot.dial),
            rotationSteps: inputView.dialRotations.get(slot.dial) ?? 0,
            master,
            x: slot.x,
            width: slot.width,
          };
        }),
      );
      const lcds = yield* Effect.forEach(deck.lcds, (lcd) =>
        Effect.gen(function* () {
          const composedScene = yield* lcdSurface.scene(lcd.index, lcd.index === 0 ? scene : []);
          return {
            index: lcd.index,
            width: invariant(lcd.pixelSize, 'studio').width,
            height: invariant(lcd.pixelSize, 'studio').height,
            revision: frames.get(`lcd/${lcd.index}`)?.revision ?? 0,
            ...(composedScene ? { scene: composedScene } : {}),
          };
        }),
      );
      return {
        lcdLayout: yield* lcdSurface.snapshot,
        discordConnection: yield* discordConnection.publicState,
        plugins: yield* host.snapshot,
        configuration: actionView.configuration,
        layout: actionView.layout,
        sessionId,
        model: (yield* deck.detectedModel ?? Effect.succeed(deck.info.model)) ?? 'Stream Deck',
        mock: options.mock ?? false,
        connected: options.mock ? false : yield* deck.connected ?? Effect.succeed(true),
        connectionError: yield* deck.connectionError ?? Effect.succeed(null),
        keys: deck.buttons.map((key) => {
          const slot = invariant(actionView.keys.get(key.index), 'studio');
          return {
            index: key.index,
            row: key.row ?? 0,
            column: key.column ?? key.index,
            width: key.pixelSize?.width ?? 112,
            height: key.pixelSize?.height ?? 112,
            id: Option.isSome(currentActions) ? (slot.entry?.id ?? null) : null,
            address: slot.address,
            zone: slot.zone,
            pinned: slot.pinned,
            navigation: slot.virtual,
            overlay: 'overlay' in slot ? slot.overlay : undefined,
            binding: Option.isSome(currentActions) ? (slot.entry?.binding ?? null) : null,
            revision: frames.get(`key/${key.index}`)?.revision ?? 0,
            pressed: inputView.pressed.has(key.index),
            count: slot.state.count,
            status: slot.state.status,
            detail: slot.state.detail,
            feedback: slot.state.feedback ?? null,
          };
        }),
        lcds,
        dials,
        page,
        pages: Math.max(
          1,
          Math.ceil((mix?.assignments.length ?? 0) / Math.max(1, appSlots.length)),
        ),
        lastEvent: yield* Ref.get(lastEvent),
        inputSequence: inputView.sequence,
      } satisfies Snapshot;
    });
    const setPlugin = (command: typeof UpdatePlugin.Type) =>
      Semaphore.withPermits(
        pluginLock,
        1,
      )(
        Effect.gen(function* () {
          const before = (yield* host.snapshot).items.find((plugin) => plugin.id === command.id);
          if (!before)
            return yield* Effect.fail(
              new Plugins.PluginError({
                id: command.id,
                reason: 'Unknown',
                status: 400,
                message: 'Plugin introuvable.',
              }),
            );
          if (before.enabled !== command.expected)
            return yield* Effect.fail(
              new Plugins.PluginError({
                id: command.id,
                reason: 'Conflict',
                status: 409,
                message: 'L’état du plugin a changé. Recharge avant de continuer.',
              }),
            );
          yield* host.setEnabled(command.id, command.enabled);
          yield* settings
            .save(command.id, command.enabled)
            .pipe(
              Effect.tapError(() =>
                host.setEnabled(command.id, before.enabled).pipe(Effect.ignore),
              ),
            );
        }),
      );
    const configureDiscord = (candidateInput: typeof AppInput.Type) =>
      Semaphore.withPermits(
        pluginLock,
        1,
      )(
        Effect.gen(function* () {
          yield* host.setEnabled('discord', false);
          yield* discordConnection.configure(candidateInput);
          yield* settings.save('discord', false);
        }),
      );
    const connectDiscord = Semaphore.withPermits(
      pluginLock,
      1,
    )(
      Effect.gen(function* () {
        yield* host.setEnabled('discord', false);
        yield* discordConnection.connect.pipe(
          Effect.provide(Layer.mergeAll(DiscordTransport.layer, DiscordOAuth.layer)),
          Effect.provideContext(platform),
        );
        const sharedDiscord = Context.getOption(systemServices, SystemDiscord);
        if (Option.isSome(sharedDiscord)) yield* sharedDiscord.value.reconnect;
        yield* host.setEnabled('discord', true);
        yield* settings.save('discord', true);
      }),
    );
    const keyInput = (body: typeof KeyInput.Type) =>
      Effect.gen(function* () {
        const view = yield* readSnapshot;
        const key = view.keys.find((candidate) => candidate.index === body.key);
        if (!key) return yield* new StudioError({ status: 400, message: 'Touche inconnue.' });
        if (
          body.phase === 'down' &&
          (body.address !== key.address || body.revision !== view.layout.revision)
        )
          return yield* new StudioError({
            status: 409,
            message: 'La disposition a changé. Recharge la touche.',
          });
        const source = body.owner ? `web/${body.owner}` : 'web';
        const owner = view.plugins.items.find(
          (plugin) => plugin.enabled && plugin.keys.includes(body.key),
        );
        if (owner?.id === 'shortcuts')
          yield* actions.keyInput(body.key, body.phase, body.address, source, body.revision);
        yield* events.emit({
          _tag: body.phase === 'down' ? 'KeyDown' : body.phase === 'up' ? 'KeyUp' : 'KeyCancel',
          key: body.key,
          origin: { source, address: body.address, revision: body.revision },
        });
      });
    return {
      persistentState,
      assets,
      notes,
      speech,
      snapshot: readSnapshot,
      keyInput,
      dialInput: (body: typeof DialInput.Type) =>
        Effect.gen(function* () {
          const view = yield* readSnapshot;
          const dial = view.dials.find((candidate) => candidate.index === body.dial);
          if (!dial) return yield* new StudioError({ status: 400, message: 'Potard inconnu.' });
          if (
            body.sessionId !== sessionId ||
            body.application !== dial.key ||
            (!dial.master && body.page !== view.page)
          )
            return yield* new StudioError({
              status: 409,
              message: 'L’affectation du potard a changé. Recommence le geste.',
            });
          yield* events.emit({
            _tag: 'DialRotate',
            dial: body.dial,
            delta: body.delta,
            origin: { source: 'web', address: body.application ?? '', revision: body.page },
          });
        }),
      applications,
      actions,
      preview,
      plugins: host,
      setPlugin,
      rendererStats: renderer.stats,
      configureDiscord,
      connectDiscord,
      inputViews: Stream.fromPubSub(inputViews),
      changePage: audioPage,
      lcdTap: (candidateInput: typeof LcdTap.Type) =>
        mixer.use((api) =>
          api.tapDial(candidateInput.dial, candidateInput.application, candidateInput.page),
        ),
      lcdInput: (body: typeof LcdLayout.Input.Type) =>
        Effect.gen(function* () {
          const current = yield* lcdSurface.snapshot;
          if (body.sessionId !== sessionId || body.revision !== current.revision)
            return yield* new StudioError({
              status: 409,
              message: 'La surface LCD a changé. Recommence le geste.',
            });
          yield* lcdSurface.input(body.lcd, body.kind, body.x, body.y, body.toX);
          yield* refreshSurface;
        }),
      lcdNavigate: (command: LcdLayout.Command) =>
        lcdSurface.navigate(command).pipe(Effect.andThen(refreshSurface)),
      lcdSurface,
      run: Effect.all(
        [
          binding.run,
          Effect.forever(refreshSurface.pipe(Effect.andThen(Effect.sleep(250)))),
          Stream.runForEach(deck.connectionChanges ?? Stream.empty, (connected) =>
            connected
              ? Effect.void
              : Effect.gen(function* () {
                  for (const key of deck.buttons)
                    yield* events.emit({ _tag: 'KeyCancel', key: key.index });
                  for (const dial of deck.dials)
                    yield* events.emit({ _tag: 'DialCancel', dial: dial.index });
                }),
          ),
        ],
        { concurrency: 'unbounded' },
      ).pipe(Effect.asVoid),
    };
  });
export type Controller = Effect.Success<ReturnType<typeof startStudio>>;
/** Effect HTTP routes, independently testable without Vite or a browser. */
export const httpApp = (controller: Controller, origins: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const router = yield* HttpRouter.make;
    const mutate = <E, R>(body: Effect.Effect<Response.HttpServerResponse, E, R>) =>
      recover(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (
            !origins.includes(request.headers.origin ?? '') ||
            request.headers['x-streamdeck-studio'] !== '1'
          )
            return Response.jsonUnsafe(
              { message: 'Origine de la requête refusée.' },
              { status: 403 },
            );
          return yield* body;
        }),
      );
    yield* router.add('GET', '/api/state', Effect.map(controller.snapshot, json));
    yield* router.add(
      'POST',
      '/api/lcd-input',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const input = yield* request.json.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(LcdLayout.Input, { onExcessProperty: 'error' }),
            ),
          );
          yield* controller.lcdInput(input);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/lcd-navigation',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const input = yield* request.json.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(LcdLayout.Command, { onExcessProperty: 'error' }),
            ),
          );
          yield* controller.lcdNavigate(input);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'GET',
      '/api/notes',
      recover(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('id') ?? '';
          return json({
            note: yield* controller.notes.read(id),
            activity: yield* controller.speech.activity,
          });
        }),
      ),
    );
    yield* router.add(
      'PUT',
      '/api/notes',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const input = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(NoteUpdate, { onExcessProperty: 'error' })),
          );
          return json(yield* controller.notes.save(input));
        }),
      ).pipe(Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(524288))),
    );
    yield* router.add(
      'POST',
      '/api/dial-input',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const input = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(DialInput, { onExcessProperty: 'error' })),
          );
          yield* controller.dialInput(input);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/lcd-tap',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const input = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(LcdTap, { onExcessProperty: 'error' })),
          );
          yield* controller.lcdTap(input);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'PUT',
      '/api/discord/connection',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const input = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(AppInput, { onExcessProperty: 'error' })),
            Effect.mapError(
              () =>
                new StudioError({
                  message: 'Identifiant, secret ou port Discord invalide.',
                  status: 400,
                }),
            ),
          );
          yield* controller.configureDiscord(input);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/discord/authorize',
      mutate(controller.connectDiscord.pipe(Effect.andThen(controller.snapshot), Effect.map(json))),
    );
    yield* router.add(
      'GET',
      '/api/catalogue',
      Effect.map(controller.plugins.catalogue, (pluginActions) =>
        json({
          actions: Actions.catalogue,
          pluginActions,
          applications: controller.applications.map(({ id, name }) => ({ id, name })),
        }),
      ),
    );
    yield* router.add(
      'GET',
      '/api/events',
      Effect.succeed(
        Response.stream(
          Stream.merge(
            Stream.fromEffectSchedule(controller.snapshot, Schedule.spaced(150)),
            controller.inputViews,
          ).pipe(
            Stream.map((snapshot) => JSON.stringify(webSnapshot(snapshot))),
            Stream.changes,
            Stream.map((data) =>
              new TextEncoder().encode(
                Sse.encoder.write({ _tag: 'Event', event: 'snapshot', data, id: undefined }),
              ),
            ),
          ),
          {
            contentType: 'text/event-stream',
            headers: { 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
          },
        ),
      ),
    );
    yield* router.add(
      'GET',
      '/api/assets/:id',
      Effect.gen(function* () {
        const { id } = yield* HttpRouter.params;
        const asset = id ? yield* controller.assets.get(id) : undefined;
        if (!asset) return Response.empty({ status: 404 });
        const etag = `"${asset.id}"`;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const headers = { 'cache-control': 'private, max-age=86400, immutable', etag };
        return request.headers['if-none-match'] === etag
          ? Response.empty({ status: 304, headers })
          : Response.uint8Array(asset.bytes, { contentType: asset.contentType, headers });
      }),
    );
    yield* router.add(
      'GET',
      '/api/image/:kind/:index',
      recover(
        Effect.gen(function* () {
          const { kind, index } = yield* HttpRouter.params;
          if ((kind !== 'key' && kind !== 'lcd') || !index || !/^\d+$/.test(index))
            return Response.empty({ status: 404 });
          return Response.uint8Array(yield* controller.preview.png(kind, Number(index)), {
            contentType: 'image/png',
            headers: { 'cache-control': 'no-store' },
          });
        }),
      ),
    );
    yield* router.add(
      'PUT',
      '/api/profile',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(UpdateProfile, { onExcessProperty: 'error' }),
            ),
          );
          if (body.sessionId !== (yield* controller.snapshot).sessionId)
            return yield* Effect.fail(
              new StudioError({
                message: 'Le moteur a redémarré. Annule ou recharge avant d’enregistrer.',
                status: 409,
              }),
            );
          yield* controller.actions.saveProfile(
            body.profile,
            body.navigation,
            body.expectedRevision,
            body.expectedProfile,
          );
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'PUT',
      '/api/binding',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(UpdateBinding, { onExcessProperty: 'error' }),
            ),
          );
          yield* controller.actions.save(body.key, body.binding, body.expected, body.address);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/trigger',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Trigger, { onExcessProperty: 'error' })),
          );
          yield* controller.actions.press(body.key, body.address);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/key-input',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(KeyInput, { onExcessProperty: 'error' })),
          );
          yield* controller.keyInput(body);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/release',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Trigger, { onExcessProperty: 'error' })),
          );
          yield* controller.actions.release(body.key, body.address);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/page',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.Struct({ direction: Schema.Literals([-1, 1]) })),
            ),
          );
          yield* controller.changePage(body.direction);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/cancel',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Trigger, { onExcessProperty: 'error' })),
          );
          yield* controller.actions.cancel(body.key, body.address);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/organize',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Organize, { onExcessProperty: 'error' })),
          );
          yield* controller.actions.organize(body);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/plugin',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const command = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(UpdatePlugin, { onExcessProperty: 'error' })),
          );
          yield* controller.setPlugin(command);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    yield* router.add(
      'POST',
      '/api/navigate',
      mutate(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Navigate, { onExcessProperty: 'error' })),
          );
          yield* controller.actions.navigate(body);
          return json(yield* controller.snapshot);
        }),
      ),
    );
    return router
      .asHttpEffect()
      .pipe(Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(65536)));
  });
/** Vite serves the frontend on demand; Effect platform owns each API request. */
export const studio = (options: {
  port: number;
  profile: string;
  mock: boolean;
  renderer?: RendererKind;
  persistence?: NonNullable<Parameters<typeof startStudio>[0]['persistence']>;
  configurePlugins?: NonNullable<Parameters<typeof startStudio>[0]['configurePlugins']>;
}) =>
  Effect.gen(function* () {
    const controller = yield* startStudio({
      ...options,
      origin: `http://127.0.0.1:${options.port}`,
    });
    const scope = yield* Effect.scope;
    const app = yield* httpApp(controller, [
      `http://127.0.0.1:${options.port}`,
      `http://localhost:${options.port}`,
    ]);
    const handler = yield* NodeHttpServer.makeHandler(app, { scope });
    const path = yield* Path.Path;
    const root = yield* path.fromFileUrl(new URL('../../web', import.meta.url));
    const vite = yield* Effect.tryPromise(() => import('vite'));
    const server = yield* Effect.acquireRelease(
      Effect.tryPromise(() =>
        vite.createServer({
          configFile: false,
          root,
          server: { host: '127.0.0.1', port: options.port, strictPort: true },
          plugins: [
            {
              name: 'effect-studio-api',
              handleHotUpdate(context) {
                // Node watch restarts shared backend modules; Vite reconnects after readiness.
                if (
                  [
                    'studio-contract.ts',
                    'discord-contract.ts',
                    'key-feedback.ts',
                    'ui/key-card.ts',
                  ].some((file) => context.file === path.resolve(root, `../src/${file}`))
                )
                  return [];
              },
              configureServer(currentServer) {
                currentServer.middlewares.use((request, response, next) =>
                  request.url?.startsWith('/api/') ? handler(request, response) : next(),
                );
              },
            },
          ],
        }),
      ),
      (candidateServer) =>
        Effect.promise(() => {
          if (candidateServer.httpServer && 'closeAllConnections' in candidateServer.httpServer)
            candidateServer.httpServer.closeAllConnections();
          return candidateServer.close();
        }),
    );
    yield* Effect.tryPromise(() => server.listen());
    yield* Console.log(
      JSON.stringify({
        kind: 'studio-ready',
        url: `http://127.0.0.1:${options.port}`,
        profile: options.profile,
        mock: options.mock,
      }),
    );
    yield* controller.run;
  });
