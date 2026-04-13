'use strict';

import { rampValueToInteger, toInteger } from './Ramp.ts';

describe('toInteger', () => {
  it('converts number input', () => {
    expect(toInteger(60)).toBe(60);
    expect(toInteger(60.4)).toBe(60);
    expect(toInteger(60.6)).toBe(61);
  });

  it('converts string input', () => {
    expect(toInteger('20')).toBe(20);
    expect(toInteger('20.5')).toBe(21);
  });

  it('returns null for invalid input', () => {
    expect(toInteger('abc')).toBeNull();
    expect(toInteger(undefined)).toBeNull();
  });
});

describe('rampValueToInteger', () => {
  it('maps 100 to x and 0 to y', () => {
    expect(rampValueToInteger(100, 60, 20)).toBe(60);
    expect(rampValueToInteger(0, 60, 20)).toBe(20);
  });

  it('maps linearly in between', () => {
    expect(rampValueToInteger(50, 60, 20)).toBe(40);
    expect(rampValueToInteger(75, 60, 20)).toBe(50);
    expect(rampValueToInteger(25, 60, 20)).toBe(30);
  });

  it('works with increasing range y->x', () => {
    expect(rampValueToInteger(100, 20, 60)).toBe(20);
    expect(rampValueToInteger(0, 20, 60)).toBe(60);
    expect(rampValueToInteger(50, 20, 60)).toBe(40);
  });

  it('clamps input to 0..100', () => {
    expect(rampValueToInteger(120, 60, 20)).toBe(60);
    expect(rampValueToInteger(-10, 60, 20)).toBe(20);
  });

  it('returns null for invalid args', () => {
    expect(rampValueToInteger('abc', 60, 20)).toBeNull();
    expect(rampValueToInteger(50, 'x', 20)).toBeNull();
    expect(rampValueToInteger(50, 60, null)).toBeNull();
  });
});

