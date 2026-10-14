import { Schema } from 'effect';

export const defaults = { longPressMs: 600, doubleTapMs: 350 } as const;
export const LongPressMs = Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 10000 }));
export const DoubleTapMs = Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 1000 }));
export const PressTiming = Schema.Struct({
  longPressMs: Schema.optional(LongPressMs),
  doubleTapMs: Schema.optional(DoubleTapMs),
});
/** One activation gesture per button; omission preserves immediate KeyDown behavior. */
export const KeyTrigger = Schema.Union([
  Schema.Struct({ type: Schema.Literal('press') }),
  Schema.Struct({ type: Schema.Literal('long-press'), milliseconds: Schema.optional(LongPressMs) }),
  Schema.Struct({ type: Schema.Literal('double-tap'), milliseconds: Schema.optional(DoubleTapMs) }),
]);
export type KeyTrigger = typeof KeyTrigger.Type;
export const delay = (trigger: KeyTrigger) =>
  trigger.type === 'press'
    ? 0
    : (trigger.milliseconds ??
      (trigger.type === 'long-press' ? defaults.longPressMs : defaults.doubleTapMs));
