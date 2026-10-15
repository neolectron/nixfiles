import type { ComponentType, ReactNode } from 'react';
import * as Icons from './icon-registry.tsx';
import * as Presentation from './presentation.tsx';
import type { Json } from 'effect/Schema';

export interface Client {
  readonly id: string;
  readonly icons?: Readonly<Record<string, ComponentType<Icons.IconProps>>>;
  readonly presentations?: ReadonlyArray<{ type: string; render: (data: Json) => ReactNode }>;
}
/** Server and browser import this composition without importing OS services. */
export const registry = (plugins: ReadonlyArray<Client>) => {
  const views = plugins.flatMap((plugin) => plugin.presentations ?? []);
  if (new Set(views.map((view) => view.type)).size !== views.length)
    throw new Error('Duplicate plugin presentation.');
  for (const plugin of plugins)
    for (const [id, Icon] of Object.entries(plugin.icons ?? {})) Icons.register(id, Icon);
  return Presentation.registry(views);
};
