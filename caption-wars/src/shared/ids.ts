// Id generation. Room codes are short and human-typeable (no ambiguous
// glyphs like 0/O or 1/I/L); player and caption ids are opaque UUIDs.

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;

/** A 4-character room code, e.g. "K7QM". Not guaranteed unique; the caller retries on collision. */
export function newRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.floor(random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[idx];
  }
  return code;
}

export function newPlayerId(): string {
  return crypto.randomUUID();
}

export function newCaptionId(): string {
  return crypto.randomUUID();
}
