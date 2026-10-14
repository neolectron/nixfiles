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
          className={online && snapshot?.connected ? 'status-dot online' : 'status-dot'}
          aria-hidden="true"
        />
        <div className="deck-title-text">
          <h1>{snapshot?.model.replace(/^Mock /, '') ?? 'Stream Deck'}</h1>
          <span
            className="connection connection-label"
            role="status"
            aria-label={status}
            title={snapshot?.connectionError ?? status}
          >
            {status}
          </span>
        </div>
      </div>
      <span className="profile-name">Profil principal</span>
    </div>
  );
}
