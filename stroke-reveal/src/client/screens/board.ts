// The live board: one lane per kid, points and how they are doing on this word.
// Built for the classroom big screen; kids see a smaller copy.
import type { PublicState, QuestionStatus } from '../../shared/types';
import { h } from '../ui';

const STATUS: Record<QuestionStatus, string> = { got: 'Got it!', out: 'Out', thinking: '...' };

export function board(state: PublicState, showStatus: boolean): HTMLElement {
  return h(
    'ol',
    { class: 'board', 'aria-label': 'Score board' },
    state.standings.map((row) => {
      const placeClass = row.place <= 3 && (row.points > 0 || state.phase === 'done') ? ` p${row.place}` : '';
      return h('li', { class: 'lane' }, [
        h('span', { class: `place${placeClass}`, text: String(row.place) }),
        h('div', {}, [
          h('span', { class: 'name', text: row.name }),
          row.agent ? h('span', { class: 'tag', text: 'AI' }) : null,
          row.playerId === state.you ? h('span', { class: 'tag', text: 'you' }) : null,
          h('span', { class: 'muted block', text: `${row.points} points · ${row.correct} right` }),
        ]),
        showStatus ? h('span', { class: `status ${row.status}`, text: STATUS[row.status] }) : h('span'),
      ]);
    })
  );
}
