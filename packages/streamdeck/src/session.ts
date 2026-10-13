import { keyImage } from './image.js';
import type { DeckEvent, DeckTransport } from './transport.js';

export function startSession(deck: DeckTransport, display: boolean, log: (event: unknown) => void, fail: (error: unknown) => void, displayLcd = false) {
  let level = 50;
  let pressed = false;
  let stopped = false;
  let queue = Promise.resolve();
  const key = deck.info.controls.find((control) => control.type === 'button' && control.feedbackType === 'lcd' && control.pixelSize);
  if (display && !key) throw new Error('Ce modèle ne possède pas de touche LCD. Utiliser events pour tester ses entrées.');
  if (displayLcd && !display) throw new Error('Le test de bande LCD exige le mode hello.');
  const lcd = displayLcd ? deck.info.controls.find((control) => control.type === 'lcd-segment' && control.pixelSize) : undefined;
  if (displayLcd && !lcd) throw new Error('Ce modèle ne possède pas de bande LCD. Utiliser hello sans --lcd.');
  const draw = () => {
    if (!display || !key?.pixelSize || stopped) return;
    const rgb = keyImage(key.pixelSize.width, key.pixelSize.height, pressed, level);
    const lcdRgb = lcd?.pixelSize ? keyImage(lcd.pixelSize.width, lcd.pixelSize.height, pressed, level) : undefined;
    // Serialize HID writes; a write failure stops the session through the CLI.
    queue = queue.then(async () => {
      await deck.paintKey(key.index, rgb);
      log({ kind: 'display-written', target: 'button', index: key.index, ...key.pixelSize });
      if (lcd?.pixelSize && lcdRgb) {
        await deck.paintLcd(lcd.index, lcdRgb);
        log({ kind: 'display-written', target: 'lcd', index: lcd.index, ...lcd.pixelSize });
      }
    }).catch(fail);
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
