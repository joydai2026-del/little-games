// Pieces every in-room screen shares: the contract between the room shell
// (which owns polling) and one phase screen, plus the photo frame, the
// countdown pill, the player list and the scoreboard.

import { photoUrl } from '../api';
import type { RoomView } from '../contract';
import { countdownSeconds } from '../poll';
import { serverNow } from '../state';
import { h } from '../ui';

/**
 * What a phase screen can ask the room shell to do.
 *
 * EVERY action resolves to a boolean, and false always means the same thing:
 * "that did not happen, put your button back". A button that disables itself on
 * tap and waits for a poll to re-enable it is a dead end whenever the poll
 * answers `unchanged` (a quiet lobby, or a finished game that has stopped
 * polling entirely), which is exactly when a first tap is most likely to fail.
 */
export interface RoomActions {
  /** Resolves false when the game could not be started, so the button can come back to life. */
  start(): Promise<boolean>;
  sendCaption(text: string): Promise<boolean>;
  sendVote(captionId: string): Promise<boolean>;
  /** Resolves false when the move-on failed, so the button can come back to life. */
  next(): Promise<boolean>;
  /** Resolves false when the new room could not be made; true means we are navigating away. */
  playAgain(): Promise<boolean>;
}

export interface RoomCtx {
  code: string;
  playerId: string;
  /**
   * The id of this player's caption for the current round, remembered by the
   * shell when it was submitted. During `vote` the server hides authors, so
   * this is how a screen knows which card is "yours".
   */
  ownCaptionId(): string | null;
  actions: RoomActions;
}

/** One phase of the game, owned by the room shell. */
export interface PhaseScreen {
  el: HTMLElement;
  /** Fresh state arrived. */
  update(view: RoomView): void;
  /** Once a second, with the milliseconds left on the phase. */
  tick(msLeft: number): void;
  destroy(): void;
}

export function isHost(view: RoomView, playerId: string): boolean {
  return view.hostId === playerId;
}

/**
 * Milliseconds until the server will try the photo host again, or 0 when
 * nothing is backing off.
 *
 * Both image hosts being down at a rollover is answered with a 200 carrying the
 * UNCHANGED state, so a host tapping Start or Next in that window saw their
 * button come straight back and nothing happen. On the third failure the backoff
 * is 60 seconds. This is what lets both buttons say so.
 */
export function photoWaitMs(view: RoomView | null): number {
  if (!view || typeof view.photoRetryAt !== 'number') return 0;
  return Math.max(0, view.photoRetryAt - serverNow());
}

/**
 * True when this player is watching a round they are not in: the roster was
 * frozen when the round started and they joined after it. Absent roster (an
 * older server) means everybody plays.
 */
export function isSpectator(view: RoomView, playerId: string): boolean {
  if (view.phase === 'lobby' || view.phase === 'done') return false;
  const roster = view.roundPlayerIds;
  if (!Array.isArray(roster) || roster.length === 0) return false;
  return !roster.includes(playerId);
}

export function playerName(view: RoomView, playerId: string | undefined): string {
  if (!playerId) return 'Someone';
  return view.players.find((p) => p.id === playerId)?.name ?? 'Someone';
}

export function isBot(view: RoomView, playerId: string | undefined): boolean {
  if (!playerId) return false;
  return view.players.find((p) => p.id === playerId)?.isBot === true;
}

/** How many of this round's players are humans plus bots. */
export function rosterSize(view: RoomView): number {
  const roster = view.roundPlayerIds;
  if (Array.isArray(roster) && roster.length > 0) return roster.length;
  return view.players.length;
}

/** The big seconds-left pill. Returns a setter the shell calls every second. */
export function countdown(): { el: HTMLElement; set(msLeft: number): void } {
  const value = h('span', { class: 'countdown-value', text: '--' });
  const el = h('div', { class: 'countdown', role: 'timer' }, [
    value,
    h('span', { class: 'countdown-unit', text: 'seconds left' }),
  ]);
  return {
    el,
    set(msLeft: number) {
      const seconds = countdownSeconds(msLeft);
      value.textContent = String(seconds);
      el.classList.toggle('countdown-urgent', seconds <= 10);
    },
  };
}

/**
 * How long "The photo is on its way." may stay on screen before we say plainly
 * that it is not coming. An <img> that hangs never fires `error`, so this is the
 * one client request the API deadline could not cover: without it a stalled
 * image request leaves that line up for the whole round.
 */
export const PHOTO_LOAD_TIMEOUT_MS = 15000;

