import { Schema } from 'effect';

export const Activity = Schema.Struct({
  target: Schema.NullOr(Schema.String),
  phase: Schema.Literals(['idle', 'recording', 'transcribing']),
});
export type Activity = typeof Activity.Type;
