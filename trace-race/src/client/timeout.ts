// A deadline signal that also works where AbortSignal.timeout does not exist
// (Safari before 16, Chrome before 103: older school iPads).
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('The request timed out', 'TimeoutError')), ms);
  return controller.signal;
}
