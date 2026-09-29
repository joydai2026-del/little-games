// The Avery header must never pull a kid out of a live round.
import { afterEach, describe, expect, it } from 'vitest';
import mainSrc from '../src/client/main.ts?raw';
import { headerLinkOn } from '../src/client/route';
import { setHeaderLink } from '../src/client/ui';

const kidState = (phase: 'lobby' | 'playing' | 'done', inRound: boolean) => ({ role: 'kid' as const, phase, inRound });

describe('headerLinkOn', () => {
  it('a kid in the round while playing gets a plain header', () => {
    expect(headerLinkOn(kidState('playing', true) as never)).toBe(false);
  });
  it('a late kid (joined after Start) keeps the link', () => {
    expect(headerLinkOn(kidState('playing', false) as never)).toBe(true);
  });
  it('the teacher keeps the link, even while playing', () => {
    expect(headerLinkOn({ role: 'teacher', phase: 'playing', inRound: false } as never)).toBe(true);
  });
  it('lobby and done keep the link', () => {
    expect(headerLinkOn(kidState('lobby', true) as never)).toBe(true);
    expect(headerLinkOn(kidState('done', true) as never)).toBe(true);
  });
});

describe('setHeaderLink', () => {
  const g = globalThis as { document?: unknown };
  afterEach(() => void delete g.document);

  function fakeHeader() {
    const attrs = new Map<string, string>([['href', '/'], ['aria-label', 'Avery Studio home']]);
    const a = {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
      getAttribute: (k: string) => attrs.get(k) ?? null,
    };
    g.document = { querySelector: (sel: string) => (sel === '.avery-header a' ? a : null) };
    return a;
  }

  it('drops the href (plain text) and the route reset restores it', () => {
    const a = fakeHeader();
    setHeaderLink(false);
    expect(a.getAttribute('href')).toBeNull();
    expect(a.getAttribute('aria-label')).toBeNull();
    setHeaderLink(true);
    expect(a.getAttribute('href')).toBe('/');
    expect(a.getAttribute('aria-label')).toBe('Avery Studio home');
  });

  it('is a no-op on a page without the header', () => {
    g.document = { querySelector: () => null };
    expect(() => setHeaderLink(false)).not.toThrow();
  });

  it('every route change restores the link before a screen renders (main.ts)', () => {
    const route = mainSrc.slice(mainSrc.indexOf('function route()'));
    const reset = route.indexOf('setHeaderLink(true)');
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(route.indexOf('renderRoom('));
    expect(reset).toBeLessThan(route.indexOf('renderHome('));
  });
});
