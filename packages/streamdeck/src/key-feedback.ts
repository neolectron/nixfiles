import { Schema } from 'effect';

/** Serializable feedback shared by hardware rendering, the preview and plugin scripts. */
export const KeyFeedback = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(40)),
  tone: Schema.Literals(['neutral', 'positive', 'danger']),
  icon: Schema.Literals(['plugin', 'microphone', 'headphones', 'play', 'pause', 'stop', 'next', 'previous', 'shuffle', 'repeat', 'music']),
});
export type KeyFeedback = typeof KeyFeedback.Type;
