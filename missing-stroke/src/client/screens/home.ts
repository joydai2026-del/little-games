// Home: a kid joins with a code and a name; a teacher (or a kid alone) pastes a
// list, picks who is playing, and makes a class room or plays solo.
import { createRoom, joinRoom } from '../api';
import { parseCharList } from '../../shared/parse';
import { DEFAULT_OPTIONS, GAME, LEVELS, LEVEL_ORDER, type Level } from '../../shared/config';
import { soloList, startSolo } from '../solo';
import { brand, h } from '../ui';

export function renderHome(root: HTMLElement, prefillCode: string): () => void {
  const kidError = h('p', { class: 'error', role: 'status' });
  const code = h('input', { class: 'code', maxlength: 4, placeholder: 'CODE', autocomplete: 'off', value: prefillCode, 'aria-label': 'Room code' });
  const name = h('input', { maxlength: GAME.maxNameLength, placeholder: 'Your first name', autocomplete: 'off', 'aria-label': 'Your name' });
  const join = h('button', { class: 'btn btn-primary', text: 'Join the game' });
  join.addEventListener('click', async () => {
    kidError.textContent = '';
    const c = code.value.toUpperCase().trim();
    if (c.length !== 4) return void (kidError.textContent = 'The code has 4 letters or numbers.');
    if (!name.value.trim()) return void (kidError.textContent = 'Type your name first.');
    join.disabled = true;
    try {
      await joinRoom(c, name.value);
      window.location.hash = `#/room/${c}`;
    } catch (err) {
      kidError.textContent = (err as Error).message;
      join.disabled = false;
    }
  });

  const teachError = h('p', { class: 'error', role: 'status' });
  const paste = h('textarea', {
    placeholder: 'Paste your characters here. Numbers, pinyin and English are fine, we keep only the characters.\n\n1. 山 shān mountain\n2. 水 shuǐ water',
    'aria-label': 'Character list',
  });
  const preview = h('div', { class: 'chips' });
  const previewNote = h('p', { class: 'muted' });
  const showPreview = () => {
    const parsed = parseCharList(paste.value);
    preview.replaceChildren(...parsed.chars.map((c) => h('span', { class: 'chip', text: c })));
    previewNote.textContent = parsed.chars.length ? `${parsed.chars.length} character${parsed.chars.length === 1 ? '' : 's'} found.` : '';
  };
  paste.addEventListener('input', showPreview);

  let level: Level = DEFAULT_OPTIONS.level;
  const levels = h('div', { class: 'levels', role: 'radiogroup', 'aria-label': 'Who is playing?' });
  const drawLevels = () =>
    levels.replaceChildren(
      ...LEVEL_ORDER.map((l) => {
        const b = h('button', { class: `btn ${l === level ? 'btn-primary' : 'btn-secondary'} level`, role: 'radio', 'aria-checked': l === level ? 'true' : 'false', 'data-level': l }, [
          h('span', { class: 'level-name', text: LEVELS[l].label }),
          h('span', { class: 'level-sub', text: `${LEVELS[l].secondsPerChar} seconds each` }),
        ]);
        b.addEventListener('click', () => {
          level = l;
          drawLevels();
        });
        return b;
      })
    );
  drawLevels();

  const check = (): boolean => {
    teachError.textContent = '';
    if (paste.value.length > GAME.maxPasteLength) {
      teachError.textContent = `That paste is too long. Paste a shorter list (up to ${GAME.maxPasteLength} characters).`;
      return false;
    }
    if (parseCharList(paste.value).chars.length === 0) {
      teachError.textContent = 'Paste at least one Chinese character.';
      return false;
    }
    return true;
  };
  const make = h('button', { class: 'btn btn-primary', text: 'Make a class room' });
  const solo = h('button', { class: 'btn btn-secondary', text: 'Play by myself' });
  make.addEventListener('click', async () => {
    if (!check()) return;
    make.disabled = solo.disabled = true;
    try {
      const data = await createRoom('Teacher', paste.value, { level });
      window.location.hash = `#/room/${data.code}`;
    } catch (err) {
      teachError.textContent = (err as Error).message;
      make.disabled = solo.disabled = false;
    }
  });
  solo.addEventListener('click', async () => {
    if (!check()) return;
    make.disabled = solo.disabled = true;
    solo.textContent = 'Getting the strokes...';
    try {
      const list = await soloList(paste.value);
      if (list.chars.length === 0) throw new Error('We do not have strokes for those characters yet.');
      startSolo(list, { level, charsPerRound: DEFAULT_OPTIONS.charsPerRound });
      window.location.hash = '#/solo';
    } catch (err) {
      teachError.textContent = (err as Error).message;
      make.disabled = solo.disabled = false;
      solo.textContent = 'Play by myself';
    }
  });

  const kidCard = h('section', { class: 'card' }, [h('h2', { text: 'Kids: join a game' }), h('label', { text: 'Room code' }), code, h('label', { text: 'Your name' }), name, h('p'), join, kidError]);
  const teacherCard = h('section', { class: 'card' }, [
    h('h2', { text: 'Teachers: start a game' }),
    paste,
    previewNote,
    preview,
    h('label', { text: 'Who is playing?' }),
    levels,
    h('p'),
    make,
    h('p'),
    solo,
    teachError,
  ]);
  root.replaceChildren(brand('Momo forgot one stroke. Draw it first!'), kidCard, teacherCard);
  (prefillCode ? name : code).focus();
  return () => {};
}
