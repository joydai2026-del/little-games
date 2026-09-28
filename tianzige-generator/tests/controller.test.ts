// Regression for review round 2: Print re-enabled for a stale sheet when a slow
// stroke fetch finished during the next keystroke's debounce.

import { describe, expect, it } from 'vitest';
import { createController, emptyMessage, type View } from '../src/client/controller';
import { DEFAULT_OPTIONS, type SheetSpec } from '../src/shared/config';
import { parseChars } from '../src/shared/parse';
import { readStrokes } from '../src/shared/strokes';
import da from './fixtures/大.json';
import xue from './fixtures/学.json';

const REAL: Record<string, unknown> = { 大: da, 学: xue };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  let text = '';
  const pending = new Map<string, ReturnType<typeof deferred<string[] | null>>>();
  const printLog: Array<{ enabled: boolean; text: string; committed: string }> = [];
  let committed = '';
  let timerFn: (() => void) | null = null;
  const view: View = {
    readSpec: (): SheetSpec => ({ version: 1, chars: text, options: DEFAULT_OPTIONS }),
    strokesFor: (c) => {
      const d = deferred<string[] | null>();
      pending.set(`${c}#${pending.size}`, d);
      return d.promise;
    },
    setPrintEnabled: (enabled) => printLog.push({ enabled, text, committed }),
    setLoading: () => {},
    say: () => {},
    commit: (sheet) => {
      committed = sheet ? sheet.pages.flatMap((p) => p.blocks.filter((b) => b.isReference).map((b) => b.char)).join('') : '';
    },
    setTimer: (fn) => {
      timerFn = fn;
      return 1;
    },
    clearTimer: () => {
      timerFn = null;
    },
  };
  const release = (key: string) => {
    for (const [k, d] of pending) if (k.startsWith(`${key}#`)) {
      d.resolve(readStrokes(REAL[key]));
      pending.delete(k);
    }
  };
  return {
    view,
    printLog,
    type: (t: string) => (text = t),
    fireTimer: () => timerFn?.(),
    release,
    committed: () => committed,
  };
}

describe('Print is never enabled for a stale sheet', () => {
  it('a slow fetch finishing during the next debounce does not re-enable Print', async () => {
    const h = harness();
    const c = createController(h.view, 200);
    h.type('大');
    const first = c.render(); // fetch for 大 is now in flight
    h.type('大 学');
    c.schedule(); // keystroke: debounce armed, old render must be dead now
    h.release('大'); // old fetch lands inside the debounce window
    await first;
    await flush();
    // Nothing may have enabled Print while the box says 大 学 and the sheet says 大.
    expect(h.printLog.filter((e) => e.enabled)).toEqual([]);
    h.fireTimer(); // debounce ends, the real render starts
    await flush();
    h.release('大');
    h.release('学');
    await flush();
    await flush();
    const enables = h.printLog.filter((e) => e.enabled);
    expect(enables.length).toBe(1);
    expect(h.committed()).toBe('大学');
    // Every enable happened with the sheet matching the box.
    for (const e of enables) expect(parseChars(e.text).chars.join('')).toBe('大学');
  });

  it('an option change while a render is loading also kills the old render', async () => {
    const h = harness();
    const c = createController(h.view, 200);
    h.type('大');
    const first = c.render();
    const second = c.render(); // option change
    h.release('大');
    await Promise.all([first, second]);
    await flush();
    expect(h.printLog.filter((e) => e.enabled).length).toBe(1);
  });
});

describe('emptyMessage', () => {
  it('names the skipped headings when nothing else is left', () => {
    const parsed = parseChars('第三课');
    expect(emptyMessage('第三课', parsed)).toContain('I skipped these headings: 第三课');
  });
});
