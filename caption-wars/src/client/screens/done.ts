// The end of the game: who won overall, the final scores, and one button to
// run it again with the same name and the same settings.

import type { RoomView } from '../contract';
import { h } from '../ui';
import { playerName, scoreboard, type PhaseScreen, type RoomCtx } from './common';

export function createDoneScreen(ctx: RoomCtx): PhaseScreen {
  const banner = h('h2', { class: 'banner banner-champion', text: '' });
  const line = h('p', { class: 'hint', text: '' });
  const board = h('div');
  const againButton = h('button', {
    class: 'btn btn-primary btn-big',
    type: 'button',
    text: 'Play again',
  });
  const paintAgainButton = (): void => {
    againButton.disabled = false;
    againButton.textContent = 'Play again';
  };

  // Same in-flight guard as the lobby and the reveal: while a tap is in flight
  // nothing else may repaint this button. update() is unreachable at `done`
  // today (the server sends nextPollMs: 0 and polling stops for good), but the
  // guard is what keeps that from becoming a bug the day it is reachable.
  let sending = false;

  againButton.addEventListener('click', () => {
    if (sending || againButton.disabled) return;
    sending = true;
    againButton.disabled = true;
    againButton.textContent = 'Making a new room...';
    // The done screen has stopped polling for good (the server sends
    // nextPollMs: 0 here), so update() can never run again and this is the only
    // place the button can come back to life. Without it any transient failure
    // leaves the champion screen with a dead "Making a new room..." button.
    void ctx.actions.playAgain().then(() => {
      sending = false;
      paintAgainButton();
    });
  });

  const el = h('div', {}, [
    h('section', { class: 'panel panel-champion' }, [banner, line]),
    board,
    h('div', { class: 'panel' }, [
      againButton,
      h('p', { class: 'hint', text: 'A new code. Share it the same way.' }),
      h('a', { class: 'btn btn-ghost', href: '#/', text: 'Back to the start' }),
    ]),
  ]);

  return {
    el,
    update(view: RoomView) {
      const champions = view.championIds ?? [];
      // The game can also end because the photo host went away mid-game. Say so
      // plainly, and still show the scores everyone earned up to that point.
      if (view.endedReason === 'photo-unavailable') {
        banner.textContent = 'Game over';
        line.textContent = 'We could not fetch a photo. Game over.';
      } else if (champions.length === 0) {
        banner.textContent = 'Game over';
        line.textContent = 'No champion this time.';
      } else {
        const names = champions.map((id) => playerName(view, id)).join(' and ');
        banner.textContent = champions.length > 1 ? `Joint champions: ${names}` : `Champion: ${names}`;
        const top = view.players.find((p) => p.id === champions[0]);
        line.textContent = top
          ? `${top.score === 1 ? '1 point' : `${top.score} points`} over ${view.options.rounds} ${
              view.options.rounds === 1 ? 'round' : 'rounds'
            }.`
          : '';
      }
      board.replaceChildren(scoreboard(view, ctx.playerId, 'Final scores'));
      if (!sending) paintAgainButton();
    },
    tick() {
      // the game is over: no clock
    },
    destroy() {
      // no timers of its own
    },
  };
}
