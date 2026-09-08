// The three decisions the room shell and its phase screens make on every poll,
// pulled out as pure functions with no DOM in them.
//
// They live here for one reason: all three were wrong at once, and none of them
// was testable. A phone that slept through a round came back to a caption
// screen that still said "Sent. Waiting for the others." from the PREVIOUS
// round, with no way out but a page reload. The bug was a per-round flag kept
// in a screen's closure, only ever set and never cleared, in a screen the shell
// only rebuilt when the PHASE changed (caption -> caption across a round
// boundary is not a phase change).
//
// So: the shell rebuilds on phase OR round, and each per-round flag is DERIVED
// from the view on every update instead of remembered. Both rules are here, and
// tests/client-screens.test.ts drives them without a browser.

import type { CaptionView, Phase } from '../contract';

/** What the shell currently has on stage. Null before the first paint. */
export interface ShownScreen {
  phase: Phase;
  round: number;
}

/**
 * True when the phase screen must be thrown away and rebuilt.
 *
 * Round matters as much as phase: caption(round 1) and caption(round 2) are the
 * same phase and a completely different screen. `hasScreen` covers the first
 * paint and a screen the shell dropped (the name gate).
 */
export function shouldRebuildScreen(
  shown: ShownScreen | null,
  view: { phase: Phase; round: number },
  hasScreen: boolean
): boolean {
  if (!hasScreen || shown === null) return true;
  return shown.phase !== view.phase || shown.round !== view.round;
}

/**
 * Whether this player's caption for the CURRENT round is in, according to the
 * server. Belt and braces next to the rebuild above: derived every update, so a
 * stale `true` can never survive into a new round.
 *
 * During `caption` the server sends the viewer only their own caption, and
 * marks it either with `playerId` or with `isOwn`.
 */
export function captionIsIn(captions: CaptionView[], playerId: string): boolean {
  return captions.some((c) => c.isOwn === true || (playerId !== '' && c.playerId === playerId));
}

/**
 * The caption id this player voted for this round, or null.
 *
 * The live ballot is secret during `vote`, so the server sends the viewer's own
 * pick as `yourVote`. A missing or empty value means "no vote yet" and must
 * CLEAR the local choice, not leave the previous round's card highlighted.
 */
export function voteChoice(yourVote: string | null | undefined): string | null {
  return typeof yourVote === 'string' && yourVote.length > 0 ? yourVote : null;
}
