// The room shell. It owns identity, polling, the clock and which phase screen
// is on stage; the phase screens own what a player sees and touches.
//
// Reload safety: identity lives in sessionStorage under the room code, so a
// refresh (or a phone locking itself) comes straight back into the same seat.

import { ApiError, createRoom, fetchRoom, joinRoom, nextRound, sendCaption, sendVote, startRoom } from '../api';
import type { Identity, Phase, RoomEnvelope, RoomView } from '../contract';
import { countdownMs, startPolling } from '../poll';
import { navigate } from '../router';
import {
  clockOffsetMs,
  forgetIdentity,
  readIdentity,
  saveName,
  savedName,
  writeIdentity,
} from '../state';
import { h, notice, page, toast } from '../ui';
import { createCaptionScreen } from './caption';
import type { PhaseScreen, RoomCtx } from './common';
import { createDoneScreen } from './done';
import { createLobbyScreen } from './lobby';
import { createRevealScreen } from './reveal';
import { createVoteScreen } from './vote';

const TICK_MS = 1000;

function build(phase: Phase, ctx: RoomCtx): PhaseScreen {
  switch (phase) {
    case 'lobby':
      return createLobbyScreen(ctx);
    case 'caption':
      return createCaptionScreen(ctx);
    case 'vote':
      return createVoteScreen(ctx);
    case 'reveal':
      return createRevealScreen(ctx);
    case 'done':
      return createDoneScreen(ctx);
  }
}

