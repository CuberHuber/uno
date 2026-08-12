import { describe, expect, test } from 'vitest';
import { RateLimiter } from '../src/limiter.js';

describe('fixed-window rate limiter', () => {
  test('allows max hits per window, then blocks', () => {
    let t = 0;
    const lim = new RateLimiter(3, 60_000, () => t);
    expect(lim.allow('a')).toBe(true);
    expect(lim.allow('a')).toBe(true);
    expect(lim.allow('a')).toBe(true);
    expect(lim.allow('a')).toBe(false);
    expect(lim.allow('b')).toBe(true); // keys are independent
  });
  test('window expiry resets the count', () => {
    let t = 0;
    const lim = new RateLimiter(1, 60_000, () => t);
    expect(lim.allow('a')).toBe(true);
    expect(lim.allow('a')).toBe(false);
    t = 60_001;
    expect(lim.allow('a')).toBe(true);
  });
  test('blocked() peeks without counting; hit() counts without answering', () => {
    let t = 0;
    const lim = new RateLimiter(2, 60_000, () => t);
    expect(lim.blocked('a')).toBe(false);
    lim.hit('a'); lim.hit('a');
    expect(lim.blocked('a')).toBe(true);
  });
  test('sweep drops expired windows', () => {
    let t = 0;
    const lim = new RateLimiter(1, 60_000, () => t);
    lim.hit('a');
    t = 60_001;
    lim.sweep();
    expect(lim.blocked('a')).toBe(false);
  });
});
