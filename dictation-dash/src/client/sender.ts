// The kid's outbox: sends strokes and skips in order, one at a time, retrying
// with back-off. No DOM here, so it is unit-tested with a fake network.
//
// Rules:
//   - Retry only what might succeed later (network error, timeout, 429, 5xx).
//   - A refusal, or running out of retries, is a GIVE-UP: every stroke still
//     queued behind it is skipped (the room is behind them, they would only be
//     refused) and `onDrained(true)` asks the page for a full resync.
//   - The give-up flag is cleared only by `reset()`, which the page calls once
//     a full state read has reconciled the pad with the room.

export type SendMsg =
  | { kind: 'stroke'; race: number; seq: number; wordIndex: number; charIndex: number; strokeIndex: number; result: 'correct' | 'mistake' }
  | { kind: 'skip'; race: number; seq: number; wordIndex: number };

export interface SenderDeps<T> {
  send(msg: SendMsg): Promise<T>;
  sleep(ms: number): Promise<void>;
  backoffMs: readonly number[];
  isRetryable(err: unknown): boolean;
  onSent(answer: T): void;
  /** Called when the outbox empties. `gaveUp` = at least one stroke did not land. */
  onDrained(gaveUp: boolean): void;
}

export class Sender<T> {
  pending = 0;
  gaveUp = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SenderDeps<T>) {}

  enqueue(msg: SendMsg): Promise<void> {
    this.pending += 1;
    this.queue = this.queue.then(async () => {
      try {
        if (this.gaveUp) return;
        const waits = this.deps.backoffMs;
        for (let attempt = 0; attempt <= waits.length; attempt++) {
          try {
            this.deps.onSent(await this.deps.send(msg));
            return;
          } catch (err) {
            if (!this.deps.isRetryable(err) || attempt === waits.length) {
              this.gaveUp = true;
              return;
            }
            await this.deps.sleep(waits[attempt]);
          }
        }
      } finally {
        this.pending -= 1;
        if (this.pending === 0) this.deps.onDrained(this.gaveUp);
      }
    });
    return this.queue;
  }

  /** The pad and the room agree again: stop skipping. */
  reset(): void {
    this.gaveUp = false;
  }
}
