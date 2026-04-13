'use strict';

export type SunDirection = 'up' | 'down';

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return parseInt(value, 10);
  }

  return null;
}

/**
 * Parses supported time input values to total minutes since midnight.
 */
export function parseTimeToMinutes(timeInput: unknown): number | null {
  if (typeof timeInput !== 'string' && !(timeInput instanceof Date) && (typeof timeInput !== 'object' || timeInput === null)) {
    return null;
  }

  if (typeof timeInput === 'string') {
    const match = timeInput.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

    if (!match) {
      return null;
    }

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);

    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return null;
    }

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }

    return hours * 60 + minutes;
  }

  if (timeInput instanceof Date) {
    return timeInput.getHours() * 60 + timeInput.getMinutes();
  }

  const timeObject = timeInput as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(timeObject, 'value')) {
    const fromValue = parseTimeToMinutes(timeObject.value);
    if (fromValue !== null) {
      return fromValue;
    }
  }

  if (Object.prototype.hasOwnProperty.call(timeObject, 'id')) {
    const fromId = parseTimeToMinutes(timeObject.id);
    if (fromId !== null) {
      return fromId;
    }
  }

  const rawHour = timeObject.hour ?? timeObject.hours ?? timeObject.h ?? timeObject.hh;
  const rawMinute = timeObject.minute ?? timeObject.minutes ?? timeObject.m ?? timeObject.mm;

  const hours = toInt(rawHour);
  const minutes = toInt(rawMinute);

  if (hours === null || minutes === null) {
    return null;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

export function normalizeDirection(direction: unknown): SunDirection {
  if (direction === 'up' || direction === 'down') {
    return direction;
  }

  if (typeof direction === 'object' && direction !== null) {
    const directionObject = direction as Record<string, unknown>;
    const candidate = directionObject.id ?? directionObject.value ?? directionObject.direction;

    if (candidate === 'up' || candidate === 'down') {
      return candidate;
    }
  }

  return direction === 'up' ? 'up' : 'down';
}

function minutesInTimeZone(now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string): number => {
    const part = parts.find((p) => p.type === type)?.value ?? '0';
    return parseInt(part, 10);
  };

  const hour = getPart('hour');
  const minute = getPart('minute');
  const second = getPart('second');

  return hour * 60 + minute + second / 60;
}

/**
 * Returns the current local time in total minutes since midnight, including seconds
 * as a fractional minute, so interpolation is smooth.
 */
export function localMinutesNow(now: Date, timeZone?: string): number {
  if (timeZone) {
    return minutesInTimeZone(now, timeZone);
  }

  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
}

/**
 * Computes the sun value (percentage) linearly from 100.0% to 0.0% (down)
 * or 0.0% to 100.0% (up) for the given local Date.
 *
 * Returns null if the current time is outside [startTime, endTime].
 * Returns a number rounded to one decimal place (0.0–100.0).
 */
export function computeSunValue(now: Date, startTime: unknown, endTime: unknown, direction: SunDirection = 'down', timeZone?: string): number | null {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  if (endMinutes <= startMinutes) {
    if (endMinutes === startMinutes) {
      return null;
    }
  }

  const nowMinutes = localMinutesNow(now, timeZone);

  let totalMinutes: number;
  let elapsed: number;

  if (endMinutes > startMinutes) {
    if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
      return null;
    }

    totalMinutes = endMinutes - startMinutes;
    elapsed = nowMinutes - startMinutes;
  } else {
    // Interval crosses midnight, e.g. 22:00 -> 06:00.
    if (nowMinutes > endMinutes && nowMinutes < startMinutes) {
      return null;
    }

    totalMinutes = (24 * 60 - startMinutes) + endMinutes;
    elapsed = nowMinutes >= startMinutes
      ? nowMinutes - startMinutes
      : (24 * 60 - startMinutes) + nowMinutes;
  }

  const progress = elapsed / totalMinutes;

  const raw = direction === 'up' ? progress * 100 : (1 - progress) * 100;
  return Math.round(raw * 10) / 10;
}
