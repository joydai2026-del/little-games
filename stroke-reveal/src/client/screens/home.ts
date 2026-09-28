// Home: a kid joins with a code and a name; a teacher pastes a word list and makes a room.
import { createRoom, joinRoom } from '../api';
import { parseWords } from '../../shared/parse';
import { GAME } from '../../shared/config';
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
    placeholder: 'Paste your words here. Numbers, pinyin and English are fine, we keep only the Chinese.\n\n1. 大人 dàrén grown-up\n2. 山 shān mountain',
    'aria-label': 'Word list',
  });
  const preview = h('div', { class: 'chips' });
  const previewNote = h('p', { class: 'muted' });
  const showPreview = () => {
    const parsed = parseWords(paste.value);
    preview.replaceChildren(...parsed.words.map((w) => h('span', { class: 'chip word', text: w })));
    const notes = [parsed.words.length ? `${parsed.words.length} word${parsed.words.length === 1 ? '' : 's'} found.` : ''];
    if (parsed.skipped.length) notes.push(`Skipped headings: ${parsed.skipped.join(' ')}`);
    previewNote.textContent = notes.filter(Boolean).join(' ');
  };
  paste.addEventListener('input', showPreview);
  const make = h('button', { class: 'btn btn-primary', text: 'Make a room' });
  make.addEventListener('click', async () => {
    teachError.textContent = '';
    if (paste.value.length > GAME.maxPasteLength) return void (teachError.textContent = `That paste is too long. Paste a shorter list (up to ${GAME.maxPasteLength} characters).`);
    if (parseWords(paste.value).words.length < 2) return void (teachError.textContent = 'Paste at least 2 Chinese words.');
    make.disabled = true;
    try {
      const data = await createRoom('Teacher', paste.value);
      window.location.hash = `#/room/${data.code}`;
    } catch (err) {
      teachError.textContent = (err as Error).message;
      make.disabled = false;
    }
  });

  const kidCard = h('section', { class: 'card' }, [h('h2', { text: 'Kids: join a game' }), h('label', { text: 'Room code' }), code, h('label', { text: 'Your name' }), name, h('p'), join, kidError]);
  const teacherCard = h('section', { class: 'card' }, [
    h('h2', { text: 'Teachers: start a game' }),
    h('p', { class: 'muted', text: 'Momo draws the first character of each word, one stroke at a time. Kids tap the right word on their phones. Faster right answers win more points.' }),
    paste,
    previewNote,
    preview,
    h('p'),
    make,
    teachError,
  ]);
  root.replaceChildren(brand('Guess the word before Momo finishes drawing!'), kidCard, teacherCard);
  (prefillCode ? name : code).focus();
  return () => {};
}
