import type { Snapshot } from '../src/studio-contract.ts';
import { ElgatoMark } from './elgato-mark.tsx';
import { deviceName } from './device-skin.ts';
export type DeviceIdentity = Pick<Snapshot, 'model' | 'mock' | 'connected' | 'connectionError'>;
export function DeckHeading({
  snapshot,
  online,
}: {
  readonly snapshot: DeviceIdentity | undefined;
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
  const tone =
    online && snapshot?.connected && !snapshot.mock
      ? 'online'
      : snapshot?.connectionError
        ? 'error'
        : 'warning';
  return (
    <header className="device-heading" title={deviceName(snapshot?.model)}>
      <div className="device-brand">
        <span className={`device-logo ${tone}`} aria-hidden={true}>
          <ElgatoMark />
        </span>
        <div className="device-brand-text">
          <h1 aria-label={deviceName(snapshot?.model)}>STREAM DECK</h1>
          <span
            className="connection-label"
            role="status"
            aria-label={status}
            title={snapshot?.connectionError ?? status}
          >
            {status}
          </span>
        </div>
      </div>
    </header>
  );
}
