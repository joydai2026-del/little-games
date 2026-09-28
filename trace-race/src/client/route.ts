// Which screen a hash shows. Pure, so it is unit-tested.
//   #/            home
//   #/join/ABCD   home with the code filled in, UNLESS this phone already has a
//                 seat in ABCD: then straight back into the room, so a kid who
//                 reopens the teacher's link mid-race keeps their place instead
//                 of joining again as a new player behind the frozen roster.
//   #/room/ABCD   the room
export type Screen = { screen: 'home'; code: string } | { screen: 'room'; code: string };

export function screenFor(hash: string, hasSeat: (code: string) => boolean): Screen {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const code = (parts[1] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (parts[0] === 'room' && code.length === 4) return { screen: 'room', code };
  if (parts[0] === 'join' && code.length === 4 && hasSeat(code)) return { screen: 'room', code };
  return { screen: 'home', code: parts[0] === 'join' ? code : '' };
}

/**
 * Goes to `hash` and re-runs routing even when the page is already there.
 * Setting location.hash to its current value fires no hashchange, which left
 * "Join again" on a stale seat as a dead link: the phone already sat on
 * #/join/CODE (rendered as the room because of the old seat).
 */
export function goTo(hash: string, win: { location: { hash: string }; dispatchEvent(e: Event): boolean }, makeEvent: () => Event): void {
  const next = hash.startsWith('#') ? hash : `#${hash}`;
  if (win.location.hash === next) win.dispatchEvent(makeEvent());
  else win.location.hash = next;
}
