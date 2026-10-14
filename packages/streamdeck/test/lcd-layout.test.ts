import { assert, it } from '@effect/vitest';
import { Schema } from 'effect';
import * as Layout from '../src/lcd-layout.ts';
import * as Draft from '../web/lcd-draft.ts';
import { supports } from '../src/tile-capabilities.ts';
import * as System from '../src/plugins/system.tsx';
import * as Fields from '../src/plugin-fields.ts';

const tile = (id: string, width = 150): Layout.Tile => ({
  id,
  plugin: 'system',
  action: 'lcd-next',
  input: { zone: 'current' },
  label: id,
  width,
  application: '',
});
const config = (): Layout.Configuration => ({
  zones: [
    {
      id: 'left',
      name: 'Left',
      lcd: 0,
      x: 0,
      width: 200,
      application: '',
      pages: [[tile('a'), tile('b'), tile('c')], [tile('second')]],
    },
    {
      id: 'right',
      name: 'Right',
      lcd: 0,
      x: 600,
      width: 200,
      application: '',
      pages: [[tile('fixed')]],
    },
  ],
  folders: [{ id: 'tools', name: 'Outils', pages: [[tile('inside')], [tile('inside-page-2')]] }],
});
it('LCD pages and folders navigate in their target zone and restore the parent scroll position', () => {
  const value = config();
  let state = Layout.navigate(value, {}, { zone: 'left', operation: 'scroll', delta: 120 });
  state = Layout.navigate(value, state, { zone: 'left', operation: 'open', folder: 'Outils' });
  let view = Layout.project(value, state, 0, null);
  assert.strictEqual(view[0]!.tiles[0]!.tile.action, 'lcd-back');
  assert.strictEqual(view[0]!.tiles[1]!.tile.id, 'inside');
  assert.strictEqual(view[1]!.tiles[0]!.tile.id, 'fixed');
  state = Layout.navigate(value, state, { zone: 'left', operation: 'next' });
  assert.strictEqual(Layout.project(value, state, 0, null)[0]!.tiles[1]!.tile.id, 'inside-page-2');
  state = Layout.navigate(value, state, { zone: 'left', operation: 'back' });
  view = Layout.project(value, state, 0, null);
  assert.strictEqual(view[0]!.folder, null);
  assert.strictEqual(view[0]!.offset, 120);
  state = Layout.navigate(value, state, { zone: 'left', operation: 'previous' });
  assert.strictEqual(Layout.project(value, state, 0, null)[0]!.page, 1);
  assert.strictEqual(Layout.project(value, state, 0, null)[1]!.page, 0);
});
it('horizontal scrolling clips partial tiles and reverses immediately after overscroll', () => {
  const value = config();
  const state = Layout.navigate(value, {}, { zone: 'left', operation: 'scroll', delta: 10000 });
  const view = Layout.project(value, state, 0, null)[0]!;
  assert.strictEqual(view.offset, 250);
  assert.deepStrictEqual(
    view.tiles
      .filter((entry) => entry.width > 0)
      .map((entry) => [entry.tile.id, entry.left, entry.width]),
    [
      ['b', 100, 50],
      ['c', 0, 150],
    ],
  );
  const after = Layout.navigate(value, state, { zone: 'left', operation: 'scroll', delta: -10 });
  assert.strictEqual(Layout.project(value, after, 0, null)[0]!.offset, 240);
  assert.strictEqual(
    Layout.project(
      value,
      Layout.navigate(value, after, { zone: 'left', operation: 'next' }),
      0,
      null,
    )[0]!.offset,
    0,
  );
});
it('visibility matches app_id and compacts hidden tiles without reserving their width', () => {
  const before = config();
  const value = {
    ...before,
    zones: before.zones.map((zone) =>
      zone.id !== 'left'
        ? zone
        : { ...zone, pages: [[{ ...tile('context'), application: 'discord' }, tile('always')]] },
    ),
  };
  assert.deepStrictEqual(
    Layout.project(value, {}, 0, 'codex')[0]!.tiles.map((entry) => [entry.tile.id, entry.x]),
    [['always', 0]],
  );
  assert.deepStrictEqual(
    Layout.project(value, {}, 0, 'Discord')[0]!.tiles.map((entry) => [entry.tile.id, entry.x]),
    [
      ['context', 0],
      ['always', 150],
    ],
  );
  assert.deepStrictEqual(
    Layout.project(
      { ...value, zones: value.zones.map((zone) => ({ ...zone, application: 'discord' })) },
      {},
      0,
      'codex',
    ),
    [],
  );
});
it('LCD validation rejects overlap, missing screens, duplicate tiles and invalid dimensions', () => {
  const value = config();
  assert.doesNotThrow(() => Layout.validate(value, [{ index: 0, width: 1200 }]));
  assert.throws(() => Layout.validate(value, []));
  assert.throws(() =>
    Layout.validate({ ...value, zones: value.zones.map((zone) => ({ ...zone, x: 0 })) }),
  );
  assert.throws(() =>
    Layout.validate({ ...value, folders: [{ ...value.folders[0]!, pages: [[tile('a')]] }] }),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(Layout.Configuration)({
      ...value,
      zones: [{ ...value.zones[0], width: NaN }],
    }),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(Layout.Configuration)({
      ...value,
      zones: [{ ...value.zones[0], pages: [] }],
    }),
  );
  let state: Layout.Navigation = {};
  for (let index = 0; index < 32; index++)
    state = Layout.navigate(value, state, { zone: 'left', operation: 'open', folder: 'tools' });
  assert.throws(() =>
    Layout.navigate(value, state, { zone: 'left', operation: 'open', folder: 'tools' }),
  );
});
it('palette drops and append edit a pure LCD draft, including tiles outside the viewport', () => {
  const action = { ...System.activeWindow.info, plugin: 'system', pluginName: 'Système' };
  const first = Draft.insert(Layout.empty, {}, action, { index: 0, width: 1200 }, 1000, {
    tile: 'window',
    zone: 'window-zone',
  });
  assert.strictEqual(first.config.zones[0]!.x, 800);
  const second = Draft.insert(
    first.config,
    {},
    {
      ...action,
      id: 'lcd-next',
      tile: { label: 'Next', icon: 'next' },
      defaults: { zone: 'current' },
    },
    { index: 0, width: 1200 },
    800,
    { tile: 'next', zone: 'unused' },
    true,
  );
  assert.strictEqual(first.config.zones[0]!.pages[0]!.length, 1);
  assert.strictEqual(second.config.zones[0]!.pages[0]!.length, 2);
  assert.strictEqual(Layout.project(second.config, {}, 0, null)[0]!.contentWidth, 560);
  assert.strictEqual(Layout.project(second.config, {}, 0, null)[0]!.tiles[1]!.width, 0);
  assert.strictEqual(supports(action, 'key'), false);
  assert.strictEqual(supports(action, 'lcd'), true);
  assert.strictEqual(
    supports({ interaction: 'press', tile: { label: 'Play', icon: 'play' } }, 'lcd'),
    true,
  );
  assert.strictEqual(supports({ interaction: 'hold' }, 'lcd'), false);
  assert.throws(() =>
    Draft.insert(
      Layout.empty,
      {},
      { ...action, interaction: 'hold' },
      { index: 0, width: 1200 },
      0,
      { tile: 'bad', zone: 'bad' },
    ),
  );
});
it('plugins describe LCD target fields with schemas; forms do not depend on plugin names', () => {
  const fields = Fields.fields(System.folder.info.schema);
  assert.deepStrictEqual(
    fields.map((field) => field.kind),
    ['lcd-zone', 'lcd-folder'],
  );
  assert.deepStrictEqual(
    Fields.input(System.folder.info.schema, { 'input:zone': 'left', 'input:folder': 'tools' }),
    { zone: 'left', folder: 'tools' },
  );
});
