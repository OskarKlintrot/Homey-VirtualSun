'use strict';

import {
  computeSunValue,
  localMinutesNow,
  normalizeDirection,
  parseTimeToMinutes,
} from './SunValue.ts';

function makeDate(hours: number, minutes: number, seconds = 0): Date {
  const d = new Date(2024, 0, 1, hours, minutes, seconds);
  return d;
}

describe('parseTimeToMinutes', () => {
  it('converts "00:00" to 0', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
  });

  it('converts "08:00" to 480', () => {
    expect(parseTimeToMinutes('08:00')).toBe(480);
  });

  it('converts "23:59" to 1439', () => {
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  it('converts "HH:mm:ss" to minutes', () => {
    expect(parseTimeToMinutes('08:30:59')).toBe(510);
  });

  it('converts object time to minutes', () => {
    expect(parseTimeToMinutes({ hour: 8, minute: 30 })).toBe(510);
  });

  it('converts object time with string values to minutes', () => {
    expect(parseTimeToMinutes({ hour: '8', minute: '30' })).toBe(510);
  });

  it('converts nested time value object to minutes', () => {
    expect(parseTimeToMinutes({ value: '08:30' })).toBe(510);
  });

  it('returns null for invalid time input', () => {
    expect(parseTimeToMinutes('invalid')).toBeNull();
  });

  it('returns null for out-of-range time', () => {
    expect(parseTimeToMinutes('24:00')).toBeNull();
    expect(parseTimeToMinutes({ hour: 23, minute: 61 })).toBeNull();
  });
});

describe('normalizeDirection', () => {
  it('returns direction for string values', () => {
    expect(normalizeDirection('up')).toBe('up');
    expect(normalizeDirection('down')).toBe('down');
  });

  it('returns direction for object values', () => {
    expect(normalizeDirection({ id: 'up' })).toBe('up');
    expect(normalizeDirection({ value: 'down' })).toBe('down');
  });

  it('defaults to down for invalid input', () => {
    expect(normalizeDirection(undefined)).toBe('down');
    expect(normalizeDirection({ id: 'invalid' })).toBe('down');
  });
});

describe('localMinutesNow', () => {
  it('returns hours*60 + minutes + seconds/60', () => {
    const d = makeDate(8, 30, 30);
    const expected = 8 * 60 + 30 + 30 / 60;
    expect(localMinutesNow(d)).toBeCloseTo(expected, 5);
  });

  it('supports explicit timezone', () => {
    const d = new Date('2024-01-01T08:30:30.000Z');
    const expected = 8 * 60 + 30 + 30 / 60;
    expect(localMinutesNow(d, 'UTC')).toBeCloseTo(expected, 5);
  });
});

describe('computeSunValue', () => {
  it('returns 100.0 at exact start time', () => {
    const now = makeDate(8, 0, 0);
    expect(computeSunValue(now, '08:00', '20:00')).toBe(100.0);
  });

  it('returns 0.0 at exact end time', () => {
    const now = makeDate(20, 0, 0);
    expect(computeSunValue(now, '08:00', '20:00')).toBe(0.0);
  });

  it('returns null before start time', () => {
    const now = makeDate(7, 59, 59);
    expect(computeSunValue(now, '08:00', '20:00')).toBeNull();
  });

  it('returns null after end time', () => {
    const now = makeDate(20, 0, 1);
    expect(computeSunValue(now, '08:00', '20:00')).toBeNull();
  });

  it('returns 50.0 at midpoint', () => {
    const now = makeDate(14, 0, 0);
    expect(computeSunValue(now, '08:00', '20:00')).toBe(50.0);
  });

  it('returns value rounded to one decimal place', () => {
    const now = makeDate(8, 1, 0);
    const result = computeSunValue(now, '08:00', '20:00');
    expect(result).not.toBeNull();
    const str = result!.toString();
    const decimalPart = str.includes('.') ? str.split('.')[1] : '';
    expect(decimalPart.length).toBeLessThanOrEqual(1);
  });

  it('returns null when endTime equals startTime', () => {
    const now = makeDate(8, 0, 0);
    expect(computeSunValue(now, '08:00', '08:00')).toBeNull();
  });

  it('returns null when endTime is before startTime', () => {
    const now = makeDate(10, 0, 0);
    expect(computeSunValue(now, '20:00', '08:00')).toBeNull();
  });

  it('decreases linearly over time', () => {
    const v1 = computeSunValue(makeDate(8, 0, 0), '08:00', '20:00')!;
    const v2 = computeSunValue(makeDate(10, 0, 0), '08:00', '20:00')!;
    const v3 = computeSunValue(makeDate(12, 0, 0), '08:00', '20:00')!;
    const v4 = computeSunValue(makeDate(14, 0, 0), '08:00', '20:00')!;

    expect(v1).toBeGreaterThan(v2);
    expect(v2).toBeGreaterThan(v3);
    expect(v3).toBeGreaterThan(v4);

    const diff12 = v1 - v2;
    const diff23 = v2 - v3;
    const diff34 = v3 - v4;

    // Rounding to 1 decimal can shift each difference by up to 0.1 in either direction
    expect(Math.abs(diff12 - diff23)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(diff23 - diff34)).toBeLessThanOrEqual(0.2);
  });

  it('produces steps of 0.1% for appropriate time intervals', () => {
    const totalMinutes = 10 * 60;
    const minutesPerStep = totalMinutes / 1000;

    const t1 = makeDate(8, 0, 0);
    const t2 = new Date(t1.getTime() + minutesPerStep * 60 * 1000);

    const v1 = computeSunValue(t1, '08:00', '18:00')!;
    const v2 = computeSunValue(t2, '08:00', '18:00')!;

    expect(Math.round((v1 - v2) * 10) / 10).toBeCloseTo(0.1, 5);
  });

  it('increases linearly when direction is up', () => {
    const v1 = computeSunValue(makeDate(8, 0, 0), '08:00', '20:00', 'up')!;
    const v2 = computeSunValue(makeDate(10, 0, 0), '08:00', '20:00', 'up')!;
    const v3 = computeSunValue(makeDate(12, 0, 0), '08:00', '20:00', 'up')!;

    expect(v1).toBeLessThan(v2);
    expect(v2).toBeLessThan(v3);
    expect(v1).toBe(0.0);
    expect(computeSunValue(makeDate(20, 0, 0), '08:00', '20:00', 'up')).toBe(100.0);
  });

  it('supports intervals that cross midnight in down mode', () => {
    expect(computeSunValue(makeDate(22, 0, 0), '22:00', '06:00', 'down')).toBe(100.0);
    expect(computeSunValue(makeDate(2, 0, 0), '22:00', '06:00', 'down')).toBe(50.0);
    expect(computeSunValue(makeDate(6, 0, 0), '22:00', '06:00', 'down')).toBe(0.0);
  });

  it('supports intervals that cross midnight in up mode', () => {
    expect(computeSunValue(makeDate(22, 0, 0), '22:00', '06:00', 'up')).toBe(0.0);
    expect(computeSunValue(makeDate(2, 0, 0), '22:00', '06:00', 'up')).toBe(50.0);
    expect(computeSunValue(makeDate(6, 0, 0), '22:00', '06:00', 'up')).toBe(100.0);
  });

  it('returns null outside midnight-crossing interval', () => {
    expect(computeSunValue(makeDate(12, 0, 0), '22:00', '06:00', 'down')).toBeNull();
    expect(computeSunValue(makeDate(21, 59, 59), '22:00', '06:00', 'down')).toBeNull();
    expect(computeSunValue(makeDate(6, 0, 1), '22:00', '06:00', 'down')).toBeNull();
  });
});
