import { Effect } from 'effect';
import { Request, type Controller } from '@nixfiles/system-control/codex-prompt.ts';
import * as Plugin from '../plugin.ts';

export interface PromptActions {
  readonly prompts: Controller;
}
export const action = Plugin.action({
  id: 'run-prompt',
  name: 'Exécuter un prompt Codex',
  description: 'Lance le prompt configuré en arrière-plan. La réponse apparaît dans l’inspecteur.',
  input: Request,
  defaults: {
    prompt: 'Réponds en une phrase : donne-moi une idée utile pour ma journée.',
    directory: '',
    access: 'read-only',
  },
  tile: { label: 'Prompt Codex', icon: 'openai' },
  run: (api: PromptActions, input, invocation) =>
    invocation.output('Codex en cours…\n').pipe(Effect.andThen(api.prompts.run(input))),
  feedback: (api: PromptActions) =>
    api.prompts.busy.pipe(
      Effect.map((busy) => ({
        icon: 'openai' as const,
        text: busy ? 'EN COURS' : 'PROMPT',
        tone: busy ? ('positive' as const) : ('neutral' as const),
      })),
    ),
});
