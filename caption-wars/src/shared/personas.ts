// Bot personas: fixed personality + a one-line style prompt used to steer the
// vision model's caption and the text model's vote. Config, not game logic,
// per docs/plans/2026-09-07-mvp-plan.md ("bot personas" row).

export interface Persona {
  id: string;
  name: string;
  style: string;
}

export const PERSONAS: Persona[] = [
  {
    id: 'daisy-deadpan',
    name: 'Daisy Deadpan',
    style: 'Write a flat, deadpan one-liner, like the photo is the most boring thing you have ever seen.',
  },
  {
    id: 'chaos-chip',
    name: 'Chaos Chip',
    style: 'Write an unhinged, chaotic caption that goes for the most absurd angle on the photo.',
  },
  {
    id: 'sunny-wholesome',
    name: 'Sunny Wholesome',
    style: 'Write a wholesome, sweet caption that finds the most heartwarming detail in the photo.',
  },
  {
    id: 'dramatic-rex',
    name: 'Dramatic Rex',
    style: 'Write an over-the-top dramatic caption, like the photo is a scene from a soap opera.',
  },
];

/** Deterministic pick of the first N personas for a room's bot roster. */
export function pickPersonas(count: number): Persona[] {
  return PERSONAS.slice(0, Math.max(0, Math.min(count, PERSONAS.length)));
}
