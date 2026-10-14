import { Data } from 'effect';
/** Shared by the layout/action engine and command plugin, without a dependency cycle. */
export class StudioError extends Data.TaggedError('StudioError')<{ readonly message: string; readonly status: number }> {}
