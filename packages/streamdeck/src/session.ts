import { keyImage } from './image.js';
import type { DeckEvent, DeckTransport } from './transport.js';

export function startSession(deck: DeckTransport, display: boolean, log: (event: unknown) => void, fail: (error: unknown) => void) {
  let level = 50;
  let pressed = false;
  let stopped = false;
  let queue = Promise.resolve();
  const key = deck.info.controls.find((control) => control.type === 'button' && control.feedbackType === 'lcd' && control.pixelSize);
  if (display && !key) throw new Error('Ce modèle ne possède pas de touche LCD. Utiliser events pour tester ses entrées.');
  const draw = () => {
    if (!display || !key?.pixelSize || stopped) return;
    const rgb = keyImage(key.pixelSize.width, key.pixelSize.height, pressed, level);
    // Serialize HID writes; a write failure stops the session through the CLI.
    queue = queue.then(() => deck.paintKey(key.index, rgb)).catch(fail);
  };
  const unsubscribe = deck.subscribe((event: DeckEvent) => {
    if (stopped) return;
    if (event.kind === 'error') { fail(event.error); return; }
    log(event);
    if ((event.kind === 'down' || event.kind === 'up') && event.control.type === 'button' && event.control.index === key?.index) {
      pressed = event.kind === 'down'; draw();
    } else if (event.kind === 'rotate') {
      level = Math.min(100, Math.max(0, level + event.amount));
      log({ kind: 'demo-level', level, note: 'Valeur simulée ; aucun volume système modifié' });
      draw();
    }
  });
  draw();
  return {
    get level() { return level; },
    async flush() { await queue; },
    async stop() { stopped = true; unsubscribe(); await queue; },
  };
}
