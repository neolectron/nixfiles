import { Schema } from 'effect';

/** Serializable feedback shared by hardware rendering, the preview and plugin scripts. */
export const KeyFeedback = Schema.Struct({
  label: Schema.optional(Schema.String.check(Schema.isMaxLength(80))),
  text: Schema.String.check(Schema.isMaxLength(40)),
  tone: Schema.Literals(['neutral', 'positive', 'danger']),
  icon: Schema.Literals([
    'plugin',
    'sun',
    'moon',
    'theme',
    'phone',
    'phone-end',
    'microphone',
    'headphones',
    'play',
    'pause',
    'stop',
    'next',
    'previous',
    'shuffle',
    'repeat',
    'music',
    'discord',
    'spotify',
    'openai',
    'obs',
  ]),
});
export type KeyFeedback = typeof KeyFeedback.Type;
