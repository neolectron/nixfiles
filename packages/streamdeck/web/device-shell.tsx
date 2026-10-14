import type { CSSProperties, ReactNode } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import { DeckHeading, type DeviceIdentity } from './deck-heading.tsx';
import { deviceName, deviceSkin } from './device-skin.ts';
/** The physical chrome owns appearance only; input, drafts and rendering remain in their adapters. */
export function DeviceShell({
  snapshot,
  online,
  columns,
  children,
}: {
  readonly snapshot: (DeviceIdentity & Pick<Snapshot, 'dials' | 'lcds'>) | undefined;
  readonly online: boolean;
  readonly columns: number;
  readonly children: ReactNode;
}) {
  const skin = deviceSkin(snapshot?.model);
  return (
    <div className="device-stage">
      <div
        className={`device device-${skin}${snapshot && !snapshot.dials.length ? ' device-no-dials' : ''}`}
        data-deck-skin={skin}
        style={{ '--columns': columns } as CSSProperties}
        role="group"
        aria-label={`Boîtier ${deviceName(snapshot?.model)}`}
      >
        <DeckHeading snapshot={snapshot} online={online} />
        <div className="device-front">{children}</div>
      </div>
    </div>
  );
}
