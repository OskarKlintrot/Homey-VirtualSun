'use strict';

export function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }

  return null;
}

export function rampValueToInteger(input: unknown, x: unknown, y: unknown): number | null {
  const source = typeof input === 'number' ? input : Number(input);
  const xInt = toInteger(x);
  const yInt = toInteger(y);

  if (!Number.isFinite(source) || xInt === null || yInt === null) {
    return null;
  }

  const clampedInput = Math.min(100, Math.max(0, source));
  const raw = yInt + (clampedInput / 100) * (xInt - yInt);
  const rounded = Math.round(raw);

  const minTarget = Math.min(xInt, yInt);
  const maxTarget = Math.max(xInt, yInt);
  return Math.min(maxTarget, Math.max(minTarget, rounded));
}
