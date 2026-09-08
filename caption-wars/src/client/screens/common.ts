// Pieces every in-room screen shares: the contract between the room shell
// (which owns polling) and one phase screen, plus the photo frame, the
// countdown pill, the player list and the scoreboard.

import { photoUrl } from '../api';
import type { RoomView } from '../contract';
import { countdownSeconds } from '../poll';
import { h } from '../ui';

/** What a phase screen can ask the room shell to do. */
export interface RoomActions {
  start(): void;
  sendCaption(text: string): Promise<boolean>;
  sendVote(captionId: string): Promise<boolean>;
  /** Resolves false when the move-on failed, so the button can come back to life. */
  next(): Promise<boolean>;
  playAgain(): void;
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
 * The round photo. The bytes come from the worker, which fetched them once so
 * every player and every bot sees the same picture.
 */
export function photoFrame(
  ctx: RoomCtx,
  size: 'big' | 'small'
): { el: HTMLElement; set(view: RoomView): void } {
  const img = h('img', { class: 'photo-img', alt: 'The photo everyone is captioning' });
  const fallback = h('p', { class: 'photo-fallback', text: 'The photo is on its way.' });
  const el = h('figure', { class: `photo photo-${size}` }, [img, fallback]);
  let shown = '';

  img.addEventListener('load', () => {
    fallback.textContent = '';
    el.classList.remove('photo-broken');
  });
  img.addEventListener('error', () => {
    el.classList.add('photo-broken');
    fallback.textContent = 'The photo did not load. The captions still count.';
  });

  return {
    el,
    set(view: RoomView) {
      const round = view.photo?.round ?? view.round;
      const src = view.photo?.url ?? photoUrl(ctx.code, round, ctx.playerId);
      if (!view.photo || src === shown) return;
      shown = src;
      fallback.textContent = 'The photo is on its way.';
      img.alt = `The photo for round ${round}`;
      img.src = src;
    },
  };
}

/** The lobby / in-game player list, with a badge on the AI players. */
export function playerList(view: RoomView, viewerId: string): HTMLElement {
  const list = h('ul', { class: 'players' });
  for (const player of view.players) {
    const row = h('li', { class: 'player' }, [
      h('span', { class: 'player-name', text: player.name }),
      player.isBot ? h('span', { class: 'badge badge-ai', text: 'AI' }) : null,
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
