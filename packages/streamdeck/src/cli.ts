import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { listHardware, openHardware } from './hid.js';
import { MockDeck, mockInfo, demoEvents } from './mock.js';
import { startSession } from './session.js';
import { selectDevice } from './transport.js';

const help = `Stream Deck USB-HID Linux (sans logiciel Elgato)
  pnpm streamdeck list [--mock]
  pnpm streamdeck events [--path <chemin>] [--duration <secondes>]
  pnpm streamdeck hello [--path <chemin>] [--duration <secondes>]
  pnpm streamdeck hello --mock --demo
  pnpm streamdeck events --mock --demo

list : détecter le modèle et ses capacités, sans ouvrir ni écrire l'appareil.
events : journaliser boutons, potards et gestes tactiles, sans image.
hello : écrire uniquement la première touche LCD ; HELLO/OK et jauge simulée.
--mock : aucune importation du pilote HID natif, aucune action système.
--demo : rejouer un scénario fini (uniquement avec --mock).
Ctrl+C : fermer proprement la connexion. L'image test reste sur la touche.
`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    mock: { type: 'boolean' }, demo: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    path: { type: 'string' }, duration: { type: 'string' },
  } });
  if (values.help) { console.log(help); return; }
  const command = positionals[0];
  if (positionals.length !== 1 || !['list', 'events', 'hello'].includes(command ?? '')) throw new Error(help);
  if (values.demo && !values.mock) throw new Error('--demo exige --mock pour ne jamais ouvrir du matériel involontairement.');
  const duration = values.duration === undefined ? undefined : Number(values.duration);
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || duration > 86400)) throw new Error('--duration doit être un nombre de secondes entre 0 et 86400, bornes exclue/incluse.');
  if (command === 'list' && (values.path || values.duration || values.demo)) throw new Error('list accepte uniquement --mock ou --help.');
  const devices = values.mock ? [mockInfo] : await listHardware();
  if (command === 'list') {
    console.log(JSON.stringify(devices, null, 2));
    if (!devices.length) console.error('Aucun appareil reconnu. Brancher le Stream Deck puis relancer.');
    return;
  }
  const selected = selectDevice(devices, values.path);
  const deck = values.mock ? new MockDeck(selected) : await openHardware(selected);
  const controller = new AbortController();
  let failure: unknown;
  let failed = false;
  const fail = (error: unknown) => { failure = error; failed = true; controller.abort(); };
  const stop = () => { controller.abort(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const timer = duration === undefined ? undefined : setTimeout(stop, duration * 1000);
  let session: ReturnType<typeof startSession> | undefined;
  try {
    console.log(JSON.stringify({ kind: 'connected', ...deck.info, mock: !!values.mock }));
    session = startSession(deck, command === 'hello', (event) => console.log(JSON.stringify(event)), fail);
    await session.flush();
    if (values.demo) {
      for (const event of demoEvents) {
        if (controller.signal.aborted) break;
        (deck as MockDeck).emit(event);
        await session.flush();
        await delay(100, undefined, { signal: controller.signal }).catch(() => {});
      }
      console.log(JSON.stringify({ kind: 'demo-complete', frames: (deck as MockDeck).frames.length, level: session.level }));
    } else {
      console.log('En écoute. Ctrl+C pour quitter ; --mock --demo pour rejouer les événements simulés.');
      if (!controller.signal.aborted) await new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    }
  } finally {
    if (timer) clearTimeout(timer);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    try { await session?.stop(); } finally { await deck.close(); }
  }
  if (failed) throw failure;
}

main().catch((error: unknown) => {
  console.error(`Stream Deck : ${error instanceof Error ? error.message : String(error)}`);
  console.error('Pour les erreurs HID natives/permissions, consulter packages/streamdeck/README.md. Ne pas lancer les démos avec sudo.');
  process.exitCode = 1;
});
