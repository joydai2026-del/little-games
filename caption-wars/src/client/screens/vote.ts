// The vote phase: the photo smaller at the top, then every caption as a
// button big enough to hit with a thumb, in the order the server sent them
// (the server shuffles once per round so every screen matches).
//
// Authors are hidden here. Your own caption is greyed out and marked "yours",
// and the server rejects a self-vote as well.

import type { CaptionView, RoomView } from '../contract';
import { h } from '../ui';
import {
  countdown,
  isSpectator,
  photoFrame,
  spectatorNotice,
  type PhaseScreen,
  type RoomCtx,
} from './common';

export function createVoteScreen(ctx: RoomCtx): PhaseScreen {
  const roundLine = h('p', { class: 'round-line', text: '' });
  const clock = countdown();
  const photo = photoFrame(ctx, 'small');
  const prompt = h('h2', { class: 'vote-prompt', text: 'Pick the best caption' });
  const list = h('div', { class: 'vote-list' });
  const votedLine = h('p', { class: 'sent-line', text: 'Vote in. Waiting for the others.' });
  votedLine.hidden = true;

  const spectator = spectatorNotice();
  spectator.hidden = true;

  const el = h('div', {}, [
    roundLine,
    clock.el,
    photo.el,
    h('section', { class: 'panel' }, [prompt, list, votedLine]),
    spectator,
  ]);

  const buttons = new Map<string, HTMLButtonElement>();
  let signature = '';
  let chosenId: string | null = null;
  let sending = false;
  let watching = false;

  function ownId(captions: CaptionView[]): string | null {
    const flagged = captions.find((c) => c.isOwn === true || c.playerId === ctx.playerId);
    return flagged?.id ?? ctx.ownCaptionId();
  }

  function paintStates(captions: CaptionView[]): void {
    const own = ownId(captions);
    for (const caption of captions) {
      const button = buttons.get(caption.id);
      if (!button) continue;
      const isOwn = caption.id === own;
      const votable = !isOwn && caption.canVote !== false && chosenId === null && !watching;
      button.classList.toggle('vote-own', isOwn);
      button.classList.toggle('vote-chosen', chosenId === caption.id);
      // A spectator joined after the roster froze: the server would answer their
      // tap with a 409, so the cards are dead rather than lying about being live.
      button.disabled = isOwn || sending || chosenId !== null || watching;
      const tag = button.querySelector('.vote-tag');
      if (tag) {
        tag.textContent = isOwn ? 'yours' : chosenId === caption.id ? 'your vote' : '';
      }
      button.setAttribute('aria-pressed', chosenId === caption.id ? 'true' : 'false');
      if (!votable && !isOwn && chosenId === null) button.disabled = true;
    }
    votedLine.hidden = chosenId === null;
    prompt.textContent = chosenId === null ? 'Pick the best caption' : 'Your pick is in';
  }

  function rebuild(captions: CaptionView[]): void {
    buttons.clear();
    const rows: HTMLElement[] = [];
    for (const caption of captions) {
      const tag = h('span', { class: 'vote-tag', text: '' });
      const button = h('button', { class: 'vote-card', type: 'button' }, [
        h('span', { class: 'vote-text', text: caption.text }),
        tag,
      ]);
      button.addEventListener('click', () => {
        if (sending || chosenId !== null || watching) return;
        sending = true;
        paintStates(captions);
        void ctx.actions.sendVote(caption.id).then((ok) => {
          sending = false;
          if (ok) chosenId = caption.id;
          paintStates(captions);
        });
      });
      buttons.set(caption.id, button);
      rows.push(button);
    }
    list.replaceChildren(...rows);
  }

  return {
    el,
    update(view: RoomView) {
      roundLine.textContent = `Round ${view.round} of ${view.options.rounds}`;
      photo.set(view);

      watching = isSpectator(view, ctx.playerId);
      spectator.hidden = !watching;

      const captions = view.captions;
      const next = captions.map((c) => c.id).join('|');
      if (next !== signature) {
        signature = next;
        rebuild(captions);
      }

      // A vote the server already recorded (e.g. after a reload) wins over the
      // local flag. It arrives as `yourVote`, not in `votes`: the live ballot is
      // secret during this phase, so `votes` is empty until the reveal.
      const recorded = view.yourVote;
      if (typeof recorded === 'string' && recorded) chosenId = recorded;
      paintStates(captions);

      if (captions.length === 0) {
        prompt.textContent = 'No captions this round';
      } else if (watching) {
        prompt.textContent = 'The others are voting';
      }
    },
    tick(msLeft: number) {
      clock.set(msLeft);
    },
    destroy() {
      // no timers of its own
    },
  };
}
