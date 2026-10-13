import { Effect } from 'effect';
import * as SvgDisplay from './mixer-display.ts';
import { StreamDeckError } from './errors.ts';

export type RendererKind = 'svg' | 'react';

/** Keep optional React/native dependencies outside the default SVG startup path. */
export const make = (kind: RendererKind) => kind === 'svg' ? SvgDisplay.make : Effect.tryPromise({
  try: () => import('./react-mixer.ts'),
  catch: (cause) => new StreamDeckError({ reason: 'Driver', operation: 'react-import', message: 'Could not load React renderer.', cause }),
}).pipe(Effect.flatMap((module) => module.make));
