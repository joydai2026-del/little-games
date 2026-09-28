// The class board: one lane per kid, each with a bean that jumps ahead one
// step for every word written. Built for the classroom big screen.
import type { PublicState } from '../../shared/types';
import { h } from '../ui';

export function board(state: PublicState, opts: { compact?: boolean; jumpFor?: string } = {}): HTMLElement {
  const total = state.roundWords.length || 1;
  return h(
    'ol',
    { class: `board${opts.compact ? ' compact' : ''}`, 'aria-label': 'Class board' },
    state.standings.map((row) => {
      const pct = Math.round((row.wordsDone / total) * 100);
      const placeClass = row.place <= 3 && (row.wordsDone > 0 || state.phase === 'done') ? ` p${row.place}` : '';
      const mine = row.playerId === state.you;
      const initial = [...row.name][0] ?? '?';
      return h('li', { class: `lane${mine ? ' mine' : ''}` }, [
        h('span', { class: `place${placeClass}`, text: String(row.place) }),
        h('div', { class: 'lane-main' }, [
          h('span', { class: 'name', text: row.name }),
          row.agent ? h('span', { class: 'tag', text: 'AI' }) : null,
          mine ? h('span', { class: 'tag', text: 'you' }) : null,
          h('div', { class: 'track', 'aria-label': `${row.wordsDone} of ${total} words written` }, [
            h('span', { class: 'finish-line', 'aria-hidden': 'true' }),
            h('span', {
              class: `bean${opts.jumpFor === row.playerId ? ' jump' : ''}`,
              style: `left:calc(${pct}% - ${pct / 100} * var(--bean))`,
              'aria-hidden': 'true',
              text: initial,
            }),
          ]),
          h('span', {
            class: 'muted',
            text: `${row.wordsDone} of ${total} word${total === 1 ? '' : 's'} written${row.wordsSkipped ? `, ${row.wordsSkipped} skipped` : ''}`,
          }),
        ]),
        row.finished ? h('span', { class: 'now fin', text: 'Done!' }) : h('span', { class: 'now' }),
      ]);
    })
  );
}
