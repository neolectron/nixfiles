import { Schema } from 'effect';

/** Serializable feedback shared by hardware rendering, the preview and plugin scripts. */
export const KeyFeedback = Schema.Struct({
  label: Schema.optional(Schema.String.check(Schema.isMaxLength(80))),
  text: Schema.String.check(Schema.isMaxLength(40)),
  tone: Schema.Literals(['neutral', 'positive', 'danger']),
  icon: Schema.NonEmptyString.check(Schema.isPattern(/^[a-z0-9][a-z0-9._/-]{0,127}$/)),
});
export type KeyFeedback = typeof KeyFeedback.Type;
