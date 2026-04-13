'use strict';

import { type SunDirection } from './SunValue.ts';

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function rampValueToRange(input: unknown, x: unknown, y: unknown): number | null {
  const source = typeof input === 'number' ? input : Number(input);
  const xNum = toNumber(x);
  const yNum = toNumber(y);

  if (!Number.isFinite(source) || xNum === null || yNum === null) {
    return null;
  }

  const clampedInput = Math.min(100, Math.max(0, source));
  const clampedX = Math.min(1, Math.max(0, xNum));
  const clampedY = Math.min(1, Math.max(0, yNum));

  const raw = clampedY + (clampedInput / 100) * (clampedX - clampedY);
  return Math.round(raw * 1000) / 1000;
}

export function snapPercentageToStep(value: number, direction: SunDirection, step: number): number {
  const clamped = Math.min(100, Math.max(0, value));
  const safeStep = step > 0 ? step : 1;
  const epsilon = 1e-9;

  const snapped = direction === "up"
    ? Math.floor((clamped + epsilon) / safeStep) * safeStep
    : 100 - Math.floor(((100 - clamped) + epsilon) / safeStep) * safeStep;

  const clampedSnapped = Math.min(100, Math.max(0, snapped));
  return Math.round(clampedSnapped * 10) / 10;
}
