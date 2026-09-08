// The reveal: who wrote what, how many votes each caption got, and who won
// the round. Winning cards get a gold pulse AND the word "winner", so the
// colour is never the only signal.

import type { CaptionView, RoomView } from '../contract';
import { h } from '../ui';
import {
  countdown,
  isHost,
  photoFrame,
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

/**
 * The winning caption ids for the round on screen. The server writes them
 * into `history` when the vote phase ends; the tally below is only a fallback
 * for a server that has not pushed the round yet.
 */
function winnerIds(view: RoomView, counts: Record<string, number>): string[] {
  const recorded =
    view.history.find((entry) => entry.round === view.round) ??
    view.history[view.history.length - 1];
  if (recorded && recorded.round === view.round) return recorded.winnerCaptionIds;
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
  nextButton.addEventListener('click', () => {
    nextButton.disabled = true;
    ctx.actions.next();
  });
  const waitLine = h('p', { class: 'wait-line', text: 'Next round soon.' });

  const el = h('div', {}, [
    h('section', { class: 'panel' }, [banner, photo.el, cards]),
    board,
    h('div', { class: 'panel' }, [nextButton, waitLine]),
  ]);

  let host = false;
  let lastRound = -1;

  return {
    el,
    update(view: RoomView) {
      photo.set(view);
      const counts = countVotes(view);
      const winners = new Set(winnerIds(view, counts));

      const rows = view.captions.map((caption) =>
        captionCard(view, caption, counts[caption.id] ?? 0, winners.has(caption.id), ctx.playerId)
      );
      cards.replaceChildren(...rows);

      if (view.captions.length < 2) {
        banner.textContent = `Round ${view.round}: not enough captions. No points.`;
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
      nextButton.hidden = !host;
      waitLine.hidden = host;
      if (host) {
        const last = view.round >= view.options.rounds;
        nextButton.textContent = last ? 'See the champion' : 'Next round';
        if (view.round !== lastRound) nextButton.disabled = false;
      }
      lastRound = view.round;
    },
    tick(msLeft: number) {
      if (host) return;
      const seconds = Math.max(0, Math.ceil(msLeft / 1000));
      waitLine.textContent = seconds > 0 ? `Next round in ${seconds}s` : 'Next round any moment.';
    },
    destroy() {
      // no timers of its own
    },
  };
}
