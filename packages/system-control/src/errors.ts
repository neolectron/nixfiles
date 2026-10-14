import { Data } from 'effect';

export class IntegrationError extends Data.TaggedError('IntegrationError')<{
  readonly message: string;
}> {}

export const invariant = <A>(value: A, operation: string): NonNullable<A> => {
  if (value === undefined || value === null)
    throw new IntegrationError({
      message: `${operation}: required value missing after validation.`,
    });
  return value;
};
