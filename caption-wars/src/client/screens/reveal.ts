// The reveal: who wrote what, how many votes each caption got, and who won
// the round. Winning cards get a gold pulse AND the word "winner", so the
// colour is never the only signal.

import { REVEAL_MIN_MS } from '../../shared/config';
import type { CaptionView, RoomView } from '../contract';
import { serverNow } from '../state';
import { h } from '../ui';
import {
  isHost,
  photoFrame,
  photoWaitMs,
  playerName,
  scoreboard,
  type PhaseScreen,
  type RoomCtx,
} from './common';

/** Votes received per caption id. */
function countVotes(view: RoomView): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const caption of view.captions) counts[caption.id] = 0;
  for (const captionId of Object.values(view.votes ?? {})) {
    if (captionId in counts) counts[captionId] = (counts[captionId] ?? 0) + 1;
  }
  return counts;
}

/** The server's record of the round on screen, if it has pushed it yet. */
function recordedRound(view: RoomView): RoomView['history'][number] | undefined {
  const found =
    view.history.find((entry) => entry.round === view.round) ??
    view.history[view.history.length - 1];
  return found && found.round === view.round ? found : undefined;
}

/**
 * The banner for a round that scored nothing.
 *
 * "Not enough captions" is the truth but not the whole of it: playing solo with
 * two AI players whose model is down produces exactly this screen, and the
 * player is left thinking they did something wrong. The server says which one it
 * was on the round result.
 */
function voidBanner(view: RoomView): string {
  const reason = recordedRound(view)?.voidReason;
  if (reason === 'bots-failed') {
    return `Round ${view.round}: the AI players had nothing to say this round. No points.`;
  }
  return `Round ${view.round}: not enough captions. No points.`;
}

/**
 * The winning caption ids for the round on screen. The server writes them into
 * `history` when the vote phase ends; the tally is only a fallback for a server
 * that has not pushed the round yet.
 */
function winnerIds(view: RoomView, counts: Record<string, number>): string[] {
  const recorded = recordedRound(view);
  if (recorded) return recorded.winnerCaptionIds;
  const best = Math.max(0, ...Object.values(counts));
  if (best <= 0) return [];
  return Object.entries(counts)
    .filter(([, n]) => n === best)
    .map(([id]) => id);
}

function captionCard(
  view: RoomView,
  caption: CaptionView,
  votes: number,
  won: boolean,
  viewerId: string
): HTMLElement {
  const author = playerName(view, caption.playerId);
  const isMine = caption.playerId === viewerId;
  const bot = view.players.find((p) => p.id === caption.playerId)?.isBot === true;
  return h('li', { class: won ? 'reveal-card reveal-winner' : 'reveal-card' }, [
    h('p', { class: 'reveal-text', text: caption.text }),
    h('p', { class: 'reveal-meta' }, [
      h('span', { class: 'reveal-author', text: isMine ? `${author} (you)` : author }),
      bot ? h('span', { class: 'badge badge-ai', text: 'AI' }) : null,
      h('span', {
        class: 'reveal-votes',
        text: votes === 1 ? '1 vote' : `${votes} votes`,
      }),
      won ? h('span', { class: 'badge badge-win', text: 'winner' }) : null,
    ]),
  ]);
}

/**
 * Milliseconds left on the reveal floor: how long the scoreboard still has to
 * stay on screen before the server will accept the host's "next". The button is
 * disabled and counts down until this reaches zero, so the tap can never fail.
 */
function floorMsLeft(view: RoomView | null): number {
  if (!view || typeof view.phaseStartedAt !== 'number') return 0;
  const floor = typeof view.revealMinMs === 'number' ? view.revealMinMs : REVEAL_MIN_MS;
  return Math.max(0, view.phaseStartedAt + floor - serverNow());
}

export function createRevealScreen(ctx: RoomCtx): PhaseScreen {
  const banner = h('h2', { class: 'banner', text: '' });
  const photo = photoFrame(ctx, 'small');
  const cards = h('ul', { class: 'reveal-list' });
  const board = h('div');
  const nextButton = h('button', {
    class: 'btn btn-primary btn-big',
    type: 'button',
    text: 'Next round',
  });
  const waitLine = h('p', { class: 'wait-line', text: 'Next round soon.' });

  const el = h('div', {}, [
    h('section', { class: 'panel' }, [banner, photo.el, cards]),
    board,
    h('div', { class: 'panel' }, [nextButton, waitLine]),
  ]);

  let host = false;
  let sending = false;
  let current: RoomView | null = null;

  /** The label the button carries when it is actually tappable. */
  function baseLabel(view: RoomView): string {
    return view.round >= view.options.rounds ? 'See the champion' : 'Next round';
  }

  /**
   * The button's whole state, in one place: hidden for non-hosts, disabled with
   * a countdown while the reveal floor runs, disabled while a tap is in flight,
   * and tappable otherwise. Re-enabling on failure lives here too, which is what
   * an early tap used to break.
   */
  function paintButton(): void {
    if (!current) return;
    nextButton.hidden = !host;
    waitLine.hidden = host;
    if (!host) return;

    const label = baseLabel(current);
    const waitMs = floorMsLeft(current);
    if (sending) {
      nextButton.disabled = true;
      nextButton.textContent = label;
      return;
    }
    // Both image hosts are down and the server is backing off. Tapping now gets
    // a 200 with the unchanged state and nothing visible happens, so say what is
    // actually going on rather than offering a button that does nothing.
    const photoMs = photoWaitMs(current);
    if (photoMs > 0) {
      nextButton.disabled = true;
      nextButton.textContent = `Waiting for a photo... ${Math.ceil(photoMs / 1000)}s`;
      return;
    }
    if (waitMs > 0) {
      nextButton.disabled = true;
      nextButton.textContent = `${label} in ${Math.ceil(waitMs / 1000)}s`;
      return;
    }
    nextButton.disabled = false;
    nextButton.textContent = label;
  }

  nextButton.addEventListener('click', () => {
    if (sending || nextButton.disabled) return;
    sending = true;
    paintButton();
    void ctx.actions.next().then(() => {
      // Whatever happened, the button comes back: a failed move-on used to
      // leave the host staring at a dead button for the rest of the round.
      sending = false;
      paintButton();
    });
  });

  return {
    el,
    update(view: RoomView) {
      current = view;
      photo.set(view);
      const counts = countVotes(view);
      const winners = new Set(winnerIds(view, counts));

      const rows = view.captions.map((caption) =>
        captionCard(view, caption, counts[caption.id] ?? 0, winners.has(caption.id), ctx.playerId)
      );
      cards.replaceChildren(...rows);

      if (view.captions.length < 2) {
        banner.textContent = voidBanner(view);
      } else if (winners.size === 0) {
        banner.textContent = `Round ${view.round}: nobody voted. No points.`;
      } else {
        const names = [...winners]
          .map((id) => playerName(view, view.captions.find((c) => c.id === id)?.playerId))
          .join(' and ');
        banner.textContent = `Round ${view.round} winner: ${names}`;
      }

      board.replaceChildren(scoreboard(view, ctx.playerId));

      host = isHost(view, ctx.playerId);
      paintButton();
    },
    tick(msLeft: number) {
      if (host) {
        paintButton();
        return;
      }
      const seconds = Math.max(0, Math.ceil(msLeft / 1000));
      waitLine.textContent = seconds > 0 ? `Next round in ${seconds}s` : 'Next round any moment.';
    },
    destroy() {
      // the photo frame owns a hang timer; nothing else here has one
      photo.destroy();
    },
  };
}
