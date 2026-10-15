import { Data, Schema, Stream } from 'effect';
import { Snapshot } from './studio-contract.ts';
import { webSnapshot } from './studio-presentation.ts';

export const Event = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('snapshot'), snapshot: Snapshot }),
  Schema.Struct({
    kind: Schema.Literal('patch'),
    sessionId: Schema.String,
    baseRevision: Schema.Int,
    stateRevision: Schema.Int,
    changes: Schema.Record(Schema.String, Schema.Json),
    removed: Schema.Array(Schema.String),
  }),
]);
export type Event = typeof Event.Type;
export class ResyncRequired extends Data.TaggedError('ResyncRequired')<{}> {}

/** Every connection begins with a complete view; subsequent events contain changed domains only. */
export const events = <E, R>(source: Stream.Stream<Snapshot, E, R>) =>
  Stream.suspend(() => {
    let previous: Snapshot | undefined;
    return source.pipe(
      Stream.map((raw): Event => {
        const next = webSnapshot(raw);
        const before = previous;
        previous = next;
        if (
          !before ||
          before.sessionId !== next.sessionId ||
          before.stateRevision === undefined ||
          next.stateRevision === undefined
        )
          return { kind: 'snapshot', snapshot: next };
        const changes: Record<string, Schema.Json> = {};
        const removed: string[] = [];
        for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
          const field = key as keyof Snapshot;
          if (JSON.stringify(before[field]) === JSON.stringify(next[field])) continue;
          if (next[field] === undefined) removed.push(key);
          else changes[key] = JSON.parse(JSON.stringify(next[field])) as Schema.Json;
        }
        return {
          kind: 'patch',
          sessionId: next.sessionId,
          baseRevision: before.stateRevision,
          stateRevision: next.stateRevision,
          changes,
          removed,
        };
      }),
    );
  });

/** A missing event triggers a reconnect/full resync instead of partially applying stale state. */
export const apply = (previous: Snapshot | undefined, event: Event): Snapshot => {
  if (event.kind === 'snapshot') return event.snapshot;
  if (
    !previous ||
    previous.sessionId !== event.sessionId ||
    previous.stateRevision !== event.baseRevision
  )
    throw new ResyncRequired();
  const merged = { ...previous, ...event.changes };
  for (const key of event.removed) delete merged[key as keyof Snapshot];
  const next = Schema.decodeUnknownSync(Snapshot)(merged);
  if (next.sessionId !== event.sessionId || next.stateRevision !== event.stateRevision)
    throw new ResyncRequired();
  return next;
};
