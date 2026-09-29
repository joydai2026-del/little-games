// One clock for the whole hub so tests can move time without fake timers.
let override: (() => number) | null = null;
export function now(): number {
  return override ? override() : Date.now();
}
/** Tests only. */
export function setClock(fn: (() => number) | null): void {
  override = fn;
}
