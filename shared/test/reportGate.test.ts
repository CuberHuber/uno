import { describe, expect, test } from 'vitest';
import { createReportGate } from '../src/index.js';

describe('createReportGate', () => {
  test('first report of a key passes', () => {
    const allow = createReportGate();
    expect(allow('render:TypeError: x is null')).toBe(true);
  });

  test('the same key is reported only once', () => {
    const allow = createReportGate();
    expect(allow('ws:disconnect')).toBe(true);
    expect(allow('ws:disconnect')).toBe(false);
    expect(allow('ws:disconnect')).toBe(false);
  });

  test('distinct keys pass until the session limit', () => {
    const allow = createReportGate(3);
    expect(allow('a')).toBe(true);
    expect(allow('b')).toBe(true);
    expect(allow('c')).toBe(true);
    expect(allow('d')).toBe(false);
  });

  test('a duplicate does not consume the limit', () => {
    const allow = createReportGate(2);
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    expect(allow('b')).toBe(true);
  });

  test('default limit is 10 unique reports', () => {
    const allow = createReportGate();
    for (let i = 0; i < 10; i += 1) expect(allow(`err-${i}`)).toBe(true);
    expect(allow('err-10')).toBe(false);
  });
});
