import { assert, it } from '@effect/vitest';
import { NodeServices } from '@effect/platform-node';
import { ConfigProvider, Effect, FileSystem, Ref, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { DesktopBackend, discover, make, type Window } from '../src/desktop.ts';
import { IntegrationError } from '../src/errors.ts';
import { make as makeIcons } from '../src/desktop-icons.ts';

const application = {
  id: 'discord.desktop',
  name: 'Discord',
  file: '/desktop/discord.desktop',
  windowClass: 'discord',
};
const target = { applications: ['discord.desktop'], windows: ['discord'] };

it.effect(
  'Desktop focus follows the focused window, clears on failure and recovers without focusing any app',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const windows = yield* Ref.make<Result.Result<ReadonlyArray<Window>, IntegrationError>>(
          Result.succeed([
            { id: 1, app_id: 'Discord', is_focused: false },
            { id: 2, app_id: 'game', is_focused: true },
          ]),
        );
        const api = yield* make.pipe(
          Effect.provideService(DesktopBackend, {
            applications: Effect.succeed([application]),
            windows: Ref.get(windows).pipe(Effect.flatMap(Effect.fromResult)),
            launch: () => Effect.die('Unexpected launch'),
            focus: () => Effect.die('Unexpected focus'),
          }),
        );
        assert.strictEqual((yield* api.focused)?.app_id, 'game');
        assert.strictEqual((yield* api.status(target)).running, true);
        yield* Ref.set(windows, Result.succeed([{ id: 1, app_id: 'Discord', is_focused: true }]));
        yield* TestClock.adjust('1 second');
        assert.strictEqual((yield* api.focused)?.app_id, 'Discord');
        yield* Ref.set(windows, Result.fail(new IntegrationError({ message: 'Unavailable' })));
        yield* TestClock.adjust('1 second');
        assert.ok(Result.isFailure(yield* Effect.result(api.focused)));
        yield* Ref.set(windows, Result.succeed([{ id: 1, app_id: 'Discord' }]));
        yield* TestClock.adjust('1 second');
        assert.strictEqual(yield* api.focused, null);
      }),
    ),
);

it.effect(
  'Desktop publishes window changes, focuses existing apps and launches absent ones once',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const windows = yield* Ref.make<ReadonlyArray<Window>>([]);
        const launched: string[] = [];
        const focused: number[] = [];
        const api = yield* make.pipe(
          Effect.provideService(DesktopBackend, {
            applications: Effect.succeed([application]),
            windows: Ref.get(windows),
            launch: (app) =>
              Effect.sync(() => {
                launched.push(app.id);
              }),
            focus: (window) =>
              Effect.sync(() => {
                focused.push(window.id);
              }),
          }),
        );
        assert.strictEqual((yield* api.status(target)).running, false);
        yield* api.open(target);
        assert.deepStrictEqual(launched, ['discord.desktop']);
        yield* Ref.set(windows, [
          { id: 42, app_id: 'Discord' },
          { id: 9, app_id: 'discord-other' },
        ]);
        yield* TestClock.adjust('1 second');
        assert.strictEqual((yield* api.status(target)).running, true);
        yield* api.open(target);
        assert.deepStrictEqual(focused, [42]);
        assert.deepStrictEqual(launched, ['discord.desktop']);
        yield* Ref.set(windows, []);
        yield* TestClock.adjust('1 second');
        assert.strictEqual((yield* api.status(target)).running, false);
        const missing = yield* Effect.result(
          api.open({ applications: ['missing.desktop'], windows: [] }),
        );
        assert.ok(Result.isFailure(missing));
        assert.deepStrictEqual(launched, ['discord.desktop']);
      }),
    ),
);

it.effect('Desktop exposes unavailable state and revokes operations when its scope closes', () =>
  Effect.gen(function* () {
    let reads = 0;
    const backend = {
      applications: Effect.succeed([application]),
      windows: Effect.sync(() => {
        reads++;
      }).pipe(Effect.andThen(Effect.fail(new IntegrationError({ message: 'No desktop' })))),
      launch: () => Effect.void,
      focus: () => Effect.void,
    };
    const api = yield* Effect.scoped(make.pipe(Effect.provideService(DesktopBackend, backend)));
    const count = reads;
    yield* TestClock.adjust('3 seconds');
    assert.strictEqual(reads, count);
    assert.ok(Result.isFailure(yield* api.snapshot));
    assert.ok(Result.isFailure(yield* Effect.result(api.open(target))));
  }),
);

it.live('Desktop discovery respects XDG overrides, hidden entries and stable IDs', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'desktop-discovery-' });
      const local = `${directory}/local`;
      const system = `${directory}/system`;
      for (const root of [local, system])
        yield* fs.makeDirectory(`${root}/applications`, { recursive: true });
      const entry = (name: string, extra = '') =>
        `[Desktop Entry]\nType=Application\nName=${name}\nExec=unused\n${extra}`;
      yield* fs.writeFileString(`${system}/applications/discord.desktop`, entry('System Discord'));
      yield* fs.writeFileString(
        `${local}/applications/discord.desktop`,
        entry('Local Discord', 'StartupWMClass=discord\nIcon=discord\n'),
      );
      yield* fs.writeFileString(`${system}/applications/hidden.desktop`, entry('Visible system'));
      yield* fs.writeFileString(
        `${local}/applications/hidden.desktop`,
        entry('Hidden', 'Hidden=true\n'),
      );
      const apps = yield* discover.pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnvRecord({
            HOME: directory,
            XDG_DATA_HOME: local,
            XDG_DATA_DIRS: system,
          }),
        ),
      );
      assert.deepStrictEqual(apps, [
        {
          id: 'discord.desktop',
          name: 'Local Discord',
          file: `${local}/applications/discord.desktop`,
          windowClass: 'discord',
          icon: 'discord',
        },
      ]);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live('desktop icons resolve XDG SVG/PNG and absolute files with bounded, cached reads', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'desktop-icons-' });
      const iconDirectory = `${directory}/icons/hicolor/scalable/apps`;
      yield* fs.makeDirectory(iconDirectory, { recursive: true });
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>';
      yield* fs.writeFileString(`${iconDirectory}/test.svg`, svg);
      const pngDirectory = `${directory}/icons/hicolor/256x256/apps`;
      yield* fs.makeDirectory(pngDirectory, { recursive: true });
      yield* fs.writeFile(`${pngDirectory}/high-resolution.png`, new Uint8Array([137, 80, 78, 71]));
      const api = yield* makeIcons.pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnvRecord({
            HOME: directory,
            XDG_DATA_HOME: directory,
            XDG_DATA_DIRS: `${directory}/empty`,
          }),
        ),
      );
      const icon = yield* api.resolve('test');
      assert.strictEqual(icon?.contentType, 'image/svg+xml');
      assert.strictEqual(new TextDecoder().decode(icon?.bytes), svg);
      const highResolution = yield* api.resolve('high-resolution');
      assert.strictEqual(highResolution?.contentType, 'image/png');
      assert.deepStrictEqual([...highResolution!.bytes], [137, 80, 78, 71]);
      yield* fs.remove(`${iconDirectory}/test.svg`);
      assert.deepStrictEqual(yield* api.resolve('test'), icon);
      yield* fs.writeFileString(`${directory}/large.svg`, 'x'.repeat(1048577));
      assert.strictEqual(yield* api.resolve(`${directory}/large.svg`), undefined);
      assert.strictEqual(yield* api.resolve('../test'), undefined);
      assert.strictEqual(yield* api.resolve(`${directory}/missing.png`), undefined);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
