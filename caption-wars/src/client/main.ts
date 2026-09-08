// App entry. Two routes, one mount point, no framework.

import './styles.css';

import { startRouter, type Route } from './router';
import { normalizeCode } from './state';
import { renderHome } from './screens/home';
import { renderRoom } from './screens/room';
import { h, notice, page } from './ui';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app is missing from index.html');

let cleanup: (() => void) | undefined;

function showMessage(title: string, message: string): void {
  const { root: shell, body } = page(title, { back: '#/' });
  body.append(
    notice(message, 'warn'),
    h('p', {}, [h('a', { href: '#/', text: 'Start again' })])
  );
  root!.replaceChildren(shell);
}

function route(current: Route): void {
  cleanup?.();
  cleanup = undefined;

  const [first, second] = current.parts;

  if (!first) {
    cleanup = renderHome(root!);
    return;
  }

  if (first === 'room' && second) {
    const code = normalizeCode(second);
    if (code.length !== 4) {
      showMessage('Bad link', 'A room code is 4 letters or numbers. Ask the host for the link again.');
      return;
    }
    cleanup = renderRoom(root!, code);
    return;
  }

  showMessage('Page not found', 'That link does not point at anything here.');
}

startRouter(route);
