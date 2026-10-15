import { Schema } from 'effect';
import { KeyFeedback } from './key-feedback.ts';
import { PublicConnection } from '@nixfiles/system-control/discord-contract.ts';
import { KeyTrigger } from './press-trigger.ts';
import { Region } from './presentation.tsx';
import * as LcdLayout from './lcd-layout.ts';

const shortText = Schema.String.check(Schema.isMaxLength(80));
const argument = Schema.String.check(Schema.isMaxLength(4096));
export const actionParameters = {
  'launch-app': Schema.Struct({
    application: Schema.NonEmptyString.annotate({ title: 'Application' }),
  }),
  'run-command': Schema.Struct({
    executable: Schema.NonEmptyString.check(Schema.isMaxLength(1024)).annotate({
      title: 'Exécutable ou script',
    }),
    arguments: Schema.Array(argument).annotate({
      title: 'Arguments',
      description: 'Tableau JSON : chaque élément est transmis comme un argument littéral.',
    }),
    directory: Schema.String.check(Schema.isMaxLength(4096)).annotate({
      title: 'Dossier de travail',
    }),
  }),
  'open-folder': Schema.Struct({
    folder: Schema.NonEmptyString,
    target: Schema.optional(Schema.NonEmptyString),
  }),
  'go-back': Schema.Struct({}),
  'page-next': Schema.Struct({ target: Schema.NonEmptyString }),
  'page-previous': Schema.Struct({ target: Schema.NonEmptyString }),
  plugin: Schema.Struct({
    plugin: Schema.NonEmptyString,
    command: Schema.NonEmptyString,
    input: Schema.Unknown,
  }),
  counter: Schema.Struct({
    start: Schema.Int.check(Schema.isBetween({ minimum: -9999, maximum: 9999 })).annotate({
      title: 'Valeur de départ',
    }),
  }),
} as const;
export const ButtonBinding = Schema.Union([
  Schema.Struct({
    label: shortText,
    trigger: Schema.optional(KeyTrigger),
    action: Schema.Literal('plugin'),
    parameters: actionParameters.plugin,
  }),
  Schema.Struct({
    label: shortText,
    trigger: Schema.optional(KeyTrigger),
    action: Schema.Literal('launch-app'),
    parameters: actionParameters['launch-app'],
  }),
  Schema.Struct({
    label: shortText,
    trigger: Schema.optional(KeyTrigger),
    action: Schema.Literal('run-command'),
    parameters: actionParameters['run-command'],
  }),
  Schema.Struct({
    label: shortText,
    trigger: Schema.optional(KeyTrigger),
    action: Schema.Literal('counter'),
    parameters: actionParameters.counter,
  }),
  Schema.Struct({
    label: shortText,
    trigger: Schema.optional(KeyTrigger),
    action: Schema.Literal('open-folder'),
    parameters: actionParameters['open-folder'],
  }),
  Schema.Struct({
    label: shortText,
    trigger: Schema.optional(KeyTrigger),
    action: Schema.Literal('go-back'),
    parameters: actionParameters['go-back'],
  }),
  Schema.Struct({
    label: shortText,
    trigger: Schema.optional(KeyTrigger),
    action: Schema.Literal('page-next'),
    parameters: actionParameters['page-next'],
  }),
  Schema.Struct({
    label: shortText,
    trigger: Schema.optional(KeyTrigger),
    action: Schema.Literal('page-previous'),
    parameters: actionParameters['page-previous'],
  }),
]);
export type ButtonBinding = typeof ButtonBinding.Type;
export type ActionId = ButtonBinding['action'];
export const GestureBindings = Schema.Struct({
  press: Schema.optionalKey(ButtonBinding),
  longPress: Schema.optionalKey(ButtonBinding),
  doubleTap: Schema.optionalKey(ButtonBinding),
});
export type GestureBindings = typeof GestureBindings.Type;
export const ContextRule = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  applications: Schema.Array(Schema.NonEmptyString),
  priority: Schema.Int,
  keys: Schema.Record(Schema.String, Schema.NullOr(ButtonBinding)),
  lcd: Schema.optionalKey(LcdLayout.Configuration),
});
export type ContextRule = typeof ContextRule.Type;
export const LegacyProfile = Schema.Struct({
  version: Schema.Literal(1),
  buttons: Schema.Record(Schema.String, ButtonBinding),
});
export const Entry = Schema.Struct({
  id: Schema.NonEmptyString,
  binding: ButtonBinding,
  stateVersion: Schema.optionalKey(Schema.NonEmptyString),
  gestures: Schema.optionalKey(GestureBindings),
});
export type Entry = typeof Entry.Type;
const minimumPages = Schema.optional(
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4096 })),
);
const items = Schema.Array(Schema.NullOr(Entry)).check(Schema.isMaxLength(4096));
export const Profile = Schema.Struct({
  version: Schema.Literal(2),
  contexts: Schema.optionalKey(Schema.Array(ContextRule)),
  lcd: Schema.optionalKey(LcdLayout.Configuration),
  zones: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      name: shortText,
      keys: Schema.Array(Schema.Int),
      items,
      minimumPages,
      pinned: Schema.Record(Schema.String, Entry),
    }),
  ),
  folders: Schema.Array(
    Schema.Struct({ id: Schema.NonEmptyString, name: shortText, items, minimumPages }),
  ),
});
export type Profile = typeof Profile.Type;
export const StoredProfile = Schema.Union([LegacyProfile, Profile]);
const LayoutPosition = Schema.Struct({
  folder: Schema.NullOr(Schema.String),
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export const Navigation = Schema.Record(
  Schema.String,
  Schema.Struct({
    ...LayoutPosition.fields,
    history: Schema.Array(LayoutPosition).check(Schema.isMaxLength(32)),
  }),
);
export const Configuration = Schema.Struct({
  profile: Profile,
  navigation: Navigation,
  revision: Schema.Int,
});
export const UpdateProfile = Schema.Struct({
  profile: Profile,
  navigation: Navigation,
  expectedRevision: Schema.Int,
  expectedProfile: Profile,
  sessionId: Schema.NonEmptyString,
});
export const UpdateBinding = Schema.Struct({
  key: Schema.Int,
  binding: Schema.NullOr(ButtonBinding),
  expected: Schema.optional(Schema.NullOr(ButtonBinding)),
  address: Schema.optional(Schema.String),
});
export const Trigger = Schema.Struct({ key: Schema.Int, address: Schema.optional(Schema.String) });
export const KeyInput = Schema.Struct({
  key: Schema.Int,
  phase: Schema.Literals(['down', 'up', 'cancel']),
  owner: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
  address: Schema.String,
  revision: Schema.Int,
});
export const Navigate = Schema.Struct({
  zone: Schema.NonEmptyString,
  operation: Schema.Literals(['next', 'previous', 'back', 'root', 'open']),
  folder: Schema.optional(Schema.String),
});
export type Navigate = typeof Navigate.Type;
export const Organize = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal('exchange'),
    source: Schema.Int,
    target: Schema.Int,
    sourceAddress: Schema.String,
    targetAddress: Schema.String,
    revision: Schema.Int,
  }),
  Schema.Struct({
    operation: Schema.Literal('create-folder'),
    key: Schema.Int,
    name: shortText,
    address: Schema.String,
    target: Schema.optional(Schema.NonEmptyString),
  }),
  Schema.Struct({
    operation: Schema.Literal('move'),
    id: Schema.NonEmptyString,
    destination: Schema.NonEmptyString,
    revision: Schema.Int,
  }),
  Schema.Struct({
    operation: Schema.Literal('create-zone'),
    name: shortText,
    keys: Schema.Array(Schema.Int),
    revision: Schema.Int,
  }),
  Schema.Struct({
    operation: Schema.Literal('resize-zone'),
    zone: Schema.NonEmptyString,
    keys: Schema.Array(Schema.Int),
    revision: Schema.Int,
  }),
  Schema.Struct({
    operation: Schema.Literal('add-page'),
    zone: Schema.NonEmptyString,
    revision: Schema.Int,
  }),
  Schema.Struct({
    operation: Schema.Literal('pin'),
    key: Schema.Int,
    value: Schema.Boolean,
    address: Schema.String,
  }),
  Schema.Struct({
    operation: Schema.Literal('rename-folder'),
    id: Schema.NonEmptyString,
    name: shortText,
    revision: Schema.Int,
  }),
]);
export type Organize = typeof Organize.Type;
const ZoneView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  keys: Schema.Array(Schema.Int),
  folder: Schema.NullOr(Schema.String),
  page: Schema.Int,
  pages: Schema.Int,
  breadcrumbs: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
