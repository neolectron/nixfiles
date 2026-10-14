import type { Snapshot } from '../src/studio-contract.ts';

export function DeckHeading({
  snapshot,
  online,
}: {
  readonly snapshot: Snapshot | undefined;
  readonly online: boolean;
}) {
  const status = online
    ? snapshot?.mock
      ? 'Deck simulé'
      : snapshot?.connected
        ? 'Connecté'
        : 'Déconnecté'
    : snapshot
      ? 'Reconnexion…'
      : 'Connexion…';
  return (
    <div className="preview-heading">
      <div className="deck-title">
        <span
          className="connection"
          role="status"
          aria-label={status}
          title={snapshot?.connectionError ?? status}
        >
          <span
            className={online && snapshot?.connected ? 'status-dot online' : 'status-dot'}
            aria-hidden="true"
          />
          <span className="connection-label">{status}</span>
        </span>
        <h1>{snapshot?.model.replace(/^Mock /, '') ?? 'Stream Deck'}</h1>
      </div>
      <span className="profile-name">Profil principal</span>
    </div>
  );
}
