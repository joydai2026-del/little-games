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
import { AI_OFFLINE_LINE, type PhaseScreen, type RoomCtx } from './common';
import { shouldRebuildScreen } from './lifecycle';
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
  // ONE banner for the whole room, above whichever phase screen is on stage
  // (review round 7, must-fix 1). It lives in the shell rather than in each
  // screen because the requirement is "every phase screen and the lobby", and
  // five copies of a banner is five places for it to go missing. It is a
  // separate node from `problem` on purpose: `showProblem(null)` runs on every
  // successful poll, and a banner that clears itself once a second is not one.
  const aiBanner = h('div');
  const stage = h('div');
  body.append(problem, aiBanner, stage);
  root.replaceChildren(shell);

  let identity: Identity | null = readIdentity(code);
  let view: RoomView | null = null;
  let screen: PhaseScreen | null = null;
  // What is on stage: phase AND round. Round matters, because caption(round 1)
  // and caption(round 2) are the same phase and a different screen.
  let shown: { phase: Phase; round: number } | null = null;
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
    shown = null;
    aiBanner.replaceChildren();

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
          // Before absorb(), not after: the first paint asks "which of these is
          // me?" and would otherwise render with an empty id (no "you" badge,
          // and isSpectator briefly true).
          ctx.playerId = identity.playerId;
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

  const paintAiBanner = (): void => {
    const offline = view?.aiOffline === true;
    if (!offline) {
      if (aiBanner.firstChild) aiBanner.replaceChildren();
      return;
    }
    // Repainting an identical banner every poll would restart its screen-reader
    // announcement, so it is only built when it is not already there.
    if (aiBanner.firstChild) return;
    aiBanner.replaceChildren(notice(AI_OFFLINE_LINE, 'warn'));
  };

  const paint = (): void => {
    if (!view) return;
    paintAiBanner();
    // The game is over: polling has already stopped, so the once-a-second tick
    // has nothing left to count down.
    if (view.phase === 'done' && ticker !== 0) {
      window.clearInterval(ticker);
      ticker = 0;
    }
    if (shouldRebuildScreen(shown, view, screen !== null)) {
      screen?.destroy();
      const fresh = build(view.phase, ctx);
      screen = fresh;
      shown = { phase: view.phase, round: view.round };
      stage.replaceChildren(fresh.el);
    }
    if (!screen) return;
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
        if (!identity) return Promise.resolve(false);
        return startRoom(code, identity)
          .then((envelope) => {
            absorb(envelope);
            return true;
          })
          .catch((error: unknown) => {
            handleActionError(error);
            return false;
          });
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
        if (!identity) return Promise.resolve(false);
        return nextRound(code, identity)
          .then((envelope) => {
            absorb(envelope);
            return true;
          })
          .catch((error: unknown) => {
            // The reveal timer can end the game while the host's tap is in
            // flight. They asked to move on from a game that already moved on,
            // so that is not a failure worth a toast.
            if (view?.phase === 'done') return true;
            handleActionError(error);
            return false;
          });
      },
      playAgain() {
        const name =
          view?.players.find((p) => p.id === ctx.playerId)?.name || savedName() || 'Player';
        const options = view?.options;
        return createRoom({
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
            return true;
          })
          .catch((error: unknown) => {
            // At `done` the server sends nextPollMs: 0, so polling has stopped
            // for good and update() will never run again. If this button does
            // not put itself back here, nothing else ever will.
            handleActionError(error);
            return false;
          });
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
