import { Data } from 'effect';

export class StreamDeckError extends Data.TaggedError('StreamDeckError')<{
  readonly reason:
    | 'Driver'
    | 'NotFound'
    | 'Ambiguous'
    | 'Unsupported'
    | 'InvalidArgument'
    | 'Closed'
    | 'Overflow'
    | 'AlreadyOpen';
  readonly operation: string;
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export const invalid = (operation: string, message: string) =>
  new StreamDeckError({ reason: 'InvalidArgument', operation, message });

/** Check internal invariants after domain validation instead of erasing nullability with `!`. */
export const invariant = <A>(value: A, operation: string): NonNullable<A> => {
  if (value === undefined || value === null)
    throw invalid(operation, 'Required value is missing after validation.');
  return value;
};
