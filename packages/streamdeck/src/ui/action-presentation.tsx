import { Schema } from 'effect';
import * as Presentation from '../presentation.tsx';
import { KeyFeedback } from '../key-feedback.ts';
import { KeyCard } from './key-card.tsx';
export const Data = Schema.Struct({
  width: Presentation.Dimension,
  height: Presentation.Dimension,
  label: Schema.String,
  count: Schema.Int,
  feedback: Schema.NullOr(KeyFeedback),
});
export function ActionCard({ value }: { value: typeof Data.Type }) {
  return <KeyCard {...value} action="plugin" status="idle" />;
}
export const presentation = Presentation.define('lcd.action.v1', Data, ActionCard);
