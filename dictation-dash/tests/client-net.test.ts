import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sender, type SendMsg } from '../src/client/sender';
import { timeoutSignal } from '../src/client/timeout';

const msg = (seq: number): SendMsg => ({ kind: 'stroke', race: 1, seq, wordIndex: 0, charIndex: 0, points: [[seq, 0], [seq, 10]] });

function harness(behaviour: (m: SendMsg, attempt: number) => 'ok' | 'fail' | 'refuse') {
  const sent: number[] = [];
  const attempts = new Map<number, number>();
  const drained: boolean[] = [];
  const sender = new Sender<number>({
    send: async (m) => {
      const n = (attempts.get(m.seq) ?? 0) + 1;
      attempts.set(m.seq, n);
      const b = behaviour(m, n);
      if (b === 'ok') return m.seq;
      throw Object.assign(new Error(b), { retry: b === 'fail' });
    },
    sleep: async () => {},
    backoffMs: [300, 800, 1500],
    isRetryable: (e) => (e as { retry?: boolean }).retry === true,
    onSent: (seq) => sent.push(seq),
    onDrained: (gaveUp) => drained.push(gaveUp),
  });
  return { sender, sent, attempts, drained };
}

describe('Sender', () => {
  it('sends in order and retries a flaky stroke', async () => {
    const h = harness((m, n) => (m.seq === 2 && n < 3 ? 'fail' : 'ok'));
    await Promise.all([1, 2, 3].map((s) => h.sender.enqueue(msg(s))));
    expect(h.sent).toEqual([1, 2, 3]);
    expect(h.attempts.get(2)).toBe(3);
    expect(h.drained.at(-1)).toBe(false);
  });

  it('after a give-up, the queued strokes are skipped and the page is told to resync', async () => {
    let down = true;
    const h = harness(() => (down ? 'fail' : 'ok'));
    await Promise.all([1, 2, 3].map((s) => h.sender.enqueue(msg(s))));
    expect(h.attempts.get(1)).toBe(4); // first try + 3 retries
    expect(h.attempts.has(2)).toBe(false); // skipped, never sent
    expect(h.attempts.has(3)).toBe(false);
    expect(h.drained).toEqual([true]);
    // Network back, but the flag holds until the page reconciles and resets it.
    down = false;
    await h.sender.enqueue(msg(4));
    expect(h.attempts.has(4)).toBe(false);
    h.sender.reset();
    await h.sender.enqueue(msg(5));
    expect(h.sent).toEqual([5]);
    expect(h.drained.at(-1)).toBe(false);
  });

  it('a refusal gives up at once, without retries', async () => {
    const h = harness(() => 'refuse');
    await h.sender.enqueue(msg(1));
    expect(h.attempts.get(1)).toBe(1);
    expect(h.drained).toEqual([true]);
  });
});

describe('timeoutSignal', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('works without AbortSignal.timeout (old Safari and Chrome)', async () => {
    const Original = AbortSignal;
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, { timeout: undefined, prototype: Original.prototype }));
    const signal = timeoutSignal(10);
    expect(signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
  });
});
