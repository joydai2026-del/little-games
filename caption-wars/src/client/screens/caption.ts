// The caption phase: the photo, the clock, and one line to write.
//
// The input and its counter are built once and kept, so a poll landing
// mid-sentence never wipes what the player is typing.

import { CAPTION_MAX_CHARS } from '../../shared/config';
import type { RoomView } from '../contract';
import { h, toast } from '../ui';
import { captionIsIn } from './lifecycle';
import {
  countdown,
  isSpectator,
  photoFrame,
  rosterSize,
  spectatorNotice,
  type PhaseScreen,
  type RoomCtx,
} from './common';

export function createCaptionScreen(ctx: RoomCtx): PhaseScreen {
  const roundLine = h('p', { class: 'round-line', text: '' });
  const clock = countdown();
  const photo = photoFrame(ctx, 'big');

  const input = h('input', {
    type: 'text',
    id: 'caption-text',
    class: 'input input-caption',
    placeholder: 'Your caption',
    maxlength: String(CAPTION_MAX_CHARS),
    autocomplete: 'off',
    enterkeyhint: 'send',
  });
  const counter = h('span', { class: 'counter', text: `0/${CAPTION_MAX_CHARS}` });
  const sendButton = h('button', {
    class: 'btn btn-primary btn-big',
    type: 'button',
    text: 'Send',
  });

  const writeBox = h('div', { class: 'panel' }, [
    h('div', { class: 'field' }, [
      h('label', { for: 'caption-text', text: 'Write one caption' }),
      input,
      counter,
    ]),
    sendButton,
  ]);

  const sentLine = h('p', { class: 'sent-line', text: 'Sent. Waiting for the others.' });
  const sentCount = h('p', { class: 'hint', text: '' });
  const sentBox = h('div', { class: 'panel sent' }, [sentLine, sentCount]);
  sentBox.hidden = true;

  const spectator = spectatorNotice();
  spectator.hidden = true;

  const el = h('div', {}, [roundLine, clock.el, photo.el, writeBox, sentBox, spectator]);

  let sending = false;
  let sent = false;

  const updateCounter = (): void => {
    counter.textContent = `${input.value.length}/${CAPTION_MAX_CHARS}`;
  };
  input.addEventListener('input', updateCounter);

  const submit = (): void => {
    if (sending || sent) return;
    const text = input.value.trim();
    if (!text) {
      toast('Write something first, anything at all.');
      input.focus();
      return;
    }
    sending = true;
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';
    void ctx.actions.sendCaption(text).then((ok) => {
      sending = false;
      sendButton.disabled = false;
      sendButton.textContent = 'Send';
      if (ok) {
        sent = true;
        writeBox.hidden = true;
        sentBox.hidden = false;
      }
    });
  };

  sendButton.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') submit();
  });

  return {
    el,
    update(view: RoomView) {
      roundLine.textContent = `Round ${view.round} of ${view.options.rounds}`;
      photo.set(view);

      const watching = isSpectator(view, ctx.playerId);
      spectator.hidden = !watching;
      if (watching) {
        writeBox.hidden = true;
        sentBox.hidden = true;
        return;
      }

      // The server is the truth about whether my caption is in: it survives a
      // reload, where the local `sent` flag does not. DERIVED, not remembered:
      // an assignment (rather than "if mine, set true") is what stops a `true`
      // from round 1 hiding the input box in round 2 on a phone that slept
      // through the rollover.
      sent = captionIsIn(view.captions, ctx.playerId);
      writeBox.hidden = sent;
      sentBox.hidden = !sent;

      if (sent) {
        const count = view.captionCount;
        const total = rosterSize(view);
        sentCount.textContent =
          typeof count === 'number' ? `${count} of ${total} captions in.` : '';
      }
      if (!sent && document.activeElement !== input) updateCounter();
    },
    tick(msLeft: number) {
      clock.set(msLeft);
    },
    destroy() {
      // the photo frame owns a hang timer; nothing else here has one
      photo.destroy();
    },
  };
}