/**
 * The round photo. The bytes come from the worker, which fetched them once so
 * every player and every bot sees the same picture.
 */
export function photoFrame(
  ctx: RoomCtx,
  size: 'big' | 'small'
): { el: HTMLElement; set(view: RoomView): void; destroy(): void } {
  const img = h('img', { class: 'photo-img', alt: 'The photo everyone is captioning' });
  const fallback = h('p', { class: 'photo-fallback', text: 'The photo is on its way.' });
  const el = h('figure', { class: `photo photo-${size}` }, [img, fallback]);
  let shown = '';
  let hangTimer = 0;

  const clearHangTimer = (): void => {
    if (hangTimer) {
      window.clearTimeout(hangTimer);
      hangTimer = 0;
    }
  };

  /** The same wording the `error` handler uses: to a player, hung and broken are one thing. */
  const sayItDidNotLoad = (): void => {
    el.classList.add('photo-broken');
    fallback.textContent = 'The photo did not load. The captions still count.';
  };

  img.addEventListener('load', () => {
    clearHangTimer();
    fallback.textContent = '';
    el.classList.remove('photo-broken');
  });
  img.addEventListener('error', () => {
    clearHangTimer();
    sayItDidNotLoad();
  });

  return {
    el,
    set(view: RoomView) {
      const round = view.photo?.round ?? view.round;
      const src = view.photo?.url ?? photoUrl(ctx.code, round);
      if (!view.photo || src === shown) return;
      shown = src;
      fallback.textContent = 'The photo is on its way.';
      img.alt = `The photo for round ${round}`;
      img.src = src;
      clearHangTimer();
      hangTimer = window.setTimeout(sayItDidNotLoad, PHOTO_LOAD_TIMEOUT_MS);
    },
    destroy() {
      clearHangTimer();
    },
  };
}

/**
 * The one sentence the whole app uses when Workers AI has spent its daily free
 * allowance (round 7, must-fix 1). Written once, here, because it appears on the
 * lobby, on every phase screen and on the champion screen, and three copies of a
 * sentence is three chances for them to disagree.
 *
 * It says what happened, in words a player can act on, and does not mention
 * neurons, a binding, an error code or a plan tier.
 */
export const AI_OFFLINE_LINE =
  'The AI players are offline today (the daily free AI allowance is used up). ' +
  'They will be back after midnight UTC.';

/** The lobby / in-game player list, with a badge on the AI players. */
export function playerList(view: RoomView, viewerId: string): HTMLElement {
  const list = h('ul', { class: 'players' });
  for (const player of view.players) {
    const row = h('li', { class: 'player' }, [
      h('span', { class: 'player-name', text: player.name }),
      player.isBot ? h('span', { class: 'badge badge-ai', text: 'AI' }) : null,
      // The AI players keep their row when the allowance runs out; they are
      // marked, not removed, because their scores up to that point are real.
      player.isBot && view.aiOffline === true
        ? h('span', { class: 'badge badge-offline', text: 'offline' })
        : null,
      player.id === viewerId ? h('span', { class: 'badge badge-you', text: 'you' }) : null,
      player.id === view.hostId ? h('span', { class: 'badge badge-host', text: 'host' }) : null,
    ]);
    list.append(row);
  }
  return list;
}

/** Scores, highest first, ties in player order. */
export function scoreboard(view: RoomView, viewerId: string, title = 'Scores'): HTMLElement {
  const ranked = [...view.players].sort((a, b) => b.score - a.score);
  const list = h('ol', { class: 'scores' });
  for (const player of ranked) {
    list.append(
      h('li', { class: player.id === viewerId ? 'score-row score-you' : 'score-row' }, [
        h('span', { class: 'score-name', text: player.name }),
        player.isBot ? h('span', { class: 'badge badge-ai', text: 'AI' }) : null,
        player.isBot && view.aiOffline === true
          ? h('span', { class: 'badge badge-offline', text: 'offline' })
          : null,
        h('span', {
          class: 'score-points',
          text: player.score === 1 ? '1 point' : `${player.score} points`,
        }),
      ])
    );
  }
  return h('section', { class: 'panel' }, [h('h2', { text: title }), list]);
}

/** Shown to somebody who joined in the middle of a round. */
export function spectatorNotice(): HTMLElement {
  return h('div', { class: 'panel spectator' }, [
    h('p', { class: 'spectator-line', text: 'You join next round.' }),
    h('p', { class: 'hint', text: 'Watch this one. You are already on the scoreboard.' }),
  ]);
}
