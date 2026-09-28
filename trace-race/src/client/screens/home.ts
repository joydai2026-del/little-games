// Home: a kid joins with a code and a name; a teacher pastes a list and makes a room.
import { createRoom, joinRoom } from '../api';
import { parseCharList } from '../../shared/parse';
import { GAME } from '../../shared/config';
import { brand, h } from '../ui';

export function renderHome(root: HTMLElement, prefillCode: string): () => void {
  const kidError = h('p', { class: 'error', role: 'status' });
  const code = h('input', { class: 'code', maxlength: 4, placeholder: 'CODE', autocomplete: 'off', value: prefillCode, 'aria-label': 'Room code' });
  const name = h('input', { maxlength: GAME.maxNameLength, placeholder: 'Your first name', autocomplete: 'off', 'aria-label': 'Your name' });
  const join = h('button', { class: 'btn btn-primary', text: 'Join the race' });
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
    placeholder: 'Paste your characters here. Numbers, pinyin and English are fine, we keep only the characters.\n\n1. 人 rén person\n2. 大 dà big',
    'aria-label': 'Character list',
  });
  const preview = h('div', { class: 'chips' });
  const previewNote = h('p', { class: 'muted' });
  const showPreview = () => {
    const parsed = parseCharList(paste.value);
    preview.replaceChildren(...parsed.chars.map((c) => h('span', { class: 'chip', text: c })));
    previewNote.textContent = parsed.chars.length
      ? `${parsed.chars.length} character${parsed.chars.length === 1 ? '' : 's'} found.`
      : '';
  };
  paste.addEventListener('input', showPreview);
  const make = h('button', { class: 'btn btn-primary', text: 'Make a room' });
  make.addEventListener('click', async () => {
    teachError.textContent = '';
    if (paste.value.length > GAME.maxPasteLength) return void (teachError.textContent = `That paste is too long. Paste a shorter list (up to ${GAME.maxPasteLength} characters).`);
    if (parseCharList(paste.value).chars.length === 0) return void (teachError.textContent = 'Paste at least one Chinese character.');
    make.disabled = true;
    try {
      const data = await createRoom('Teacher', paste.value);
      window.location.hash = `#/room/${data.code}`;
    } catch (err) {
      teachError.textContent = (err as Error).message;
      make.disabled = false;
    }
  });

  const kidCard = h('section', { class: 'card' }, [h('h2', { text: 'Kids: join a race' }), h('label', { text: 'Room code' }), code, h('label', { text: 'Your name' }), name, h('p'), join, kidError]);
  const teacherCard = h('section', { class: 'card' }, [
    h('h2', { text: 'Teachers: start a race' }),
    paste,
    previewNote,
    preview,
    h('p'),
    make,
    teachError,
  ]);
  root.replaceChildren(
    brand('Write it fast, write it right.'),
    ...(prefillCode ? [kidCard, teacherCard] : [kidCard, teacherCard])
  );
  (prefillCode ? name : code).focus();
  return () => {};
}
