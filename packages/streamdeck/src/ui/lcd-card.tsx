import type { ReactNode } from 'react';
import type { Size } from '../model.ts';

/** Shared LCD frame for plugin tiles and mixer cards, in the browser and on hardware. */
export function LcdCard({ width, height, children }: Size & { children?: ReactNode }) {
  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        background: '#0D0D10',
        fontFamily: 'Liberation Sans',
      }}
    >
      {children === null || children === undefined ? null : (
        <div
          style={{
            position: 'absolute',
            left: 4,
            top: 4,
            width: width - 8,
            height: height - 8,
            borderRadius: 7,
            overflow: 'hidden',
            background: 'linear-gradient(#41414D,#35353F)',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
