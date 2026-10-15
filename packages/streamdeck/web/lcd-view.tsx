import type { Snapshot } from '../src/studio-contract.ts';
import { View } from '../src/presentation.tsx';
import { render as renderView } from '../src/plugin-clients.ts';
import { Schema } from 'effect';
import type { ReactNode } from 'react';

/** Explicit client entry points keep system services out of the browser bundle. */
const Clip = Schema.Struct({
  view: View,
  left: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export const renderLcdView = (view: View): ReactNode => {
  if (view.type === 'lcd.blank.v1')
    return <div style={{ width: '100%', height: '100%', background: '#101217' }} />;
  if (view.type !== 'lcd.clip.v1') return renderView(view);
  try {
    const data = Schema.decodeUnknownSync(Clip)(view.data);
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <div style={{ width: data.width, height: data.height, marginLeft: -data.left }}>
          {renderView(data.view)}
        </div>
      </div>
    );
  } catch {
    return null;
  }
};
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
              key={`${region.x}/${region.y}/${region.view.type}`}
              style={{
                position: 'absolute',
                left: region.x,
                top: region.y,
                width: region.width,
                height: region.height,
              }}
            >
              {renderLcdView(region.view)}
            </div>
          ))}
        </div>
      </foreignObject>
    </svg>
  );
}
