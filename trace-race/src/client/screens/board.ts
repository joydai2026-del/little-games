// The race board: one lane per kid. Built for the classroom big screen.
import type { PublicState } from '../../shared/types';
import { h } from '../ui';

export function board(state: PublicState): HTMLElement {
  const total = state.roundChars.length || 1;
  return h(
    'ol',
    { class: 'board', 'aria-label': 'Race board' },
    state.standings.map((row) => {
      const pct = Math.round((row.charsDone / total) * 100);
      const placeClass = row.place <= 3 && (row.charsDone > 0 || state.phase === 'done') ? ` p${row.place}` : '';
      return h('li', { class: 'lane' }, [
        h('span', { class: `place${placeClass}`, text: String(row.place) }),
        h('div', {}, [
          h('span', { class: 'name', text: row.name }),
          row.agent ? h('span', { class: 'tag', text: 'AI' }) : null,
          row.playerId === state.you ? h('span', { class: 'tag', text: 'you' }) : null,
          h('div', { class: 'bar', 'aria-label': `${row.charsDone} of ${total} done` }, [h('span', { style: `width:${pct}%` })]),
          h('span', { class: 'muted', text: `${row.charsDone} of ${total} done${row.mistakes ? `, ${row.mistakes} oops` : ''}` }),
        ]),
        row.finished
          ? h('span', { class: 'now fin', text: 'Done!' })
          : h('span', { class: 'now', text: row.currentChar ?? '' }),
      ]);
    })
  );
}
