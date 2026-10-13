import { Data } from 'effect';

export class StreamDeckError extends Data.TaggedError('StreamDeckError')<{
  readonly reason: 'Driver' | 'NotFound' | 'Ambiguous' | 'Unsupported' | 'InvalidArgument' | 'Closed' | 'Overflow' | 'AlreadyOpen';
  readonly operation: string;
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export const invalid = (operation: string, message: string) => new StreamDeckError({ reason: 'InvalidArgument', operation, message });
