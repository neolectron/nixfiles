/** Pure playback clock, shared by MPRIS bindings and browser presentation. */
export interface Sample {
  readonly status: 'Playing' | 'Paused' | 'Stopped';
  readonly positionMicros: number | null;
  readonly sampledAt: number;
  readonly rate: number;
  readonly durationMicros: number | null;
}
export const positionAt = (state: Sample, now: number) => {
  if (state.positionMicros === null) return null;
  const value =
    state.positionMicros +
    (state.status === 'Playing' ? Math.max(0, now - state.sampledAt) * 1000 * state.rate : 0);
  return Math.max(0, state.durationMicros === null ? value : Math.min(value, state.durationMicros));
};
