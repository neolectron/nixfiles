import { useEffect, useState } from 'react';
import { Effect, Fiber, Schedule } from 'effect';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';

export function Diagnostics({
  active,
  snapshot,
}: {
  active: boolean;
  snapshot?: Snapshot | undefined;
}) {
  const [entries, setEntries] = useState<Effect.Success<typeof Api.diagnostics>>([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [integrations, setIntegrations] = useState<Effect.Success<typeof Api.integrations>>([]);
  const [changing, setChanging] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const fiber = Effect.runFork(
      Effect.repeat(
        Effect.all({ diagnostics: Api.diagnostics, integrations: Api.integrations }).pipe(
          Effect.match({
            onSuccess: (value) => {
              setEntries(value.diagnostics);
              setIntegrations(value.integrations);
              setError('');
            },
            onFailure: () => setError('Diagnostic indisponible.'),
          }),
        ),
        Schedule.spaced(1000),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [active]);
  return (
    <section className="inspector" aria-label="Diagnostic du runtime">
      <h2>Diagnostic</h2>
      <details>
        <summary>Intégrations système</summary>
        {integrations.map((integration) => (
          <label className="integration-toggle" key={integration.id}>
            <span>{integration.id}</span>
            <input
              type="checkbox"
              aria-label={`Activer l’intégration ${integration.id}`}
              checked={integration.enabled}
              disabled={changing !== null}
              onChange={(event) => {
                setChanging(integration.id);
                void Api.run(Api.setIntegration(integration.id, event.currentTarget.checked))
                  .then(setIntegrations)
                  .catch(() => setError('Configuration impossible.'))
                  .finally(() => setChanging(null));
              }}
            />
          </label>
        ))}
      </details>
      <dl className="diagnostic-summary">
        <dt>Connexion</dt>
        <dd>{snapshot?.connected ? 'Connecté' : 'Hors ligne'}</dd>
        <dt>Révision</dt>
        <dd>{snapshot?.stateRevision ?? '—'}</dd>
        <dt>Layout</dt>
        <dd>{snapshot?.configuration.revision ?? '—'}</dd>
        <dt>MCP</dt>
        <dd>/mcp</dd>
      </dl>
      <label className="field">
        <span>Filtrer les actions</span>
        <input value={filter} onChange={(event) => setFilter(event.currentTarget.value)} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <ol className="diagnostic-events">
        {entries
          .filter((entry) => entry.action.toLowerCase().includes(filter.toLowerCase()))
          .toReversed()
          .map((entry) => (
            <li key={entry.sequence}>
              <strong>{entry.action}</strong>
              <span>
                {entry.outcome === 'success'
                  ? 'Réussi'
                  : entry.outcome === 'cancelled'
                    ? 'Annulé'
                    : 'Échec'}{' '}
                · {Math.round(entry.durationMs)} ms
              </span>
            </li>
          ))}
      </ol>
      {!entries.length ? <p className="muted">Aucune action système exécutée.</p> : null}
    </section>
  );
}
