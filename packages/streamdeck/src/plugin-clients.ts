import { registry } from './plugin-client.ts';
import { client as spotify } from './plugins/spotify-client.tsx';
import { presentation as activeWindow } from './plugins/system-presentation.tsx';
import { presentation as volume } from './ui/volume-presentation.tsx';
import { presentation as action } from './ui/action-presentation.tsx';

/** Application composition; adding a plugin never requires editing the renderer or icon schema. */
const clients = [
  spotify,
  { id: 'system', presentations: [activeWindow] },
  { id: 'audio-mixer', presentations: [volume] },
  { id: 'shortcuts', presentations: [action] },
];
export const initialize = () => registry(clients);
export const render = initialize();