const LayoutView = Schema.Struct({
  revision: Schema.Int,
  zones: Schema.Array(ZoneView),
  folders: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, count: Schema.Int }),
  ),
});
export type LayoutView = typeof LayoutView.Type;

export interface ApplicationEntry {
  readonly id: string;
  readonly name: string;
  readonly file: string;
}
export interface ActionField {
  readonly key: string;
  readonly label: string;
  readonly kind: 'text' | 'number' | 'arguments' | 'app' | 'folder' | 'zone';
  readonly hint: string;
}
export interface ActionDefinition {
  readonly id: ActionId;
  readonly name: string;
  readonly description: string;
  readonly fields: ReadonlyArray<ActionField>;
  readonly defaults: ButtonBinding['parameters'];
  readonly schema: unknown;
}
const CatalogueBase = Schema.Struct({
  actions: Schema.Array(
    Schema.Struct({
      id: Schema.Literals([
        'launch-app',
        'run-command',
        'counter',
        'open-folder',
        'go-back',
        'page-next',
        'page-previous',
        'plugin',
      ]),
      name: Schema.String,
      description: Schema.String,
      fields: Schema.Array(
        Schema.Struct({
          key: Schema.String,
          label: Schema.String,
          kind: Schema.Literals(['text', 'number', 'arguments', 'app', 'folder', 'zone']),
          hint: Schema.String,
        }),
      ),
      defaults: Schema.Record(Schema.String, Schema.Unknown),
      schema: Schema.Unknown,
    }),
  ),
  pluginActions: Schema.Array(
    Schema.Struct({
      systemAction: Schema.optionalKey(Schema.String),
      templateId: Schema.optionalKey(Schema.String),
      plugin: Schema.String,
      pluginName: Schema.String,
      id: Schema.String,
      name: Schema.String,
      description: Schema.String,
      schema: Schema.Unknown,
      defaults: Schema.Unknown,
      interaction: Schema.Literals(['press', 'hold']),
      tile: Schema.optional(
        Schema.Struct({
          label: Schema.String,
          icon: KeyFeedback.fields.icon,
          surfaces: Schema.optionalKey(Schema.Array(Schema.Literals(['key', 'lcd']))),
          width: Schema.optionalKey(
            Schema.Int.check(Schema.isBetween({ minimum: 40, maximum: 8192 })),
          ),
        }),
      ),
    }),
  ),
  applications: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
export const Catalogue = Schema.Struct({
  ...CatalogueBase.fields,
  pluginTiles: Schema.optionalKey(CatalogueBase.fields.pluginActions),
});
export type Catalogue = typeof Catalogue.Type;
const BindingStatus = Schema.Literals(['idle', 'running', 'success', 'error']);
export type BindingStatus = typeof BindingStatus.Type;
export const UpdatePlugin = Schema.Struct({
  id: Schema.NonEmptyString,
  enabled: Schema.Boolean,
  expected: Schema.Boolean,
});
export const LcdTap = Schema.Struct({
  dial: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  application: Schema.NonEmptyString,
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export const DialInput = Schema.Struct({
  dial: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  delta: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-20), Schema.isLessThanOrEqualTo(20)),
  application: Schema.NullOr(Schema.String),
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sessionId: Schema.NonEmptyString,
});
const PluginStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  enabled: Schema.Boolean,
  phase: Schema.Literals(['enabled', 'disabled', 'error', 'unsupported']),
  detail: Schema.String,
  keys: Schema.Array(Schema.Int),
  dials: Schema.Array(Schema.Int),
  lcds: Schema.Array(Schema.Int),
});
export const Snapshot = Schema.Struct({
  stateRevision: Schema.optionalKey(Schema.Int),
  lcdLayout: Schema.optionalKey(LcdLayout.View),
  configuration: Configuration,
  discordConnection: PublicConnection,
  plugins: Schema.Struct({ revision: Schema.Int, items: Schema.Array(PluginStatus) }),
  layout: LayoutView,
  sessionId: Schema.String,
  model: Schema.String,
  mock: Schema.Boolean,
  connected: Schema.Boolean,
  connectionError: Schema.NullOr(Schema.String),
  keys: Schema.Array(
    Schema.Struct({
      index: Schema.Int,
      row: Schema.Int,
      column: Schema.Int,
      width: Schema.Int,
      height: Schema.Int,
      id: Schema.NullOr(Schema.String),
      address: Schema.String,
      zone: Schema.String,
      pinned: Schema.Boolean,
      navigation: Schema.Boolean,
      overlay: Schema.optionalKey(
        Schema.UndefinedOr(
          Schema.Struct({ owner: Schema.String, id: Schema.String, name: Schema.String }),
        ),
      ),
      binding: Schema.NullOr(ButtonBinding),
      gestures: Schema.optionalKey(GestureBindings),
      revision: Schema.Int,
      pressed: Schema.Boolean,
      status: BindingStatus,
      detail: Schema.String,
      count: Schema.Int,
      feedback: Schema.NullOr(KeyFeedback),
    }),
  ),
  lcds: Schema.Array(
    Schema.Struct({
      index: Schema.Int,
      width: Schema.Int,
      height: Schema.Int,
      revision: Schema.Int,
      scene: Schema.optionalKey(Schema.UndefinedOr(Schema.Array(Region))),
    }),
  ),
  dials: Schema.Array(
    Schema.Struct({
      index: Schema.Int,
      key: Schema.NullOr(Schema.String),
      interaction: Schema.NullOr(Schema.String),
      cardWidth: Schema.Number,
      name: Schema.NullOr(Schema.String),
      volume: Schema.NullOr(Schema.Number),
      muted: Schema.Boolean,
      pressed: Schema.Boolean,
      rotationSteps: Schema.Int,
      master: Schema.Boolean,
      x: Schema.Number,
      width: Schema.Number,
    }),
  ),
  page: Schema.Int,
  pages: Schema.Int,
  lastEvent: Schema.String,
  inputSequence: Schema.Int,
});
export type Snapshot = typeof Snapshot.Type;
