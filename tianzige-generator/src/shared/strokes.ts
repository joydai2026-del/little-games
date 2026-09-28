// Stroke data as the sheet needs it: SVG path strings, one per stroke, in
// writing order, in the Make Me a Hanzi 1024-unit box (y axis pointing up).
// Source: hanzi-writer-data@2.0.1 via the Worker's /api/strokes/:char proxy.

export type StrokeMap = Map<string, string[] | null>;

/** Only path commands and numbers. Anything else is not stroke data. */
const PATH = /^[MLQCZ0-9 .-]+$/;
const MAX_STROKES = 80;
const MAX_PATH_LEN = 6000;

/** Returns the stroke paths, or null when the JSON is not valid stroke data. */
export function readStrokes(data: unknown): string[] | null {
  if (!data || typeof data !== 'object') return null;
  const strokes = (data as { strokes?: unknown }).strokes;
  if (!Array.isArray(strokes) || strokes.length === 0 || strokes.length > MAX_STROKES) return null;
  for (const s of strokes) {
    if (typeof s !== 'string' || s.length > MAX_PATH_LEN || !PATH.test(s)) return null;
  }
  return strokes as string[];
}

/** Exactly one Han code point. The only shape of key the proxy and the client accept. */
export function isSingleHan(value: string): boolean {
  return Array.from(value).length === 1 && /^\p{Script=Han}$/u.test(value);
}
