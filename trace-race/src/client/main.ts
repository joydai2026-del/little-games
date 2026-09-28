// App entry. Three hash routes, one mount point, no framework.
//   #/            home (teacher makes a room, kid joins)
//   #/join/ABCD   home with the code filled in (the link the teacher shares)
//   #/room/ABCD   the room (teacher board or kid tracing pad)
import './theme.css';
import './styles.css';
import { renderHome } from './screens/home';
import { renderRoom } from './screens/room';
import { loadSeat } from './api';
import { screenFor } from './route';

const root = document.querySelector<HTMLDivElement>('#app')!;
let cleanup: (() => void) | undefined;

function route(): void {
  cleanup?.();
  cleanup = undefined;
  root.className = '';
  const target = screenFor(window.location.hash, (code) => loadSeat(code) !== null);
  cleanup = target.screen === 'room' ? renderRoom(root, target.code) : renderHome(root, target.code);
}

window.addEventListener('hashchange', route);
route();
