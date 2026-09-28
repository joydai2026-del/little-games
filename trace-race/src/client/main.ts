// App entry. Three hash routes, one mount point, no framework.
//   #/            home (teacher makes a room, kid joins)
//   #/join/ABCD   home with the code filled in (the link the teacher shares)
//   #/room/ABCD   the room (teacher board or kid tracing pad)
import './theme.css';
import './styles.css';
import { renderHome } from './screens/home';
import { renderRoom } from './screens/room';

const root = document.querySelector<HTMLDivElement>('#app')!;
let cleanup: (() => void) | undefined;

function route(): void {
  cleanup?.();
  cleanup = undefined;
  root.className = '';
  const parts = window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const code = (parts[1] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (parts[0] === 'room' && code.length === 4) cleanup = renderRoom(root, code);
  else cleanup = renderHome(root, parts[0] === 'join' ? code : '');
}

window.addEventListener('hashchange', route);
route();
