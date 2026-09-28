// Home: a kid joins a class race with a code; a kid (or a parent) practises
// alone; a teacher pastes this week's list and makes a room.
import { act, createRoom, joinRoom } from '../api';
import { parseWordList } from '../../shared/parse';
import { DEFAULT_OPTIONS, GAME, type Level } from '../../shared/config';
import { brand, h, levelPicker } from '../ui';

const PLACEHOLDER = 'Paste this week\'s words here. Numbers, pinyin and English are fine, we keep only the Chinese words.\n\n1. 朋友 péngyou friend\n2. 学校 xuéxiào school';

function pasteBox(label: string): { box: HTMLTextAreaElement; preview: HTMLElement; note: HTMLElement } {
  const box = h('textarea', { placeholder: PLACEHOLDER, 'aria-label': label });
  const preview = h('div', { class: 'chips' });
  const note = h('p', { class: 'muted' });
  box.addEventListener('input', () => {
    const parsed = parseWordList(box.value);
    preview.replaceChildren(...parsed.words.map((w) => h('span', { class: 'chip', text: w })));
    const extra = parsed.tooLong.length ? ` ${parsed.tooLong.length} too long (over ${GAME.maxWordChars} characters), left out.` : '';
    note.textContent = parsed.words.length ? `${parsed.words.length} word${parsed.words.length === 1 ? '' : 's'} found.${extra}` : extra.trim();
  });
  return { box, preview, note };
}

function checkPaste(text: string): string | null {
  if (text.length > GAME.maxPasteLength) return `That paste is too long. Paste a shorter list (up to ${GAME.maxPasteLength} characters).`;
  if (parseWordList(text).words.length === 0) return 'Paste at least one Chinese word.';
  return null;
}

export function renderHome(root: HTMLElement, prefillCode: string): () => void {
  // Kids: join a class race.
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

  // Practise alone: the same two level buttons as the teacher's.
  const soloError = h('p', { class: 'error', role: 'status' });
  const solo = pasteBox('Words to practise');
  let level: Level = DEFAULT_OPTIONS.level;
  const pickerSlot = h('div');
  const paintPicker = () => pickerSlot.replaceChildren(levelPicker(level, (l) => ((level = l), paintPicker())));
  paintPicker();
  const practise = h('button', { class: 'btn btn-primary', text: 'Start practice' });
  practise.addEventListener('click', async () => {
    soloError.textContent = '';
    const problem = checkPaste(solo.box.value);
    if (problem) return void (soloError.textContent = problem);
    practise.disabled = true;
    try {
      const data = await createRoom(solo.box.value, 'solo', { level });
      await act(data.code, { playerId: data.playerId, playerSecret: data.playerSecret }, 'start');
      window.location.hash = `#/room/${data.code}`;
    } catch (err) {
      soloError.textContent = (err as Error).message;
      practise.disabled = false;
    }
  });

  // Teachers: make a class room.
  const teachError = h('p', { class: 'error', role: 'status' });
  const teach = pasteBox('Word list');
  const make = h('button', { class: 'btn btn-primary', text: 'Make a room' });
  make.addEventListener('click', async () => {
    teachError.textContent = '';
    const problem = checkPaste(teach.box.value);
    if (problem) return void (teachError.textContent = problem);
    make.disabled = true;
    try {
      const data = await createRoom(teach.box.value, 'class');
      window.location.hash = `#/room/${data.code}`;
    } catch (err) {
      teachError.textContent = (err as Error).message;
      make.disabled = false;
    }
  });

  root.replaceChildren(
    brand('Momo says a word. You write it from memory. For grades 3 to 5.'),
    h('section', { class: 'card' }, [h('h2', { text: 'Kids: join a class race' }), h('label', { text: 'Room code' }), code, h('label', { text: 'Your name' }), name, h('p'), join, kidError]),
    h('section', { class: 'card' }, [h('h2', { text: 'Practise on my own' }), solo.box, solo.note, solo.preview, h('h3', { text: 'Pick the level' }), pickerSlot, h('p'), practise, soloError]),
    h('section', { class: 'card' }, [h('h2', { text: 'Teachers: start a class race' }), teach.box, teach.note, teach.preview, h('p', { class: 'muted', text: 'You pick Easy or Hard in the next step.' }), make, teachError])
  );
  (prefillCode ? name : code).focus();
  return () => {};
}
