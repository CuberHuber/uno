import { describe, expect, test } from 'vitest';
import { CLASSIC_RULES, RULES_CATALOG, sanitizeRules } from '../src/index.js';

describe('rules catalog', () => {
  test('covers every Rules key exactly once, defaults off', () => {
    const ids = RULES_CATALOG.map((r) => r.id).sort();
    expect(ids).toEqual(['drawToMatch', 'forcePlay', 'multiDiscard', 'stacking']);
    expect(RULES_CATALOG.every((r) => r.default === false)).toBe(true);
    expect(Object.keys(CLASSIC_RULES).sort()).toEqual(ids);
  });
  test('carries non-empty ru and en prose for every rule', () => {
    for (const r of RULES_CATALOG) {
      for (const loc of ['ru', 'en'] as const) {
        expect(r.title[loc].length).toBeGreaterThan(0);
        expect(r.tagline[loc].length).toBeGreaterThan(0);
        expect(r.details[loc].length).toBeGreaterThan(20);
      }
    }
  });
  test('sanitizeRules coerces partial junk to four booleans', () => {
    expect(sanitizeRules()).toEqual(CLASSIC_RULES);
    expect(sanitizeRules({ stacking: true })).toEqual({ ...CLASSIC_RULES, stacking: true });
  });
});
