import { Cause } from 'effect';

/** User-facing domain messages; detailed stack traces belong to terminal diagnostics. */
export const failureMessage = (cause: Cause.Cause<unknown>) => {
  const messages = cause.reasons.flatMap((reason) => {
    const value = Cause.isFailReason(reason)
      ? reason.error
      : Cause.isDieReason(reason)
        ? reason.defect
        : undefined;
    return value instanceof Error ? [value.message] : typeof value === 'string' ? [value] : [];
  });
  return (
    [...new Set(messages)].join('\n').slice(-4096) || 'Action interrompue ou plugin désactivé.'
  );
};
