import { assert, it } from '@effect/vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeckHeading, type DeviceIdentity } from '../web/deck-heading.tsx';
import { DeviceShell } from '../web/device-shell.tsx';
import { deviceSkin } from '../web/device-skin.ts';

const connected: DeviceIdentity = {
  model: 'Stream Deck + XL',
  mock: false,
  connected: true,
  connectionError: null,
};
it('uses the reported device model and preserves unknown models without guessing', () => {
  assert.strictEqual(deviceSkin('Stream Deck + XL'), 'plus-xl');
  assert.strictEqual(deviceSkin('Stream Deck XL'), 'xl');
  assert.strictEqual(deviceSkin('Stream Deck Mini'), 'mini');
  assert.strictEqual(deviceSkin('Mock Stream Deck +'), 'plus');
  assert.strictEqual(deviceSkin('Future Stream Deck'), 'generic');
  assert.strictEqual(deviceSkin(undefined), 'generic');
  const html = renderToStaticMarkup(
    <DeviceShell snapshot={{ ...connected, dials: [], lcds: [] }} online columns={9}>
      <button>Action</button>
    </DeviceShell>,
  );
  assert.include(html, 'data-deck-skin="plus-xl"');
  assert.include(html, 'aria-label="Stream Deck + XL"');
  assert.include(html, '<button>Action</button>');
});
it('distinguishes hardware connection, simulation, backend reconnection and USB errors', () => {
  const render = (snapshot: DeviceIdentity | undefined, online = true) =>
    renderToStaticMarkup(<DeckHeading snapshot={snapshot} online={online} />);
  assert.include(render(connected), 'device-logo online');
  assert.include(render(connected), 'aria-label="Connecté"');
  assert.include(render({ ...connected, mock: true }), 'Deck simulé');
  assert.include(render({ ...connected, mock: true }), 'device-logo warning');
  assert.include(render({ ...connected, connected: false }), 'Déconnecté');
  assert.include(render(connected, false), 'Reconnexion…');
  assert.include(render(undefined, false), 'Connexion…');
  const failure = render({ ...connected, connected: false, connectionError: 'USB indisponible' });
  assert.include(failure, 'device-logo error');
  assert.include(failure, 'title="USB indisponible"');
});
