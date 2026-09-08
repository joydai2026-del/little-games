// The first screen: type a name, then either start a room or join one.
//
// The game settings sit inside a closed "Game settings" drawer so the normal
// path is exactly two taps: type a name, press Create a room.

import { DEFAULT_ROOM_OPTIONS, MAX_BOTS } from '../../shared/config';
import { createRoom, joinRoom } from '../api';
import type { RoomOptions } from '../contract';
import { navigate } from '../router';
import { normalizeCode, saveName, savedName, writeIdentity } from '../state';
import { h, numberSelect, page, toast } from '../ui';

const ROUND_CHOICES = [1, 3, 5, 7, 10];
const CAPTION_SECOND_CHOICES = [30, 45, 60, 90, 120];
const VOTE_SECOND_CHOICES = [15, 20, 30, 45, 60];

function botChoices(): number[] {
  return Array.from({ length: MAX_BOTS + 1 }, (_, i) => i);
}

export function renderHome(root: HTMLElement): () => void {
  const { root: shell, body } = page('Caption Wars', {
    subtitle: 'One photo. Everyone writes a caption. Best one wins.',
  });

  const nameInput = h('input', {
    type: 'text',
    id: 'your-name',
    class: 'input',
    placeholder: 'Your name',
    maxlength: '20',
    autocomplete: 'nickname',
    value: savedName(),
  });

  const rounds = numberSelect('opt-rounds', 'Rounds', ROUND_CHOICES, DEFAULT_ROOM_OPTIONS.rounds);
  const captionSeconds = numberSelect(
    'opt-caption-seconds',
    'Seconds to write a caption',
    CAPTION_SECOND_CHOICES,
    DEFAULT_ROOM_OPTIONS.captionSeconds,
    'seconds'
  );
  const voteSeconds = numberSelect(
    'opt-vote-seconds',
    'Seconds to vote',
    VOTE_SECOND_CHOICES,
    DEFAULT_ROOM_OPTIONS.voteSeconds,
    'seconds'
  );
  const botCount = numberSelect(
    'opt-bots',
    'AI players',
    botChoices(),
    DEFAULT_ROOM_OPTIONS.botCount
  );

  const createButton = h('button', {
    class: 'btn btn-primary btn-big',
    type: 'button',
    text: 'Create a room',
  });

  const codeInput = h('input', {
    type: 'text',
    id: 'room-code',
    class: 'input input-code',
    placeholder: 'CODE',
    maxlength: '4',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    inputmode: 'latin',
  });
  codeInput.addEventListener('input', () => {
    const cleaned = normalizeCode(codeInput.value);
    if (cleaned !== codeInput.value) codeInput.value = cleaned;
  });

  const joinButton = h('button', {
    class: 'btn btn-secondary btn-big',
    type: 'button',
    text: 'Join',
  });

  function readName(): string | null {
    const name = nameInput.value.trim();
    if (!name) {
      toast('Type a name first, so everyone knows who you are.');
      nameInput.focus();
      return null;
    }
    saveName(name);
    return name;
  }

  function chosenOptions(): Partial<RoomOptions> {
    return {
      rounds: Number(rounds.select.value),
      captionSeconds: Number(captionSeconds.select.value),
      voteSeconds: Number(voteSeconds.select.value),
      botCount: Number(botCount.select.value),
    };
  }

  function busy(button: HTMLButtonElement, label: string, on: boolean, restore: string): void {
    button.disabled = on;
    button.textContent = on ? label : restore;
  }

  createButton.addEventListener('click', () => {
    const name = readName();
    if (!name) return;
    busy(createButton, 'Making the room...', true, 'Create a room');
    void createRoom({ name, options: chosenOptions() })
      .then((reply) => {
        writeIdentity(reply.code, {
          playerId: reply.playerId,
          playerSecret: reply.playerSecret,
        });
        navigate(`#/room/${reply.code}`);
      })
      .catch((error: Error) => {
        busy(createButton, '', false, 'Create a room');
        toast(error.message);
      });
  });

  function doJoin(): void {
    const name = readName();
    if (!name) return;
    const code = normalizeCode(codeInput.value);
    if (code.length !== 4) {
      toast('A room code is 4 letters. Ask the host for theirs.');
      codeInput.focus();
      return;
    }
    busy(joinButton, 'Joining...', true, 'Join');
    void joinRoom(code, name)
      .then((reply) => {
        writeIdentity(code, { playerId: reply.playerId, playerSecret: reply.playerSecret });
        navigate(`#/room/${code}`);
      })
      .catch((error: Error) => {
        busy(joinButton, '', false, 'Join');
        toast(error.message);
      });
  }

  joinButton.addEventListener('click', doJoin);
  codeInput.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') doJoin();
  });

  body.append(
    h('section', { class: 'panel' }, [
      h('div', { class: 'field' }, [
        h('label', { for: 'your-name', text: 'Your name' }),
        nameInput,
      ]),
      createButton,
      h('details', { class: 'settings' }, [
        h('summary', { text: 'Game settings' }),
        h('p', { class: 'hint', text: 'Only the person who creates the room picks these.' }),
        rounds.field,
        captionSeconds.field,
        voteSeconds.field,
        botCount.field,
      ]),
    ]),
    h('section', { class: 'panel' }, [
      h('h2', { text: 'Got a code?' }),
      h('div', { class: 'field' }, [
        h('label', { for: 'room-code', text: 'Room code' }),
        codeInput,
      ]),
      joinButton,
    ]),
    h('p', {
      class: 'hint',
      text: 'No account, no app. Everyone opens the same link on their phone.',
    })
  );

  root.replaceChildren(shell);
  return () => {
    // nothing running: the home screen has no timers
  };
}
