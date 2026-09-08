// The shared-secret check used by the two operator routes (/api/ai-smoke and
// /api/ai-try).
//
// Both used `header !== env.SMOKE_TOKEN`, which is a length-and-content
// short-circuit: it returns as soon as two bytes differ, so how long it takes
// leaks how much of the token a guess got right. That is defence in depth here
// rather than an open door (both routes are off entirely when the secret is
// unset, and neither touches a room), but a constant-time compare is a few
// lines, so there is no reason to keep the shape.
//
// ROUND 6 (Codex should-fix 1): it compares DIGESTS, not the strings. Round 5's
// version compared lengths first and returned immediately when they differed, so
// it was constant-time only among same-length guesses and the token's LENGTH was
// still timing-visible. Hashing both sides to a fixed 32 bytes removes the last
// input-dependent branch: every call now does exactly two SHA-256 digests and
// one 32-byte XOR loop, whatever was sent.
//
// It is written by hand rather than with `crypto.subtle.timingSafeEqual`,
// because that is not in the Workers runtime's SubtleCrypto: the exported
// surface there is digest / encrypt / sign / verify / deriveKey and friends.
// `crypto.subtle.digest` IS there, and in Node 18+, which is why the tests can
// drive this file directly.

const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/**
 * Compares two secrets in time that does not depend on either one.
 *
 * Both sides are hashed to a fixed-length digest and every byte of the two
 * digests is XORed into one accumulator. Equal digests mean equal inputs (that
 * is what collision resistance buys), and a wrong LENGTH now costs exactly as
 * much as a wrong byte.
 */
export async function secretsMatch(
  provided: string | null | undefined,
  expected: string
): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(String(provided ?? '')), sha256(expected)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
