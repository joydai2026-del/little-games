// The lobby: the code in the biggest type on the screen, who is here, and
// (for the host only) the Start button.

import type { RoomView } from '../contract';
import { absoluteUrl, copyButton, h } from '../ui';
import { isHost, playerList, type PhaseScreen, type RoomCtx } from './common';

export function createLobbyScreen(ctx: RoomCtx): PhaseScreen {
  const codeBox = h('div', { class: 'code-big', text: ctx.code });
  const people = h('div', { class: 'panel' }, [h('h2', { text: 'In the room' })]);
  const peopleList = h('div');
  people.append(peopleList);

  const startButton = h('button', {
    class: 'btn btn-primary btn-big',
    type: 'button',
    text: 'Start the game',
  });
  const paintStartButton = (): void => {
    startButton.disabled = false;
    startButton.textContent = 'Start the game';
  };

  startButton.addEventListener('click', () => {
    startButton.disabled = true;
    startButton.textContent = 'Starting...';
    // Put the button back whatever happens. A failed first tap (both photo
    // hosts down, so the server answers 502) used to leave it disabled reading
    // "Starting..." for ever: update() only runs when a poll carries new state,
    // and a quiet lobby answers `unchanged`. The host could not start the game.
    void ctx.actions.start().then((ok) => {
      if (!ok) paintStartButton();
    });
  });

  const waitLine = h('p', { class: 'wait-line', text: 'Waiting for the host to start.' });
  const settingsLine = h('p', { class: 'hint', text: '' });
  const action = h('div', { class: 'panel' }, [startButton, waitLine, settingsLine]);

  const el = h('div', {}, [
    h('section', { class: 'panel panel-code' }, [
      h('p', { class: 'code-label', text: 'Room code' }),
      codeBox,
      h('p', { class: 'hint', text: 'Friends type this on the home screen, or open the link.' }),
      copyButton('Copy the link', () => absoluteUrl(`#/room/${ctx.code}`)),
    ]),
    people,
    action,
  ]);

  return {
    el,
    update(view: RoomView) {
      peopleList.replaceChildren(playerList(view, ctx.playerId));
      const host = isHost(view, ctx.playerId);
      startButton.hidden = !host;
      waitLine.hidden = host;
      if (host) paintStartButton();
      const bots = view.players.filter((p) => p.isBot).length;
      const parts = [
        `${view.options.rounds} ${view.options.rounds === 1 ? 'round' : 'rounds'}`,
        `${view.options.captionSeconds}s to write`,
        `${view.options.voteSeconds}s to vote`,
        `${bots} AI ${bots === 1 ? 'player' : 'players'}`,
      ];
      settingsLine.textContent = parts.join(' - ');
    },
    tick() {
      // the lobby has no clock
    },
    destroy() {
      // no timers of its own
    },
  };
}
