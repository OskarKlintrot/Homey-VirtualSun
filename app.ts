"use strict";

import Homey from "homey";
import {
  computeSunValue,
  normalizeDirection,
  parseTimeToMinutes,
  SunDirection,
} from "./lib/SunValue.ts";

const POLL_INTERVAL_MS = 1000;

module.exports = class MyApp extends Homey.App {
  private _sunValueLastPercentage: Map<string, number | null> = new Map();
  private _pollTimer: NodeJS.Timeout | null = null;
  private _timeZone: string | undefined;

  _normalizeFlowArgs(args: {
    startTime: unknown;
    endTime: unknown;
    direction?: unknown;
  }): {
    startMinutes: number;
    endMinutes: number;
    direction: SunDirection;
    key: string;
  } | null {
    const startMinutes = parseTimeToMinutes(args.startTime);
    const endMinutes = parseTimeToMinutes(args.endTime);

    if (startMinutes === null || endMinutes === null) {
      return null;
    }

    const direction = normalizeDirection(args.direction);
    const key = `${startMinutes}|${endMinutes}|${direction}`;

    return {
      startMinutes,
      endMinutes,
      direction,
      key,
    };
  }

  async onInit() {
    this.log("Virtual Sun has been initialized");
    try {
      this._timeZone = this.homey.clock.getTimezone();
    } catch (err) {
      this._timeZone = undefined;
    }
    this._initSunValueTrigger();
  }

  async onUninit() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _initSunValueTrigger() {
    const triggerCard = this.homey.flow.getTriggerCard("sun-value-changed");

    triggerCard.registerRunListener(
      async (
        args: { startTime: unknown; endTime: unknown; direction?: unknown },
        state: {
          startMinutes: number;
          endMinutes: number;
          direction: SunDirection;
        },
      ) => {
        const normalized = this._normalizeFlowArgs(args);

        if (!normalized) {
          return false;
        }

        return (
          normalized.startMinutes === state.startMinutes &&
          normalized.endMinutes === state.endMinutes &&
          normalized.direction === state.direction
        );
      },
    );

    const pollOnce = async () => {
      const now = new Date();
      let allArgs: Array<{
        startTime: unknown;
        endTime: unknown;
        direction?: unknown;
      }>;

      try {
        allArgs = (await triggerCard.getArgumentValues()) as Array<{
          startTime: unknown;
          endTime: unknown;
          direction?: unknown;
        }>;
      } catch (err) {
        this.error("Failed to get argument values", err);
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

        if (last !== percentage) {
          this._sunValueLastPercentage.set(key, percentage);
          try {
            await triggerCard.trigger(
              { value: percentage },
              {
                startMinutes: normalized.startMinutes,
                endMinutes: normalized.endMinutes,
                direction,
              },
            );
          } catch (err) {
            this.error("Trigger dispatch failed", err);
          }
        }
      }
    };

    pollOnce().catch((err: unknown) => {
      this.error("Unhandled initial polling error", err);
    });

    this._pollTimer = setInterval(() => {
      pollOnce().catch((err: unknown) => {
        this.error("Unhandled polling error", err);
      });
    }, POLL_INTERVAL_MS);
  }
};
