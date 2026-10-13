import { Schema } from 'effect';

const shortText = Schema.String.check(Schema.isMaxLength(80));
const argument = Schema.String.check(Schema.isMaxLength(4096));
export const actionParameters = {
  'launch-app': Schema.Struct({ application: Schema.NonEmptyString.annotate({ title: 'Application' }) }),
  'run-command': Schema.Struct({
    executable: Schema.NonEmptyString.check(Schema.isMaxLength(1024)).annotate({ title: 'Exécutable ou script' }),
    arguments: Schema.Array(argument).annotate({ title: 'Arguments' }),
    directory: Schema.String.check(Schema.isMaxLength(4096)).annotate({ title: 'Dossier de travail' }),
  }),
  counter: Schema.Struct({ start: Schema.Int.check(Schema.isBetween({ minimum: -9999, maximum: 9999 })).annotate({ title: 'Valeur de départ' }) }),
} as const;
export const ButtonBinding = Schema.Union([
  Schema.Struct({ label: shortText, action: Schema.Literal('launch-app'), parameters: actionParameters['launch-app'] }),
  Schema.Struct({ label: shortText, action: Schema.Literal('run-command'), parameters: actionParameters['run-command'] }),
  Schema.Struct({ label: shortText, action: Schema.Literal('counter'), parameters: actionParameters.counter }),
]);
export type ButtonBinding = typeof ButtonBinding.Type;
export type ActionId = ButtonBinding['action'];
export const Profile = Schema.Struct({ version: Schema.Literal(1), buttons: Schema.Record(Schema.String, ButtonBinding) });
export type Profile = typeof Profile.Type;
export const UpdateBinding = Schema.Struct({ key: Schema.Int, binding: Schema.NullOr(ButtonBinding), expected: Schema.optional(Schema.NullOr(ButtonBinding)) });
export const Trigger = Schema.Struct({ key: Schema.Int });

export interface ApplicationEntry { readonly id: string; readonly name: string; readonly file: string }
export interface ActionField { readonly key: string; readonly label: string; readonly kind: 'text' | 'number' | 'arguments' | 'app'; readonly hint: string }
export interface ActionDefinition {
  readonly id: ActionId; readonly name: string; readonly description: string;
  readonly fields: ReadonlyArray<ActionField>; readonly defaults: ButtonBinding['parameters']; readonly schema: unknown;
}
export const Catalogue = Schema.Struct({
  actions: Schema.Array(Schema.Struct({ id: Schema.Literals(['launch-app', 'run-command', 'counter']), name: Schema.String, description: Schema.String,
    fields: Schema.Array(Schema.Struct({ key: Schema.String, label: Schema.String, kind: Schema.Literals(['text', 'number', 'arguments', 'app']), hint: Schema.String })),
    defaults: Schema.Record(Schema.String, Schema.Unknown), schema: Schema.Unknown,
  })),
  applications: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
export type Catalogue = typeof Catalogue.Type;
const BindingStatus = Schema.Literals(['idle', 'running', 'success', 'error']);
export type BindingStatus = typeof BindingStatus.Type;
export const Snapshot = Schema.Struct({
  sessionId: Schema.String, model: Schema.String, mock: Schema.Boolean,
  keys: Schema.Array(Schema.Struct({
    index: Schema.Int, row: Schema.Int, column: Schema.Int, width: Schema.Int, height: Schema.Int,
    binding: Schema.NullOr(ButtonBinding), revision: Schema.Int, pressed: Schema.Boolean,
    status: BindingStatus, detail: Schema.String, count: Schema.Int,
  })),
  lcds: Schema.Array(Schema.Struct({ index: Schema.Int, width: Schema.Int, height: Schema.Int, revision: Schema.Int })),
  dials: Schema.Array(Schema.Struct({ index: Schema.Int, name: Schema.NullOr(Schema.String), volume: Schema.NullOr(Schema.Number), muted: Schema.Boolean, master: Schema.Boolean, x: Schema.Number, width: Schema.Number })),
  page: Schema.Int, pages: Schema.Int, lastEvent: Schema.String, inputSequence: Schema.Int,
});
export type Snapshot = typeof Snapshot.Type;
