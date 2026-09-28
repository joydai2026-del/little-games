// Stroke data for the preview, fetched one character at a time from our own
// Worker (never a third-party CDN from the browser). Remembered per tab.

import { readStrokes } from '../shared/strokes';

const cache = new Map<string, Promise<string[] | null>>();

export function strokesFor(char: string): Promise<string[] | null> {
  const hit = cache.get(char);
  if (hit) return hit;
  const p = fetch(`/api/strokes/${encodeURIComponent(char)}`)
    .then(async (res) => {
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`strokes ${res.status}`);
      return readStrokes(await res.json());
    })
    .catch((err) => {
      // A network blip should not stick: forget it so the next keystroke retries.
      cache.delete(char);
      console.warn('stroke data unavailable for', char, err);
      return null;
    });
  cache.set(char, p);
  return p;
}
