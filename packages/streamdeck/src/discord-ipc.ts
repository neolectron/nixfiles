import { NodeSocket } from '@effect/platform-node';
import {
  Config,
  Context,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Scope,
} from 'effect';
import { IntegrationError, type Connection, type Message } from './json-socket.ts';

const limit = 1024 * 1024;
const invalid = () => new IntegrationError({ message: 'Trame IPC Discord invalide.' });
export const encode = (opcode: number, message: Message): Uint8Array => {
  const body = new TextEncoder().encode(JSON.stringify(message));
  if (body.length > limit) throw invalid();
  const frame = new Uint8Array(8 + body.length);
  const header = new DataView(frame.buffer);
  header.setUint32(0, opcode, true);
  header.setUint32(4, body.length, true);
  frame.set(body, 8);
  return frame;
};
/** Unix sockets are byte streams: headers/bodies may split or several frames may coalesce. */
export class Decoder {
  private pending = new Uint8Array(0);
  push(chunk: Uint8Array): ReadonlyArray<{ opcode: number; message: Message }> {
    const bytes = new Uint8Array(this.pending.length + chunk.length);
    bytes.set(this.pending);
    bytes.set(chunk, this.pending.length);
    const frames: Array<{ opcode: number; message: Message }> = [];
    let offset = 0;
    while (bytes.length - offset >= 8) {
      const header = new DataView(bytes.buffer, offset, 8);
      const opcode = header.getUint32(0, true);
      const length = header.getUint32(4, true);
      if (length > limit || opcode > 4) throw invalid();
      if (bytes.length - offset < 8 + length) break;
      const message: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          bytes.subarray(offset + 8, offset + 8 + length),
        ),
      );
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw invalid();
      frames.push({ opcode, message: message as Message });
      offset += 8 + length;
    }
    this.pending = bytes.slice(offset);
    return frames;
  }
}
export class DiscordTransport extends Context.Service<
  DiscordTransport,
  {
    readonly connect: (
      clientId: string,
      receive: (message: Message) => Effect.Effect<void, IntegrationError>,
    ) => Effect.Effect<Connection, IntegrationError, Scope.Scope>;
  }
>()('@nixfiles/streamdeck/DiscordTransport') {
  static readonly layer = Layer.effect(
    DiscordTransport,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const override = yield* Config.String('STREAMDECK_DISCORD_IPC_PATH').pipe(Config.option);
      const prefixes: Array<string> = [];
      for (const name of ['XDG_RUNTIME_DIR', 'TMPDIR', 'TMP', 'TEMP']) {
        const value = yield* Config.String(name).pipe(Config.option);
        if (Option.isSome(value)) prefixes.push(value.value);
      }
      const paths = Option.isSome(override)
        ? [override.value]
        : [...new Set([...prefixes, '/tmp'])].flatMap((dir) =>
            Array.from({ length: 10 }, (_, index) => path.join(dir, `discord-ipc-${index}`)),
          );
      return {
        connect: (clientId, receive) =>
          Effect.gen(function* () {
            const available = yield* Effect.filter(paths, (file) => fs.exists(file));
            if (!available.length)
              return yield* Effect.fail(
                new IntegrationError({
                  message:
                    'Socket Discord introuvable. Ouvre Discord Desktop ; STREAMDECK_DISCORD_IPC_PATH permet un chemin explicite.',
                }),
              );
            return yield* Effect.firstSuccessOf(
              available.map((file) =>
                Effect.gen(function* () {
                  const scope = yield* Scope.make();
                  yield* Effect.addFinalizer((exit) => Scope.close(scope, exit));
                  const opened = yield* Effect.gen(function* () {
                    const socket = yield* NodeSocket.makeNet({
                      path: file,
                      openTimeout: '2 seconds',
                    });
                    const reader = yield* socket.reader;
                    const writer = yield* socket.writer;
                    const decoder = new Decoder();
                    const failed = yield* Deferred.make<never, IntegrationError>();
                    const send = (opcode: number, message: Message) =>
                      Effect.try({ try: () => encode(opcode, message), catch: invalid }).pipe(
                        Effect.flatMap(writer.write),
                        Effect.mapError(
                          () =>
                            new IntegrationError({ message: 'Écriture IPC Discord impossible.' }),
                        ),
                      );
                    yield* Effect.forkScoped(
                      Effect.forever(
                        Effect.gen(function* () {
                          for (const chunk of yield* reader.pull) {
                            const frames = yield* Effect.try({
                              try: () =>
                                decoder.push(
                                  typeof chunk === 'string'
                                    ? new TextEncoder().encode(chunk)
                                    : chunk,
                                ),
                              catch: invalid,
                            });
                            for (const frame of frames) {
                              if (frame.opcode === 3) yield* send(4, frame.message);
                              else if (frame.opcode === 2)
                                return yield* Effect.fail(
                                  new IntegrationError({
                                    message: 'Discord a fermé la connexion RPC.',
                                  }),
                                );
                              else if (frame.opcode === 1) yield* receive(frame.message);
                            }
                          }
                        }),
                      ).pipe(
                        Effect.catchCause(() =>
                          Deferred.fail(
                            failed,
                            new IntegrationError({
                              message: 'Connexion IPC Discord fermée ou protocole invalide.',
                            }),
                          ),
                        ),
                      ),
                    );
                    yield* send(0, { v: 1, client_id: clientId });
                    return {
                      send: (message: Message) => send(1, message),
                      failure: Deferred.await(failed),
                    };
                  }).pipe(Scope.provide(scope), Effect.exit);
                  if (Exit.isFailure(opened)) {
                    yield* Scope.close(scope, opened);
                    return yield* Effect.fail(
                      new IntegrationError({
                        message:
                          'Connexion IPC Discord impossible. Vérifie Discord Desktop et l’accès au socket.',
                      }),
                    );
                  }
                  return opened.value;
                }),
              ),
            );
          }).pipe(
            Effect.mapError((cause) =>
              cause instanceof IntegrationError
                ? cause
                : new IntegrationError({ message: 'Recherche du socket Discord impossible.' }),
            ),
          ),
      };
    }),
  );
}
