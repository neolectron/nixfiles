import { Context, Effect, Equal, Fiber, Layer, Semaphore, Stream } from 'effect';
import { StreamDeck, type Device } from './stream-deck.ts';
import * as Image from './image.ts';
import type { RgbImage } from './image.ts';
import type { DeckEvent, Position } from './model.ts';
import type { Region, View } from './presentation.tsx';
import * as Layout from './lcd-layout.ts';
import { LcdSpace, expansionWidth } from './lcd-space.ts';
import { invalid, invariant } from './errors.ts';
import type { Controller as Host } from './plugin-host.ts';
import * as Takumi from './takumi.ts';
import { ActionCard, presentation as actionPresentation } from './ui/action-presentation.tsx';

type Provider = Pick<Host, 'invoke' | 'feedback' | 'lcdFrame' | 'catalogue'>;
type Part = { x: number; y: number; image: RgbImage; view: Region };
/** Copy a clipped source region into logical RGB pixels. No HID orientation enters layout code. */
export const blit = (target: RgbImage, source: RgbImage, x: number, y: number) => {
  const left = Math.max(0, x),
    right = Math.min(target.width, x + source.width);
  if (right <= left) return;
  for (let row = Math.max(0, y); row < Math.min(target.height, y + source.height); row++)
    target.data.set(
      source.data.subarray(
        ((row - y) * source.width + left - x) * 3,
        ((row - y) * source.width + right - x) * 3,
      ),
      (row * target.width + left) * 3,
    );
};
const failure = (cause: unknown) =>
  invalid('lcd-surface', cause instanceof Error ? cause.message : String(cause));

/** Composes configured LCD regions over the existing producer, serializing both writers.
 * The mixer keeps its knob ownership. Covered touch areas belong exclusively to this surface.
 */
