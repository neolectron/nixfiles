import type { ComponentType } from 'react';

export interface IconProps {
  readonly color?: string;
  readonly size?: number;
}
const icons = new Map<string, ComponentType<IconProps>>();
/** Compiled plugin assets only. Registrations are metadata, independent of plugin activation. */
export const register = (id: string, Icon: ComponentType<IconProps>) => {
  const previous = icons.get(id);
  if (previous && previous !== Icon) throw new Error(`Duplicate icon: ${id}`);
  icons.set(id, Icon);
};
export const find = (id: string) => icons.get(id);
