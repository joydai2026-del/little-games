// Room codes: short, typeable, no look-alike glyphs (no 0/O, 1/I).
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;

export function newRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  return code;
}

export function newPlayerId(): string {
  return crypto.randomUUID();
}
