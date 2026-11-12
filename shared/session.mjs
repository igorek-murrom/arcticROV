// Pure helpers used by the browser and by race-condition regression tests.
export function ownsControl(state, connected = true) {
  return !!(connected && state?.me && state?.epoch && state.owner?.id === state.me);
}
export function acceptsState(current, next) {
  if (!next?.me || typeof next.stationId !== 'string' || !Number.isSafeInteger(next.stateSeq)) return false;
  return !current || current.stationId !== next.stationId || (current.me === next.me && next.stateSeq > current.stateSeq);
}
export function commandContext(state, seq) {
  return { seq, epoch: state.epoch, safetyEpoch: state.safetyEpoch, issuedAt: state.serverTime };
}
