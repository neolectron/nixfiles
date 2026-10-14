import { Effect, Schema } from 'effect';
import type { Controller } from '@nixfiles/system-control/text-selection.ts';
import * as Plugin from '../plugin.ts';

export const input = Schema.Struct({
  prompt: Schema.NonEmptyString.check(Schema.isMaxLength(8000)).annotate({
    title: 'Prompt',
    contentMediaType: 'text/plain',
    description:
      'Instruction appliquée au texte sélectionné. Le résultat remplace la sélection dans son champ éditable.',
  }),
});
export interface SelectionActions {
  readonly selection: Controller;
}
const action = (id: string, name: string, label: string, prompt: string) =>
  Plugin.action({
    id,
    name,
    description:
      'Transforme la sélection de la fenêtre active avec Codex, puis la remplace sans envoyer le message.',
    input,
    defaults: { prompt },
    tile: { label, icon: 'openai' },
    run: (api: SelectionActions, value, invocation) =>
      api.selection.transform(value.prompt, invocation.output),
    feedback: () =>
      Effect.succeed({ icon: 'openai' as const, text: 'SÉLECTION', tone: 'neutral' as const }),
  });
export const actions = [
  action(
    'translate-selection',
    'Traduire la sélection en anglais',
    'Traduire · EN',
    'Translate this text into natural English. Preserve the meaning, tone, formatting and line breaks. Return only the translation.',
  ),
  action(
    'correct-selection',
    'Corriger la sélection',
    'Corriger',
    'Correct spelling, grammar and punctuation in this text. Keep its original language, meaning, tone, formatting and line breaks. Return only the corrected text.',
  ),
  action(
    'transform-selection',
    'Transformer la sélection',
    'Transformer',
    'Rewrite this text to make it clearer and more concise. Keep its original language and meaning. Return only the rewritten text.',
  ),
];
