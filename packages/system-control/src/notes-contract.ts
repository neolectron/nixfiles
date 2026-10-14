import { Schema } from 'effect';

export const Id = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,63}$/));
export const Note = Schema.Struct({
  id: Id,
  title: Schema.NonEmptyString.check(Schema.isMaxLength(160)),
  body: Schema.String.check(Schema.isMaxLength(64000)),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type Note = typeof Note.Type;
export const Update = Schema.Struct({
  id: Id,
  title: Note.fields.title,
  body: Note.fields.body,
  expectedRevision: Note.fields.revision,
});
export const appendText = (body: string, text: string) =>
  !text.trim() ? body : `${body}${body && !body.endsWith('\n') ? '\n' : ''}${text.trim()}`;
