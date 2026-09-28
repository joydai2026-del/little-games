// The class board: one lane per kid. Built for the classroom big screen.
import type { PublicState } from '../../shared/types';
import { seconds } from '../status';
import { h } from '../ui';

export function board(state: PublicState): HTMLElement {
  const total = state.roundChars.length || 1;
  return h(
    'ol',
    { class: 'board', 'aria-label': 'Class board' },
    state.standings.map((row) => {
      const placeClass = row.place <= 3 && (row.rights > 0 || state.phase === 'done') ? ` p${row.place}` : '';
      const now =
        state.phase !== 'racing'
          ? null
          : row.now === 'right'
            ? h('span', { class: 'now got', text: `✓ ${seconds(row.nowMs ?? 0)}` })
            : row.now === 'trying'
              ? h('span', { class: 'now trying', text: 'trying...' })
              : h('span', { class: 'now' });
      return h('li', { class: 'lane' }, [
        h('span', { class: `place${placeClass}`, text: String(row.place) }),
        h('div', {}, [
          h('span', { class: 'name', text: row.name }),
          row.agent ? h('span', { class: 'tag', text: 'AI' }) : null,
          row.playerId === state.you ? h('span', { class: 'tag', text: 'you' }) : null,
          h('div', { class: 'stars', 'aria-label': `won ${row.wins}` }, Array.from({ length: row.wins }, () => h('span', { class: 'star', text: '★' }))),
          h('span', { class: 'muted', text: `won ${row.wins} · ${row.rights} of ${total} right${row.mistakes ? ` · ${row.mistakes} oops` : ''}` }),
        ]),
        now,
      ]);
    })
  );
}
