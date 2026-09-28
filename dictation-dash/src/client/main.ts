// App entry. Three hash routes, one mount point, no framework.
//   #/            home (join a class race, practise alone, or make a room)
//   #/join/ABCD   home with the code filled in (the link the teacher shares)
//   #/room/ABCD   the room (teacher board, or the writing pad)
import './game.css';
import './styles.css';
import { renderHome } from './screens/home';
import { renderRoom } from './screens/room';
import { loadSeat } from './api';
import { screenFor } from './route';
import { setHeaderLink } from './ui';
import { newScreen, noteUserGesture } from './speech';

const root = document.querySelector<HTMLDivElement>('#app')!;
let cleanup: (() => void) | undefined;

// Nothing makes a sound before the first tap on the page; that tap unlocks the speaker.
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, noteUserGesture, { capture: true });

function route(): void {
  cleanup?.();
  cleanup = undefined;
  newScreen();
  root.className = '';
  setHeaderLink(true);
  const target = screenFor(window.location.hash, (code) => loadSeat(code) !== null);
  cleanup = target.screen === 'room' ? renderRoom(root, target.code) : renderHome(root, target.code);
}

window.addEventListener('hashchange', route);
route();
