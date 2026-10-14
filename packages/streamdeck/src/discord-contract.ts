import { Schema } from 'effect';

/** Register this exact loopback URI in the application's OAuth2 Redirects. */
export const RedirectUri = 'http://127.0.0.1:3900/';

export const AppInput = Schema.Struct({
  clientId: Schema.String.check(Schema.isPattern(/^\d{6,25}$/)),
  clientSecret: Schema.optional(Schema.NonEmptyString.check(Schema.isMaxLength(1024))),
});
export const PublicConnection = Schema.Struct({
  clientId: Schema.String,
  configured: Schema.Boolean,
  authorized: Schema.Boolean,
});
