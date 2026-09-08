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
import type { CaptionView } from '../src/client/contract';

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