export function renderRoom(root: HTMLElement, code: string): () => void {
  const { root: shell, body } = page(`Room ${code}`, { back: '#/' });
  const problem = h('div');
  const stage = h('div');
  body.append(problem, stage);
  root.replaceChildren(shell);

  let identity: Identity | null = readIdentity(code);
  let view: RoomView | null = null;
  let screen: PhaseScreen | null = null;
  let shownPhase: Phase | null = null;
  let stopPoll: (() => void) | null = null;
  let ticker = 0;
  let ownCaptionId: string | null = null;
  let ownCaptionRound = -1;
  let leaving = false;

  const stopEverything = (): void => {
    stopPoll?.();
    stopPoll = null;
    window.clearInterval(ticker);
    ticker = 0;
    screen?.destroy();
  };

  const showProblem = (message: string | null): void => {
    if (message === null) {
      problem.replaceChildren();
      return;
    }
    problem.replaceChildren(notice(message, 'warn'));
  };

  // ---------- the name gate ----------

  const paintNameGate = (message?: string): void => {
    stopEverything();
    screen = null;
    shownPhase = null;

    const nameInput = h('input', {
      type: 'text',
      id: 'join-name',
      class: 'input',
      placeholder: 'Your name',
      maxlength: '20',
      autocomplete: 'nickname',
      value: savedName(),
    });
    const joinButton = h('button', {
      class: 'btn btn-primary btn-big',
      type: 'button',
      text: 'Join the game',
    });

    const doJoin = (): void => {
      const name = nameInput.value.trim();
      if (!name) {
        toast('Type a name so the others know who you are.');
        nameInput.focus();
        return;
      }
      saveName(name);
      joinButton.disabled = true;
      joinButton.textContent = 'Joining...';
      void joinRoom(code, name)
        .then((reply) => {
          identity = { playerId: reply.playerId, playerSecret: reply.playerSecret };
          writeIdentity(code, identity);
          showProblem(null);
          if (reply.state) absorb(reply);
          beginPolling();
        })
        .catch((error: Error) => {
          joinButton.disabled = false;
          joinButton.textContent = 'Join the game';
          toast(error.message);
        });
    };

    joinButton.addEventListener('click', doJoin);
    nameInput.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') doJoin();
    });

    if (message) showProblem(message);

    stage.replaceChildren(
      h('section', { class: 'panel panel-code' }, [
        h('p', { class: 'code-label', text: 'Room code' }),
        h('div', { class: 'code-big', text: code }),
      ]),
      h('section', { class: 'panel' }, [
        h('div', { class: 'field' }, [
          h('label', { for: 'join-name', text: 'Your name' }),
          nameInput,
        ]),
        joinButton,
      ])
    );
  };

  // ---------- state in, screen out ----------

  const paint = (): void => {
    if (!view) return;
    if (shownPhase !== view.phase || !screen) {
      screen?.destroy();
      screen = build(view.phase, ctx);
      shownPhase = view.phase;
      stage.replaceChildren(screen.el);
    }
    screen.update(view);
    screen.tick(msLeft());
  };

  const msLeft = (): number => countdownMs(view?.phaseEndsAt, clockOffsetMs());

  const absorb = (envelope: RoomEnvelope): void => {
    if (!envelope.state) return;
    const next = envelope.state;
    if (view && next.version < view.version) return; // an older reply overtook us
    if (!view || next.round !== view.round) {
      ownCaptionId = null;
      ownCaptionRound = next.round;
    }
    const mine = next.captions.find((c) => c.playerId === ctx.playerId);
    if (mine && next.round === ownCaptionRound) ownCaptionId = mine.id;
    view = next;
    showProblem(null);
    paint();
  };

  const handleActionError = (error: unknown): void => {
    const message = error instanceof Error ? error.message : 'That did not work. Try again.';
    if (error instanceof ApiError && error.status === 403) {
      forgetIdentity(code);
      identity = null;
      view = null;
      paintNameGate(message);
      return;
    }
    toast(message);
  };

  // ---------- what the screens can ask for ----------

  const ctx: RoomCtx = {
    code,
    playerId: identity?.playerId ?? '',
    ownCaptionId: () => ownCaptionId,
    actions: {
      start() {
        if (!identity) return;
        void startRoom(code, identity).then(absorb).catch(handleActionError);
      },
      sendCaption(text: string) {
        if (!identity) return Promise.resolve(false);
        return sendCaption(code, identity, text)
          .then((envelope) => {
            absorb(envelope);
            return true;
          })
          .catch((error: unknown) => {
            handleActionError(error);
            return false;
          });
      },
      sendVote(captionId: string) {
        if (!identity) return Promise.resolve(false);
        return sendVote(code, identity, captionId)
          .then((envelope) => {
            absorb(envelope);
            return true;
          })
          .catch((error: unknown) => {
            handleActionError(error);
            return false;
          });
      },
      next() {
        if (!identity) return;
        void nextRound(code, identity).then(absorb).catch(handleActionError);
      },
      playAgain() {
        const name =
          view?.players.find((p) => p.id === ctx.playerId)?.name || savedName() || 'Player';
        const options = view?.options;
        void createRoom({
          name,
          options: options
            ? {
                rounds: options.rounds,
                captionSeconds: options.captionSeconds,
                voteSeconds: options.voteSeconds,
                revealSeconds: options.revealSeconds,
                botCount: view?.players.filter((p) => p.isBot).length ?? options.botCount,
              }
            : {},
        })
          .then((reply) => {
            writeIdentity(reply.code, {
              playerId: reply.playerId,
              playerSecret: reply.playerSecret,
            });
            leaving = true;
            stopEverything();
            navigate(`#/room/${reply.code}`);
          })
          .catch(handleActionError);
      },
    },
  };

  // ---------- polling ----------

  function beginPolling(): void {
    if (!identity || leaving) return;
    ctx.playerId = identity.playerId;
    stopPoll?.();
    stopPoll = startPolling({
      getVersion: () => view?.version,
      fetchOnce: (version) => fetchRoom(code, identity as Identity, version),
      onEnvelope: (envelope) => {
        if (envelope.unchanged) {
          showProblem(null);
          return;
        }
        absorb(envelope);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 403) {
          forgetIdentity(code);
          identity = null;
          stopEverything();
          paintNameGate('This device is no longer in that room. Join it again.');
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          stopEverything();
          showProblem('That room is gone. Rooms clear themselves out after a couple of hours.');
          return;
        }
        showProblem('Lost the room for a second. Still trying.');
      },
    });

    window.clearInterval(ticker);
    ticker = window.setInterval(() => {
      screen?.tick(msLeft());
    }, TICK_MS);
  }

  if (identity) {
    stage.replaceChildren(h('p', { class: 'hint', text: 'Opening the room...' }));
    beginPolling();
  } else {
    paintNameGate();
  }

  return () => {
    leaving = true;
    stopEverything();
  };
}
