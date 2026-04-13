'use strict';

import { rampValueToRange, toNumber } from './Ramp.ts';

describe('toNumber', () => {
  it('converts number input', () => {
    expect(toNumber(0.6)).toBe(0.6);
    expect(toNumber(1)).toBe(1);
  });

  it('converts string input', () => {
    expect(toNumber('0.2')).toBe(0.2);
    expect(toNumber('1')).toBe(1);
  });

  it('returns null for invalid input', () => {
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

describe('rampValueToRange', () => {
  it('maps 100 to x and 0 to y', () => {
    expect(rampValueToRange(100, 1, 0.2)).toBe(1);
    expect(rampValueToRange(0, 1, 0.2)).toBe(0.2);
  });

  it('maps linearly in between', () => {
    expect(rampValueToRange(50, 1, 0.2)).toBe(0.6);
    expect(rampValueToRange(75, 1, 0.2)).toBe(0.8);
    expect(rampValueToRange(25, 1, 0.2)).toBe(0.4);
  });

  it('works with increasing range y->x', () => {
    expect(rampValueToRange(100, 0.2, 1)).toBe(0.2);
    expect(rampValueToRange(0, 0.2, 1)).toBe(1);
    expect(rampValueToRange(50, 0.2, 1)).toBe(0.6);
  });

  it('clamps input to 0..100', () => {
    expect(rampValueToRange(120, 1, 0.2)).toBe(1);
    expect(rampValueToRange(-10, 1, 0.2)).toBe(0.2);
  });

  it('clamps x and y to 0..1', () => {
    expect(rampValueToRange(100, 2, -1)).toBe(1);
    expect(rampValueToRange(0, 2, -1)).toBe(0);
  });

  it('returns null for invalid args', () => {
    expect(rampValueToRange('abc', 1, 0.2)).toBeNull();
    expect(rampValueToRange(50, 'x', 0.2)).toBeNull();
    expect(rampValueToRange(50, 1, null)).toBeNull();
  });
});

