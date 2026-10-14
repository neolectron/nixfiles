import type { Snapshot } from '../src/studio-contract.ts';
import { registry } from '../src/presentation.tsx';
import { presentation as volume } from '../src/ui/volume-presentation.tsx';
import { presentation as spotify } from '../src/plugins/spotify-presentation.tsx';

/** Explicit client entry points keep system services out of the browser bundle. */
const renderView = registry([volume, spotify]);
export function LcdView({ lcd, sessionId }: { lcd: Snapshot['lcds'][number]; sessionId: string }) {
  if (!lcd.scene)
    return lcd.revision ? (
      <img
        src={`/api/image/lcd/${lcd.index}?session=${sessionId}&revision=${lcd.revision}`}
        alt="Aperçu du plugin à rendu pixel"
        draggable={false}
      />
    ) : null;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${lcd.width} ${lcd.height}`}
      className="lcd-react-view"
    >
      <foreignObject width={lcd.width} height={lcd.height}>
        <div style={{ width: lcd.width, height: lcd.height, position: 'relative' }}>
          {lcd.scene.map((region) => (
            <div
              key={`${region.x}/${region.y}`}
              style={{
                position: 'absolute',
                left: region.x,
                top: region.y,
                width: region.width,
                height: region.height,
              }}
            >
              {renderView(region.view)}
            </div>
          ))}
        </div>
      </foreignObject>
    </svg>
  );
}
