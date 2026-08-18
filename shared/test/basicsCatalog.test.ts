import { describe, expect, test } from 'vitest';
import { BASICS_CATALOG } from '../src/index.js';

describe('basics catalog', () => {
  test('covers the six base rules exactly once', () => {
    const ids = BASICS_CATALOG.map((b) => b.id);
    expect([...ids].sort()).toEqual(['actions', 'draw', 'lastCard', 'match', 'opening', 'wilds']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('carries non-empty ru and en prose for every entry', () => {
    for (const b of BASICS_CATALOG) {
      for (const loc of ['ru', 'en'] as const) {
        expect(b.title[loc].length).toBeGreaterThan(0);
        expect(b.tagline[loc].length).toBeGreaterThan(0);
        expect(b.details[loc].length).toBeGreaterThan(40);
      }
    }
  });

  test('taglines stay one short line — the slide shows ten of them at once', () => {
    for (const b of BASICS_CATALOG) {
      for (const loc of ['ru', 'en'] as const) {
        expect(b.tagline[loc]).not.toContain('\n');
        expect(b.tagline[loc].length).toBeLessThanOrEqual(70);
      }
    }
  });

  test('the opening entry states the number-only rule and names the departure', () => {
    const opening = BASICS_CATALOG.find((b) => b.id === 'opening');
    expect(opening).toBeDefined();
    // A UNO veteran will notice first-flip effects are missing and assume a bug,
    // so this entry has to say both what we do and that official UNO differs.
    expect(opening!.tagline.en.toLowerCase()).toContain('number');
    expect(opening!.details.en.toLowerCase()).toContain('official uno');
    expect(opening!.tagline.ru.toLowerCase()).toContain('числов');
    expect(opening!.details.ru.toLowerCase()).toContain('официальн');
  });
});
