// The screen-lifecycle decisions (src/client/screens/lifecycle.ts).
//
// These three functions are the fix for the round-2 must-fix: a phone that
// slept through a round came back to a caption screen still saying "Sent.
// Waiting for the others." from the PREVIOUS round, with no way out but a page
// reload. Testing them needs no DOM, which is the whole point of pulling them
// out of the screens: the screens themselves (real elements, real events) are
// still untested here and remain grade C until a browser drives them.

import { describe, expect, it } from 'vitest';
import {
  captionIsIn,
  shouldRebuildScreen,
  voteChoice,
} from '../src/client/screens/lifecycle';
import type { CaptionView, RoomView } from '../src/client/contract';

describe('shouldRebuildScreen', () => {
  it('builds the first screen', () => {
    expect(shouldRebuildScreen(null, { phase: 'lobby', round: 0 }, false)).toBe(true);
  });

  it('rebuilds when the phase changes', () => {
    expect(
      shouldRebuildScreen({ phase: 'caption', round: 1 }, { phase: 'vote', round: 1 }, true)
    ).toBe(true);
  });

  it('rebuilds when only the ROUND changes: the bug this exists for', () => {
    // caption(round 1) -> caption(round 2) is the same phase and a completely
    // different screen. A phone that slept through vote + reveal lands here.
    expect(
      shouldRebuildScreen({ phase: 'caption', round: 1 }, { phase: 'caption', round: 2 }, true)
    ).toBe(true);
    expect(
      shouldRebuildScreen({ phase: 'vote', round: 3 }, { phase: 'vote', round: 4 }, true)
    ).toBe(true);
  });

  it('keeps the screen when nothing that matters changed', () => {
    expect(
      shouldRebuildScreen({ phase: 'caption', round: 2 }, { phase: 'caption', round: 2 }, true)
    ).toBe(false);
  });

  it('rebuilds when the shell has no screen on stage, even if the state matches', () => {
    expect(
      shouldRebuildScreen({ phase: 'caption', round: 2 }, { phase: 'caption', round: 2 }, false)
    ).toBe(true);
  });
});

describe('captionIsIn', () => {
  const mine: CaptionView = { id: 'c1', text: 'mine', playerId: 'p1' };
  const flagged: CaptionView = { id: 'c2', text: 'mine', isOwn: true };
  const theirs: CaptionView = { id: 'c3', text: 'theirs', playerId: 'p2' };

  it('reads the server, both ways it marks a caption as ours', () => {
    expect(captionIsIn([mine], 'p1')).toBe(true);
    expect(captionIsIn([flagged], 'p1')).toBe(true);
  });

  it('is false when only other players have captioned', () => {
    expect(captionIsIn([theirs], 'p1')).toBe(false);
  });

  it('is false for an empty round, which is what clears the flag on a rollover', () => {
    expect(captionIsIn([], 'p1')).toBe(false);
  });

  it('never matches on an empty viewer id', () => {
    expect(captionIsIn([{ id: 'c4', text: 'x' }], '')).toBe(false);
  });
});

describe('voteChoice', () => {
  it('takes the vote the server recorded', () => {
    expect(voteChoice('cap-7')).toBe('cap-7');
  });

  it('CLEARS on a null, empty or missing vote (the round-rollover case)', () => {
    expect(voteChoice(null)).toBeNull();
    expect(voteChoice(undefined)).toBeNull();
    expect(voteChoice('')).toBeNull();
  });
});

// --- the photo frame, on a hand-rolled DOM ---------------------------------
//
// Codex review round 5, should-fix 2. The `<img>` hang fallback (round 4) was
// source-correct and completely untested: an image that fires NEITHER `load` nor
// `error` is the one case the API deadline cannot cover, and it is also the one
// case a fake DOM can drive exactly, because "nothing happens" is easy to
// simulate and impossible to observe by reading. About sixty lines of fakes,
// the same trick tests/client-poll.test.ts uses for the poll loop.

interface FakeTimer {
  id: number;
  fn: () => void;
}

