'use strict';

import Homey from 'homey';
import {
  computeSunValue,
  normalizeDirection,
  parseTimeToMinutes,
  SunDirection,
} from './lib/SunValue.ts';
import { rampValueToInteger } from './lib/Ramp.ts';

const POLL_INTERVAL_MS = 1000;

module.exports = class VSun extends Homey.App {
  private _sunValueLastPercentage: Map<string, number | null> = new Map();
  private _pollTimer: NodeJS.Timeout | null = null;
  private _timeZone: string | undefined;

  _normalizeFlowArgs(args: {
    startTime: unknown;
    endTime: unknown;
    direction?: unknown;
    step?: unknown;
  }): {
    startMinutes: number;
    endMinutes: number;
    direction: SunDirection;
    step: number;
    key: string;
  } | null {
    const startMinutes = parseTimeToMinutes(args.startTime);
    const endMinutes = parseTimeToMinutes(args.endTime);

    if (startMinutes === null || endMinutes === null) {
      return null;
    }

    const direction = normalizeDirection(args.direction);
    const step = typeof args.step === 'number' && args.step > 0 ? args.step : 1;
    const key = `${startMinutes}|${endMinutes}|${direction}|${step}`;

    return {
      startMinutes,
      endMinutes,
      direction,
      step,
      key,
    };
  }

  async onInit() {
    this.log('Virtual Sun has been initialized');
    try {
      this._timeZone = this.homey.clock.getTimezone();
    } catch (err) {
      this._timeZone = undefined;
    }
    this._initSunValueTrigger();
    this._initRampAction();
  }

  async onUninit() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _initSunValueTrigger() {
    const triggerCard = this.homey.flow.getTriggerCard('sun-value-changed');

    triggerCard.registerRunListener(
      async (
        args: { startTime: unknown; endTime: unknown; direction?: unknown; step?: unknown },
        state: {
          startMinutes: number;
          endMinutes: number;
          direction: SunDirection;
          step: number;
        },
      ) => {
        const normalized = this._normalizeFlowArgs(args);

        if (!normalized) {
          return false;
        }

        return (
          normalized.startMinutes === state.startMinutes
          && normalized.endMinutes === state.endMinutes
          && normalized.direction === state.direction
          && normalized.step === state.step
        );
      },
    );

    const pollOnce = async () => {
      const now = new Date();
      let allArgs: Array<{
        startTime: unknown;
        endTime: unknown;
        direction?: unknown;
        step?: unknown;
      }>;

      try {
        allArgs = (await triggerCard.getArgumentValues()) as Array<{
          startTime: unknown;
          endTime: unknown;
          direction?: unknown;
          step?: unknown;
        }>;
      } catch (err) {
        this.error('Failed to get argument values', err);
        return;
      }

      const seen = new Set<string>();

      for (const args of allArgs) {
        const normalized = this._normalizeFlowArgs(args);

        if (!normalized) {
          continue;
        }

        const { key, direction } = normalized;

        if (seen.has(key)) continue;
        seen.add(key);

        const percentage = computeSunValue(
          now,
          args.startTime,
          args.endTime,
          direction,
          this._timeZone,
        );
        const last = this._sunValueLastPercentage.get(key);

        if (percentage === null) {
          if (last !== null && last !== undefined) {
            this._sunValueLastPercentage.set(key, null);
          }
          continue;
        }

        if (last === null || last === undefined || Math.abs(percentage - last) >= normalized.step) {
          this._sunValueLastPercentage.set(key, percentage);
          try {
            await triggerCard.trigger(
              { value: percentage },
              {
                startMinutes: normalized.startMinutes,
                endMinutes: normalized.endMinutes,
                direction,
                step: normalized.step,
              },
            );
          } catch (err) {
            this.error('Trigger dispatch failed', err);
          }
        }
      }
    };

    pollOnce().catch((err: unknown) => {
      this.error('Unhandled initial polling error', err);
    });

    this._pollTimer = setInterval(() => {
      pollOnce().catch((err: unknown) => {
        this.error('Unhandled polling error', err);
      });
    }, POLL_INTERVAL_MS);
  }

  _initRampAction() {
    const actionCard = this.homey.flow.getActionCard('ramp-value-integer');

    actionCard.registerRunListener(async (args: { input: unknown; x: unknown; y: unknown }) => {
      const ramped = rampValueToInteger(args.input, args.x, args.y);

      if (ramped === null) {
        throw new Error('Invalid arguments for ramp action. Input must be a number and x/y must be integers.');
      }

      return { ramped };
    });
  }
};
