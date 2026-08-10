import { describe, expect, test } from 'vitest';
import { isPlayable, type Card } from '../src/index.js';

const c = (color: Card['color'], value: Card['value'], id = 1): Card => ({ id, color, value });

describe('isPlayable', () => {
  const topRed7 = c('red', '7');

  test('same color matches', () => {
    expect(isPlayable(c('red', '3'), topRed7, 'red')).toBe(true);
  });
  test('same value different color matches', () => {
    expect(isPlayable(c('blue', '7'), topRed7, 'red')).toBe(true);
  });
  test('different color and value does not match', () => {
    expect(isPlayable(c('blue', '3'), topRed7, 'red')).toBe(false);
  });
  test('wild and wild4 always playable', () => {
    expect(isPlayable(c(null, 'wild'), topRed7, 'red')).toBe(true);
    expect(isPlayable(c(null, 'wild4'), topRed7, 'red')).toBe(true);
  });
  test('matches currentColor, not printed top color (after a wild)', () => {
    const topWild = c(null, 'wild');
    expect(isPlayable(c('green', '2'), topWild, 'green')).toBe(true);
    expect(isPlayable(c('red', '2'), topWild, 'green')).toBe(false);
  });
  test('symbol matches symbol across colors', () => {
    expect(isPlayable(c('blue', 'skip'), c('red', 'skip'), 'red')).toBe(true);
  });
});
