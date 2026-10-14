import { Effect } from 'effect';
import type { Controller } from '@nixfiles/system-control/dot-call.ts';
import * as Plugin from '../plugin.ts';
import type { KeyFeedback } from '../key-feedback.ts';

export interface CallActions {
  readonly dot: Controller;
}
export const duration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)}:` : ''}${String(minutes % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const text = (view: Effect.Success<Controller['view']>) =>
  view.phase === 'active'
    ? duration(view.elapsedSeconds)
    : view.phase === 'connecting'
      ? 'CONNEXION'
      : view.phase === 'ending'
        ? 'FIN D’APPEL'
        : 'INACTIF';
const action = (id: 'dot-call' | 'dot-hangup' | 'dot-call-status', name: string, label: string) =>
  Plugin.action({
    id,
    name,
    description:
      id === 'dot-call-status'
        ? 'Affiche l’état réel et la durée de l’appel, sans le modifier.'
        : 'Contrôle l’appel du dot via le service système connecté.',
    input: Plugin.NoInput,
    defaults: {},
    tile: { label, icon: id === 'dot-hangup' ? 'phone-end' : 'phone' },
    run: (api: CallActions) =>
      Effect.gen(function* () {
        if (id !== 'dot-call-status') yield* id === 'dot-call' ? api.dot.toggle : api.dot.hangup;
        else yield* api.dot.refresh;
        return text(yield* api.dot.view);
      }),
    feedback: (api: CallActions) =>
      Effect.map(
        api.dot.view,
        (view): KeyFeedback => ({
          icon:
            id === 'dot-hangup' || (id === 'dot-call' && view.phase !== 'idle')
              ? 'phone-end'
              : 'phone',
          label:
            id === 'dot-call'
              ? view.phase === 'idle'
                ? 'Appeler le dot'
                : view.phase === 'ending'
                  ? 'Raccrochage…'
                  : 'Raccrocher le dot'
              : label,
          text: id === 'dot-call' && view.phase === 'idle' ? 'APPELER' : text(view),
          tone:
            view.phase === 'active' || view.phase === 'connecting'
              ? id === 'dot-call-status'
                ? 'positive'
                : 'danger'
              : 'neutral',
        }),
      ),
    unavailable: {
      icon: id === 'dot-hangup' ? 'phone-end' : 'phone',
      text: 'À CONNECTER',
      tone: 'neutral',
    },
  });
export const actions = [
  action('dot-call', 'Appeler / raccrocher le dot', 'Appeler le dot'),
  action('dot-hangup', 'Raccrocher le dot', 'Raccrocher'),
  action('dot-call-status', 'État de l’appel du dot', 'Appel du dot'),
];