interface FakeEl {
  tagName: string;
  className: string;
  textContent: string;
  alt?: string;
  src?: string;
  children: FakeEl[];
  classes: Set<string>;
  classList: {
    add(name: string): void;
    remove(name: string): void;
    contains(name: string): boolean;
    toggle(name: string, on?: boolean): void;
  };
  listeners: Map<string, Array<() => void>>;
  addEventListener(type: string, fn: () => void): void;
  append(...children: Array<FakeEl | string>): void;
  replaceChildren(...children: Array<FakeEl | string>): void;
  setAttribute(key: string, value: string): void;
  fire(type: string): void;
  /** Every text node under this element, joined. What a player would read. */
  text(): string;
  disabled?: boolean;
  hidden?: boolean;
}

function fakeElement(tag: string): FakeEl {
  const classes = new Set<string>();
  const listeners = new Map<string, Array<() => void>>();
  const el: FakeEl = {
    tagName: tag,
    className: '',
    textContent: '',
    children: [],
    classes,
    classList: {
      add: (n) => void classes.add(n),
      remove: (n) => void classes.delete(n),
      contains: (n) => classes.has(n),
      toggle: (n, on) => void (on ?? !classes.has(n) ? classes.add(n) : classes.delete(n)),
    },
    listeners,
    addEventListener: (type, fn) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    append: (...children) => {
      for (const child of children) {
        if (typeof child !== 'string') el.children.push(child);
      }
    },
    replaceChildren: (...children) => {
      el.children.length = 0;
      el.append(...children);
    },
    text: () => [el.textContent, ...el.children.map((c) => c.text())].join(' ').trim(),
    setAttribute: () => {},
    fire: (type) => {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
  };
  return el;
}

/** document.createElement + window.setTimeout/clearTimeout, and nothing else. */
function installFakeDom(): {
  restore(): void;
  timers: FakeTimer[];
  runTimers(): void;
} {
  const timers: FakeTimer[] = [];
  let nextId = 1;
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document };
  g.window = {
    setTimeout: (fn: () => void) => {
      const id = nextId++;
      timers.push({ id, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  g.document = {
    createElement: (tag: string) => fakeElement(tag),
    createTextNode: (text: string) => text,
  };
  return {
    timers,
    restore() {
      g.window = saved.window;
      g.document = saved.document;
    },
    runTimers() {
      for (const timer of timers.splice(0)) timer.fn();
    },
  };
}

describe('photoFrame: an <img> that never answers', () => {
  const ctx = {
    code: 'ABCD',
    playerId: 'p1',
    ownCaptionId: () => null,
    actions: {} as never,
  };
  const view = {
    round: 2,
    photo: { round: 2, source: 'loremflickr', sha256: 'a'.repeat(64), bytes: 100 },
  } as unknown as RoomView;

  it('says so once the hang timer fires, and clears the timer on destroy', async () => {
    const dom = installFakeDom();
    try {
      const { photoFrame } = await import('../src/client/screens/common');
      const frame = photoFrame(ctx as never, 'big');
      const [img, fallback] = (frame.el as unknown as FakeEl).children;

      frame.set(view);
      expect(fallback.textContent).toBe('The photo is on its way.');
      expect(img.src).toBe('/api/rooms/ABCD/photo/2');
      expect(dom.timers).toHaveLength(1);

      // Neither `load` nor `error` ever fires. This is the whole bug.
      dom.runTimers();
      expect(fallback.textContent).toBe('The photo did not load. The captions still count.');
      expect((frame.el as unknown as FakeEl).classList.contains('photo-broken')).toBe(true);

      // And the timer for a NEW round is cleared when the screen goes away, so a
      // destroyed screen cannot repaint a live one.
      frame.set({ ...view, round: 3, photo: { ...view.photo!, round: 3 } } as RoomView);
      expect(dom.timers).toHaveLength(1);
      frame.destroy();
      expect(dom.timers).toHaveLength(0);
    } finally {
      dom.restore();
    }
  });

  it('a photo that loads clears the hang timer and the message', async () => {
    const dom = installFakeDom();
    try {
      const { photoFrame } = await import('../src/client/screens/common');
      const frame = photoFrame(ctx as never, 'small');
      const [img, fallback] = (frame.el as unknown as FakeEl).children;

      frame.set(view);
      img.fire('load');

      expect(fallback.textContent).toBe('');
      expect(dom.timers).toHaveLength(0);
      dom.runTimers(); // nothing left to fire
      expect(fallback.textContent).toBe('');
    } finally {
      dom.restore();
    }
  });

  it('an <img> that errors says the same thing as one that hangs', async () => {
    const dom = installFakeDom();
    try {
      const { photoFrame } = await import('../src/client/screens/common');
      const frame = photoFrame(ctx as never, 'big');
      const [img, fallback] = (frame.el as unknown as FakeEl).children;

      frame.set(view);
      img.fire('error');

      expect(fallback.textContent).toBe('The photo did not load. The captions still count.');
      expect(dom.timers).toHaveLength(0);
    } finally {
      dom.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// THE CHAMPION SCREEN (review round 7, must-fixes 1 and 2)
//
// `done.ts` had no test until now, which is how both of this round's must-fixes
// reached a live game: the "No champion this time." branch had been written
// since round 2 and was UNREACHABLE, and three live games in a row crowned two
// silent bots as joint champions on 0 points. These read the strings a player
// actually sees off a rendered screen rather than off the source.
// ---------------------------------------------------------------------------

describe('the done screen says what actually happened', () => {
  const ctx = {
    code: 'ABCD',
    playerId: 'p1',
    ownCaptionId: () => null,
    actions: { playAgain: () => Promise.resolve(true) } as never,
  };

  const baseView = {
    code: 'ABCD',
    phase: 'done',
    round: 2,
    options: { rounds: 2, captionSeconds: 60, voteSeconds: 30, revealSeconds: 10, botCount: 2 },
    hostId: 'p1',
    players: [
      { id: 'p1', name: 'JJ', isBot: false, score: 0 },
      { id: 'b1', name: 'Daisy Deadpan', isBot: true, score: 0 },
      { id: 'b2', name: 'Chaos Chip', isBot: true, score: 0 },
    ],
    captions: [],
    votes: {},
    history: [],
    nextPollMs: 0,
  } as unknown as RoomView;

  async function render(view: RoomView): Promise<{ text: string; restore: () => void }> {
    const dom = installFakeDom();
    const { createDoneScreen } = await import('../src/client/screens/done');
    const screen = createDoneScreen(ctx as never);
    screen.update(view);
    return { text: (screen.el as unknown as FakeEl).text(), restore: dom.restore };
  }

  it('names NOBODY when every score is 0, instead of crowning everyone', async () => {
    // Must-fix 2. Before the zero guard in computeChampionIds this screen read
    // "Joint champions: JJ and Daisy Deadpan and Chaos Chip / 0 points over 2
    // rounds." on a live game where the two bots never wrote a word.
    const { text, restore } = await render({ ...baseView, championIds: [] });
    try {
      expect(text).toContain('Game over');
      expect(text).toContain('No champion this time.');
      expect(text).not.toContain('champions:');
    } finally {
      restore();
    }
  });

  it('still crowns a real winner', async () => {
    const view = {
      ...baseView,
      players: [{ id: 'p1', name: 'JJ', isBot: false, score: 3 }, ...baseView.players.slice(1)],
      championIds: ['p1'],
    } as unknown as RoomView;
    const { text, restore } = await render(view);
    try {
      expect(text).toContain('Champion: JJ');
      expect(text).toContain('3 points over 2 rounds.');
    } finally {
      restore();
    }
  });

  it('explains the AI allowance in plain words, and says what to do about it', async () => {
    // Must-fix 1, the solo-host end of it: the bots met the daily free allowance
    // and there were not two players left without them.
    const view = { ...baseView, championIds: [], endedReason: 'ai-unavailable' } as RoomView;
    const { text, restore } = await render(view);
    try {
      expect(text).toContain('The AI players are offline today');
      expect(text).toContain('daily free AI allowance is used up');
      expect(text).toContain('back when the daily allowance resets');
      // Round 8, should-fix 5: no promise the code has never watched itself keep.
      expect(text).not.toContain('midnight');
      expect(text).toContain('Add a friend to play.');
      // No neurons, no error code, no plan tier: grandma reads this screen.
      expect(text).not.toContain('4006');
      expect(text).not.toContain('neuron');
    } finally {
      restore();
    }
  });

  it('marks the AI players offline on the final scoreboard instead of hiding them', async () => {
    const view = { ...baseView, aiOffline: true, championIds: [] } as unknown as RoomView;
    const { text, restore } = await render(view);
    try {
      expect(text).toContain('Daisy Deadpan');
      expect(text).toContain('offline');
    } finally {
      restore();
    }
  });

  it('says nothing about the AI while it is working', async () => {
    const { text, restore } = await render({ ...baseView, championIds: [] });
    try {
      expect(text).not.toContain('offline');
    } finally {
      restore();
    }
  });
});
