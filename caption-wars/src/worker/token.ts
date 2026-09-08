// The shared-secret check used by the two operator routes (/api/ai-smoke and
// /api/ai-try).
//
// Both used `header !== env.SMOKE_TOKEN`, which is a length-and-content
// short-circuit: it returns as soon as two bytes differ, so how long it takes
// leaks how much of the token a guess got right. That is defence in depth here
// rather than an open door (both routes are off entirely when the secret is
// unset, and neither touches a room), but a constant-time compare is four lines,
// so there is no reason to keep the shape.
//
// It is written by hand rather than with `crypto.subtle.timingSafeEqual`,
// because that is not in the Workers runtime's SubtleCrypto: the exported
// surface there is digest / encrypt / sign / verify / deriveKey and friends.

/**
 * Compares two secrets without an early exit. The LENGTHS are still compared
 * first (a mismatched length cannot be made constant-time without hashing, and
 * the length of a secret is not the secret), then every byte of the two strings
 * is XORed into one accumulator.
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  const a = String(provided ?? '');
  if (a.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= a.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
