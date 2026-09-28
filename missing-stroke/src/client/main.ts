// App entry. Four hash routes, one mount point, no framework.
//   #/            home (teacher makes a room or plays solo, kid joins)
//   #/join/ABCD   home with the code filled in (the link the teacher shares)
//   #/room/ABCD   the room (teacher board or kid drawing pad)
//   #/solo        solo game on this phone
import './game.css';
import './styles.css';
import { renderHome } from './screens/home';
import { renderRoom } from './screens/room';
import { loadSeat, netBackend } from './api';
import { screenFor } from './route';
import { hasSolo, soloBackend } from './solo';
import { setHeaderLink } from './ui';

const root = document.querySelector<HTMLDivElement>('#app')!;
let cleanup: (() => void) | undefined;

function route(): void {
  cleanup?.();
  cleanup = undefined;
  root.className = '';
  setHeaderLink(true);
  const target = screenFor(window.location.hash, (code) => loadSeat(code) !== null, hasSolo);
  if (target.screen === 'solo') {
    cleanup = renderRoom(root, soloBackend());
    return;
  }
  if (target.screen === 'room') {
    const seat = loadSeat(target.code);
    if (!seat) {
      window.location.hash = `#/join/${target.code}`;
      return;
    }
    cleanup = renderRoom(root, netBackend(target.code, seat));
    return;
  }
  cleanup = renderHome(root, target.code);
}

window.addEventListener('hashchange', route);
route();
