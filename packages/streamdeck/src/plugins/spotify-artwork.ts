import { NodeFileSystem, NodePath } from '@effect/platform-node';
import { Context, Effect, FileSystem, Layer, Path, Stream } from 'effect';
import { Base64 } from 'effect/encoding';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { IntegrationError } from '../json-socket.ts';

const maxBytes = 1024 * 1024;
const invalid = () => new IntegrationError({ message: 'Jaquette absente ou invalide.' });
const dataUri = (bytes: Uint8Array) => {
  if (!bytes.length || bytes.length > maxBytes) return undefined;
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? 'image/png'
    : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP' ? 'image/webp' : undefined;
  return mime ? `data:${mime};base64,${Base64.encode(bytes)}` : undefined;
};

/** File/HTTP boundary, separate from metadata and presentation. Bodies are bounded while streaming. */
export const load = (source: string) => Effect.scoped(Effect.gen(function*() {
  const url = URL.parse(source); if (!url || url.username || url.password) return yield* Effect.fail(invalid());
  let bytes: Uint8Array;
  if (url.protocol === 'file:' && (!url.hostname || url.hostname === 'localhost')) {
    const fs = yield* FileSystem.FileSystem; const path = yield* Path.Path;
    const filename = yield* path.fromFileUrl(url); const stat = yield* fs.stat(filename);
    if (stat.size > maxBytes) return yield* Effect.fail(invalid());
    bytes = yield* fs.readFile(filename);
  } else if (url.protocol === 'http:' || url.protocol === 'https:') {
    const client = yield* HttpClient.HttpClient; const response = yield* client.get(url.href);
    if (response.status !== 200) return yield* Effect.fail(invalid());
    const body = yield* Stream.runFoldEffect(response.stream, () => ({ chunks: [] as Uint8Array[], length: 0 }), (acc, chunk) => {
      if (acc.length + chunk.length > maxBytes) return Effect.fail(invalid());
      acc.chunks.push(chunk); acc.length += chunk.length; return Effect.succeed(acc);
    });
    bytes = new Uint8Array(body.length); let offset = 0;
    for (const chunk of body.chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  } else return yield* Effect.fail(invalid());
  return dataUri(bytes);
})).pipe(Effect.timeout('3 seconds'));

/** Non-blocking, scoped cache: at most eight covers and two concurrent loads. */
export const make = <E, R>(fetch: (url: string) => Effect.Effect<string | undefined, E, R>) => Effect.gen(function*() {
  const owner = yield* Effect.scope; const context = yield* Effect.context<R>();
  const entries = new Map<string, { data: string | undefined; pending: boolean }>(); let running = 0;
  return { current: (url: string | null) => Effect.gen(function*() {
    if (!url || owner.state._tag === 'Closed') return undefined;
    const cached = entries.get(url);
    if (cached) { entries.delete(url); entries.set(url, cached); return cached.data; }
    if (running >= 2) return undefined;
    if (entries.size >= 8) { const oldest = [...entries].find(([, entry]) => !entry.pending); if (oldest) entries.delete(oldest[0]); }
    const entry = { data: undefined as string | undefined, pending: true }; entries.set(url, entry); running++;
    yield* Effect.forkIn(fetch(url).pipe(Effect.provideContext(context), Effect.orElseSucceed(() => undefined),
      Effect.tap((data) => Effect.sync(() => { entry.data = data; })),
      Effect.ensuring(Effect.sync(() => { entry.pending = false; running--; }))), owner);
    return undefined;
  }) };
});
export class SpotifyArtwork extends Context.Service<SpotifyArtwork, { readonly current: (url: string | null) => Effect.Effect<string | undefined> }>()('@nixfiles/streamdeck/SpotifyArtwork') {}
export const live = make((url) => load(url).pipe(Effect.provide(Layer.mergeAll(FetchHttpClient.layer, NodeFileSystem.layer, NodePath.layer))));
