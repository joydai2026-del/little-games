// The lobby: the code in the biggest type on the screen, who is here, and
// (for the host only) the Start button.

import type { RoomView } from '../contract';
import { absoluteUrl, copyButton, h } from '../ui';
import { isHost, photoWaitMs, playerList, type PhaseScreen, type RoomCtx } from './common';

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
  let current: RoomView | null = null;

  /**
   * The button's whole state in one place. It is disabled with a live countdown
   * while the server is backing off a dead photo host: on the third failure that
   * backoff is 60 seconds, and a host who taps a normal-looking "Start the game"
   * for a full minute with nothing happening has no way to tell whether the
   * button, the network or the game is broken.
   */
  const paintStartButton = (): void => {
    const photoMs = photoWaitMs(current);
    if (photoMs > 0) {
      startButton.disabled = true;
      startButton.textContent = `Waiting for a photo... ${Math.ceil(photoMs / 1000)}s`;
      return;
    }
    startButton.disabled = false;
    startButton.textContent = 'Start the game';
  };

  // True from the tap until the server answers. While it is true, update() must
  // not repaint the button.
  //
  // The window is real and it lands on the first tap of the game: the server
  // holds the start request while it downloads round 1's photo (0.5-2s), a
  // friend tapping Join in that second bumps `version`, so the host's next lobby
  // poll carries fresh state, and update() used to re-enable the button reading
  // "Start the game" with the first start still in flight. The host, who has
  // just watched nothing happen, taps again and gets "This game already
  // started." at the exact moment the game starts, in front of the room.
  let sending = false;

  startButton.addEventListener('click', () => {
    if (sending || startButton.disabled) return;
    sending = true;
    startButton.disabled = true;
    startButton.textContent = 'Starting...';
    // Put the button back whatever happens. A failed first tap (both photo
    // hosts down, so the server answers 502) used to leave it disabled reading
    // "Starting..." for ever: update() only runs when a poll carries new state,
    // and a quiet lobby answers `unchanged`. The host could not start the game.
    // On success this screen is torn down and replaced, so repainting it is a
    // no-op rather than a flash.
    void ctx.actions.start().then(() => {
      sending = false;
      paintStartButton();
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
      current = view;
      peopleList.replaceChildren(playerList(view, ctx.playerId));
      const host = isHost(view, ctx.playerId);
      startButton.hidden = !host;
      waitLine.hidden = host;
      if (host && !sending) paintStartButton();
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
      // The lobby has no phase clock, but it does count down a photo backoff:
      // the state does not change while the server waits, so nothing else would
      // repaint the button.
      if (!sending && !startButton.hidden) paintStartButton();
    },
    destroy() {
      // no timers of its own
    },
  };
}
