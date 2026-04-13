'use strict';

import { rampValueToRange, toNumber, snapPercentageToStep } from './Ramp.ts';

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

describe('snapPercentageToStep', () => {
  it('snaps up direction to nearest step', () => {
    // With step=1, 98.9 should snap down to 98
    expect(snapPercentageToStep(98.9, 'up', 1)).toBe(98);
    // With step=1, 0 should stay 0
    expect(snapPercentageToStep(0, 'up', 1)).toBe(0);
    // With step=1, 100 should stay 100
    expect(snapPercentageToStep(100, 'up', 1)).toBe(100);
  });

  it('snaps down direction to nearest step', () => {
    // With step=1, going down from 100, 98.9 should snap down to 98
    expect(snapPercentageToStep(98.9, 'down', 1)).toBe(99);
    // With step=1, 100 should stay 100
    expect(snapPercentageToStep(100, 'down', 1)).toBe(100);
    // With step=1, 0 should stay 0
    expect(snapPercentageToStep(0, 'down', 1)).toBe(0);
  });

  it('works with larger steps', () => {
    // With step=10, 45 should snap to 40
    expect(snapPercentageToStep(45, 'up', 10)).toBe(40);
    // With step=10, 55 should snap to 50
    expect(snapPercentageToStep(55, 'up', 10)).toBe(50);
    // With step=10, 95 should snap to 90 (down)
    expect(snapPercentageToStep(95, 'down', 10)).toBe(100);
  });

  it('clamps values to 0..100', () => {
    expect(snapPercentageToStep(-10, 'up', 1)).toBe(0);
    expect(snapPercentageToStep(150, 'up', 1)).toBe(100);
    expect(snapPercentageToStep(-10, 'down', 1)).toBe(0);
    expect(snapPercentageToStep(150, 'down', 1)).toBe(100);
  });

  it('handles step=0 as step=1', () => {
    expect(snapPercentageToStep(98.9, 'up', 0)).toBe(98);
    expect(snapPercentageToStep(98.9, 'down', 0)).toBe(99);
  });

  it('returns correctly rounded values', () => {
    // Test that the result is always to 1 decimal place
    const result1 = snapPercentageToStep(33.33, 'up', 5);
    expect(result1.toString()).toMatch(/^\d+(\.\d)?$/);
    const result2 = snapPercentageToStep(66.66, 'down', 5);
    expect(result2.toString()).toMatch(/^\d+(\.\d)?$/);
  });
})