export const make = (original: Device, renderer: Effect.Success<typeof Takumi.make>) =>
  Effect.gen(function* () {
    const owner = yield* Effect.scope;
    const lock = yield* Semaphore.make(1);
    const base = new Map<number, RgbImage>();
    const parts = new Map<number, ReadonlyArray<Part>>();
    let config: Layout.Configuration = Layout.empty;
    let navigation: Layout.Navigation = {};
    let focus: string | null = null;
    let revision = 0;
    let displayedNavigation: Layout.Navigation = {};
    let displayedFocus: string | null = null;
    let routedViews: ReturnType<typeof Layout.project> = [];
    let provider: Provider | undefined;
    let stamp = '';
    let closed = false;
    const jobs = new Map<string, Fiber.Fiber<unknown, never>>();
    const errors = new Map<string, string>();
    const sizeFor = (index: number) => original.lcds.find((lcd) => lcd.index === index)?.pixelSize;
    const geometry = () =>
      original.lcds.flatMap((lcd) =>
        lcd.pixelSize ? [{ index: lcd.index, width: lcd.pixelSize.width }] : [],
      );
    const composed = (index: number) => {
      const size = invariant(sizeFor(index), 'lcd-surface');
      const image = {
        ...size,
        data: base.get(index)?.data.slice() ?? new Uint8Array(size.width * size.height * 3),
      };
      for (const part of parts.get(index) ?? []) blit(image, part.image, part.x, part.y);
      return image;
    };
    const write = (index: number, position: Position, image: RgbImage) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          const size = sizeFor(index);
          if (
            closed ||
            !size ||
            !Image.validate(image) ||
            !Number.isSafeInteger(position.x) ||
            !Number.isSafeInteger(position.y) ||
            position.x < 0 ||
            position.y < 0 ||
            position.x + image.width > size.width ||
            position.y + image.height > size.height
          )
            return yield* invalid('lcd-surface', 'Invalid or closed LCD region.');
          const current = base.get(index) ?? {
            ...size,
            data: new Uint8Array(size.width * size.height * 3),
          };
          blit(current, image, position.x, position.y);
          base.set(index, current);
          if (parts.get(index)?.length) yield* original.lcd(index).setImage(composed(index));
          else yield* original.lcd(index).drawRegion(position, image);
        }),
      );
    const views = () =>
      original.lcds.flatMap((lcd) => Layout.project(config, navigation, lcd.index, focus));
    const zoneAt = (lcd: number, x: number, y: number) =>
      sizeFor(lcd) && y >= 0 && y < invariant(sizeFor(lcd), 'lcd-surface').height
        ? routedViews.find(
            (view) =>
              view.zone.lcd === lcd && x >= view.zone.x && x < view.zone.x + view.zone.width,
          )
        : undefined;
    const claimed = (event: DeckEvent) =>
      '_tag' in event &&
      (event._tag === 'TouchTap' || event._tag === 'TouchHold' || event._tag === 'TouchSwipe') &&
      !!zoneAt(
        event.lcd,
        event._tag === 'TouchSwipe' ? event.from.x : event.position.x,
        event._tag === 'TouchSwipe' ? event.from.y : event.position.y,
      );
    const subscribe = Effect.map(original.subscribe, (events) =>
      events.pipe(Stream.filter((event) => !claimed(event))),
    );
    const device: Device = {
      ...original,
      subscribe,
      events: Stream.unwrap(subscribe),
      lcd: (index) => {
        const size = () => invariant(sizeFor(index), 'lcd-surface');
        const setImage = (image: RgbImage) => write(index, { x: 0, y: 0 }, image);
        const fill = (color: import('./model.ts').Color) =>
          Effect.flatMap(Image.solid(size(), color), setImage);
        return {
          setImage,
          drawRegion: (position, image) => write(index, position, image),
          fill,
          clear: fill([0, 0, 0]),
          label: (text, options) => Effect.flatMap(Image.label(size(), text, options), setImage),
        };
      },
    };
    const navigate = (command: Layout.Command) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.try({
          try: () => {
            if (closed) throw new Error('La surface LCD est fermée.');
            navigation = Layout.navigate(config, navigation, command, focus);
          },
          catch: failure,
        }),
      );
    const activate = (tile: Layout.Tile, zone: string, hold: boolean) =>
      Effect.gen(function* () {
        if (!provider || closed || jobs.has(tile.id)) return;
        const current = provider;
        const job = current
          .invoke(tile.plugin, tile.action, tile.input, {
            output: () => Effect.void,
            surface: { kind: 'lcd', zone },
            gesture: hold ? 'long-press' : 'short-press',
          })
          .pipe(
            Effect.catch((cause) => Effect.sync(() => errors.set(tile.id, cause.message))),
            Effect.ensuring(Effect.sync(() => jobs.delete(tile.id))),
          );
        errors.delete(tile.id);
        const fiber = yield* Effect.forkIn(job, owner, { startImmediately: false });
        jobs.set(tile.id, fiber);
      });
    const input = (
      lcd: number,
      kind: 'tap' | 'hold' | 'swipe',
      x: number,
      y: number,
      toX?: number,
    ) =>
      Effect.gen(function* () {
        const view = zoneAt(lcd, x, y);
        if (!view) return;
        if (kind === 'swipe')
          return yield* navigate({
            zone: view.zone.id,
            operation: 'scroll',
            delta: Math.round(x - (toX ?? x)),
          });
        const hit = view.tiles.find(
          (entry) =>
            entry.width > 0 &&
            x - view.zone.x >= Math.max(0, entry.x) &&
            x - view.zone.x < Math.min(view.zone.width, entry.x + entry.tile.width),
        );
        if (hit) yield* activate(hit.tile, view.zone.id, kind === 'hold');
      });
    const nativeEvents = yield* original.subscribe;
    yield* Effect.forkIn(
      Stream.runForEach(nativeEvents, (event) => {
        const task =
          event._tag === 'TouchTap' || event._tag === 'TouchHold'
            ? input(
                event.lcd,
                event._tag === 'TouchTap' ? 'tap' : 'hold',
                event.position.x,
                event.position.y,
              )
            : event._tag === 'TouchSwipe' &&
                Math.abs(event.to.x - event.from.x) > Math.abs(event.to.y - event.from.y)
              ? input(event.lcd, 'swipe', event.from.x, event.from.y, event.to.x)
              : Effect.void;
        return task.pipe(Effect.catch((cause) => Effect.logWarning('LCD input', cause)));
      }).pipe(Effect.catch((cause) => Effect.logWarning('LCD source', cause))),
      owner,
    );
    const refresh = (next: Layout.Configuration, host: Provider, focused: string | null) =>
      Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.gen(function* () {
          if (closed) return;
          provider = host;
          if (!Equal.equals(config, next)) {
            yield* Effect.try({ try: () => Layout.validate(next, geometry()), catch: failure });
            const previous = new Map(
              [...config.zones, ...config.folders].flatMap((entry) =>
                entry.pages.flat().map((tile) => [tile.id, tile] as const),
              ),
            );
            config = next;
            navigation = {};
            const keep = new Map(
              [...next.zones, ...next.folders].flatMap((entry) =>
                entry.pages.flatMap((page) => page.map((tile) => [tile.id, tile] as const)),
              ),
            );
            for (const [id, job] of jobs)
              if (!Equal.equals(keep.get(id), previous.get(id))) yield* Fiber.interrupt(job);
          }
          if (focus !== focused) {
            focus = focused;
          }
          const nextParts = new Map<number, Part[]>();
          const nextViews = views();
          for (const view of nextViews) {
            const size = invariant(sizeFor(view.zone.lcd), 'lcd-surface');
            const current: Part[] = nextParts.get(view.zone.lcd) ?? [];
            nextParts.set(view.zone.lcd, current);
            const blank = yield* Image.solid(
              { width: view.zone.width, height: size.height },
              [16, 18, 23],
            );
            current.push({
              x: view.zone.x,
              y: 0,
              image: blank,
              view: {
                x: view.zone.x,
                y: 0,
                width: view.zone.width,
                height: size.height,
                view: { type: 'lcd.blank.v1', data: {} },
              },
            });
            for (const entry of view.tiles.filter((candidate) => candidate.width > 0)) {
              const tile = entry.tile;
              const tileSize = { width: tile.width, height: size.height };
              const custom = yield* host
                .lcdFrame(tile.plugin, tile.action, tile.input, tileSize)
                .pipe(Effect.orElseSucceed(() => undefined));
              const feedback = yield* host.feedback(tile.plugin, tile.action, tile.input);
              const value = {
                ...tileSize,
                label: tile.label,
                count: 0,
                feedback: errors.has(tile.id)
                  ? { icon: 'plugin' as const, tone: 'danger' as const, text: 'ERREUR' }
                  : feedback,
              };
              const frame = custom ?? {
                view: yield* actionPresentation.describe(value),
                image: yield* renderer.rgb(<ActionCard value={value} />, tileSize),
              };
              if (
                !Image.validate(frame.image) ||
                frame.image.width !== tile.width ||
                frame.image.height !== size.height
              )
                continue;
              const clipped = {
                width: entry.width,
                height: size.height,
                data: new Uint8Array(entry.width * size.height * 3),
              };
              blit(clipped, frame.image, -entry.left, 0);
              const x = view.zone.x + Math.max(0, entry.x);
              const description: View = {
                type: 'lcd.clip.v1',
                data: {
                  view: frame.view,
                  left: entry.left,
                  width: tile.width,
                  height: size.height,
                },
              };
              current.push({
                x,
                y: 0,
                image: clipped,
                view: { x, y: 0, width: entry.width, height: size.height, view: description },
              });
            }
          }
          const currentStamp = JSON.stringify([
            config,
            navigation,
            focus,
            [...nextParts].map(([lcd, entries]) => [lcd, entries.map((entry) => entry.view)]),
          ]);
          if (stamp === currentStamp) return;
          const changed = new Set([...parts.keys(), ...nextParts.keys()]);
          parts.clear();
          for (const [index, current] of nextParts) parts.set(index, current);
          for (const index of changed) yield* original.lcd(index).setImage(composed(index));
          routedViews = nextViews;
          displayedNavigation = navigation;
          displayedFocus = focus;
          revision++;
          stamp = currentStamp;
        }),
      ).pipe(Effect.mapError(failure));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        parts.clear();
        base.clear();
      }),
    );
    return {
      device,
      space: LcdSpace.of({
        expand: (lcd, anchor, requested) =>
          Effect.sync(() =>
            expansionWidth(
              anchor,
              requested,
              closed
                ? [anchor]
                : routedViews
                    .filter((view) => view.zone.lcd === lcd)
                    .map((view) => ({
                      x: view.zone.x,
                      y: 0,
                      width: view.zone.width,
                      height: invariant(sizeFor(lcd), 'lcd-surface').height,
                    })),
            ),
          ),
      }),
      refresh,
      navigate,
      input,
      configuration: Effect.sync(() => config),
      snapshot: Effect.sync(() => ({
        revision,
        focus: displayedFocus,
        navigation: displayedNavigation,
      })),
      scene: (index: number, background: ReadonlyArray<Region> | undefined) =>
        Effect.sync(() =>
          background
            ? [...background, ...(parts.get(index) ?? []).map((part) => part.view)]
            : parts.get(index)?.length
              ? (parts.get(index) ?? []).map((part) => part.view)
              : background,
        ),
      covered: (lcd: number, x: number, y: number) => !!zoneAt(lcd, x, y),
      validate: (next: Layout.Configuration, host: Provider & Pick<Host, 'validateAction'>) =>
        Effect.gen(function* () {
          yield* Effect.try({ try: () => Layout.validate(next, geometry()), catch: failure });
          const catalogue = yield* host.catalogue;
          for (const tile of [...next.zones, ...next.folders].flatMap((container) =>
            container.pages.flat(),
          )) {
            const action = catalogue.find(
              (entry) => entry.plugin === tile.plugin && entry.id === tile.action,
            );
            if (
              !action ||
              action.interaction === 'hold' ||
              (action.tile?.surfaces && !action.tile.surfaces.includes('lcd'))
            )
              return yield* failure('Cette action ne prend pas en charge le tactile LCD.');
            yield* host.validateAction(tile.plugin, tile.action, tile.input, 'lcd');
          }
        }),
    };
  });
export type Controller = Effect.Success<ReturnType<typeof make>>;
export class LcdSurface extends Context.Service<LcdSurface, Controller>()(
  '@nixfiles/streamdeck/LcdSurface',
) {
  static readonly layer = Layer.effect(
    LcdSurface,
    Effect.gen(function* () {
      return yield* make(yield* StreamDeck, yield* Takumi.current);
    }),
  );
}
