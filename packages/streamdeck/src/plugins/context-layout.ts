import { Effect, Result, Stream } from 'effect';
import { Desktop, type Window } from '@nixfiles/system-control/desktop.ts';
import type { KeyOverlay } from '../deck-overlays.ts';
import * as Plugin from '../plugin.ts';

export interface Rule {
  /** Exact compositor app IDs, case insensitive; no shell commands or guessed title matching. */
  readonly applications: ReadonlyArray<string>;
  readonly overlay: KeyOverlay;
}
/** Pure selection, reusable with focus, game state, HTTP, MCP or another event source. */
export const select = (rules: ReadonlyArray<Rule>, window: Window | null): KeyOverlay | null =>
  rules.find(
    (rule) =>
      window?.app_id &&
      rule.applications.some((id) => id.toLowerCase() === window.app_id?.toLowerCase()),
  )?.overlay ?? null;

/** Install a configured contextual plugin. Its activation scope owns its presentation.
 * A desktop read error restores the base layout; the source keeps listening for recovery.
 * Rules are explicit: merely installing Discord does not change the user's layout.
 */
export const plugin = (rules: ReadonlyArray<Rule>, id = 'context-layout') =>
  Plugin.define({
    id,
    name: 'Layout contextuel',
    description: 'Présente des touches temporaires selon l’application au premier plan.',
    controls: {},
    setup: Effect.gen(function* () {
      const desktop = yield* Desktop;
      const run = yield* Plugin.presentFrom('foreground', desktop.focusChanges, (state) =>
        Effect.succeed(Result.isSuccess(state) ? select(rules, state.success) : null),
      );
      return { api: {}, run };
    }),
  });

/** Any Stream can drive an overlay; no dependency on Desktop or Studio is required. */
export const fromSource = <A, E, R>(options: {
  readonly id: string;
  readonly name: string;
  readonly source: Stream.Stream<A, E, R>;
  readonly select: (event: A) => KeyOverlay | null;
}) =>
  Plugin.define({
    id: options.id,
    name: options.name,
    description: 'Layout temporaire piloté par une source d’événements.',
    controls: {},
    setup: Effect.gen(function* () {
      const run = yield* Plugin.presentFrom('context', options.source, (event) =>
        Effect.succeed(options.select(event)),
      );
      return { api: {}, run };
    }),
  });
