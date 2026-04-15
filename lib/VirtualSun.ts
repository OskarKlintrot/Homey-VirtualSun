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

export function normalizeFlowPercentageInput(value: unknown): number | null {
  const numericValue = toNumber(value);

  if (numericValue === null) {
    return null;
  }

  if (numericValue >= 0 && numericValue <= 1) {
    return Math.round(numericValue * 1000) / 1000;
  }

  const clampedPercentage = Math.min(100, Math.max(0, numericValue));
  return Math.round((clampedPercentage / 100) * 1000) / 1000;
}

export function virtualSunValueToRange(input: unknown, x: unknown, y: unknown): number | null {
  const source = normalizeFlowPercentageInput(input);
  const xNum = toNumber(x);
  const yNum = toNumber(y);

  if (source === null || xNum === null || yNum === null) {
    return null;
  }

  const clampedX = Math.min(1, Math.max(0, xNum));
  const clampedY = Math.min(1, Math.max(0, yNum));

  const raw = clampedY + source * (clampedX - clampedY);
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
