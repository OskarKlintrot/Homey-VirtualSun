"use strict";

import Homey from "homey";
import {
  computeSunValue,
  normalizeDirection,
  parseTimeToMinutes,
  SunDirection,
} from "./lib/SunValue.ts";
import { rampValueToRange, snapPercentageToStep } from "./lib/Ramp.ts";

const POLL_INTERVAL_MS = 1000;

interface SunRamp {
  name: string;
  startTime: number;
  durationMs: number;
  direction: SunDirection;
  step: number;
  lastPercentage: number | null;
}

interface ActiveRampInfo {
  name: string;
  direction: SunDirection;
  step: number;
  durationMinutes: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  value: number;
}

interface SunValueConfigInfo {
  startTime: string;
  endTime: string;
  direction: SunDirection;
  step: number;
  activeNow: boolean;
  currentValue: number | null;
  lastTriggeredValue: number | null;
  nextTriggerSeconds: number | null;
}

const CREATE_PREFIX = "__create__:";
const RAMPS_STORAGE_KEY = "ramps_state";
const COMPLETED_RAMPS_STORAGE_KEY = "completed_ramps_state";

module.exports = class VSun extends Homey.App {
  private _sunValueLastPercentage: Map<string, number | null> = new Map();
  private _pollTimer: NodeJS.Timeout | null = null;
  private _timeZone: string | undefined;
  private _activeRamps: Map<string, SunRamp> = new Map();
  private _completedRamps: Map<string, number> = new Map();
  private _knownRampNames: Set<string> = new Set();
  private _rampIdCounter: number = 0;
  private _rampPollTimer: NodeJS.Timeout | null = null;

  _findActiveRampIdByName(rampName: string): string | null {
    for (const [id, ramp] of this._activeRamps) {
      if (ramp.name === rampName) {
        return id;
      }
    }

    return null;
  }

  _computeRampPercentage(ramp: SunRamp, now: number): number {
    const elapsed = Math.max(0, now - ramp.startTime);
    if (elapsed >= ramp.durationMs) {
      return ramp.direction === "up" ? 100 : 0;
    }

    const progress = elapsed / ramp.durationMs;
    const raw = ramp.direction === "up" ? progress * 100 : (1 - progress) * 100;
    return Math.round(raw * 10) / 10;
  }

  getActiveRamps(): ActiveRampInfo[] {
    const now = Date.now();

    return Array.from(this._activeRamps.values())
      .map((ramp) => {
        const elapsedMs = Math.max(0, now - ramp.startTime);
        const remainingMs = Math.max(0, ramp.durationMs - elapsedMs);

        return {
          name: ramp.name,
          direction: ramp.direction,
          step: ramp.step,
          durationMinutes: Math.round((ramp.durationMs / 60000) * 10) / 10,
          elapsedSeconds: Math.round(elapsedMs / 1000),
          remainingSeconds: Math.round(remainingMs / 1000),
          value: this._computeRampPercentage(ramp, now),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  stopRampByName(rampNameInput: unknown): boolean {
    const rampName = this._parseRampName(rampNameInput);
    if (rampName === null) {
      return false;
    }

    const id = this._findActiveRampIdByName(rampName);
    if (id === null) {
      return false;
    }

    this._activeRamps.delete(id);
    return true;
  }

  stopAllRamps(): number {
    const count = this._activeRamps.size;
    this._activeRamps.clear();
    return count;
  }

  _formatMinutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  _intervalDurationMinutes(startMinutes: number, endMinutes: number): number {
    return endMinutes > startMinutes
      ? endMinutes - startMinutes
      : (24 * 60 - startMinutes) + endMinutes;
  }

  async getSunValueConfigurations(): Promise<SunValueConfigInfo[]> {
    const triggerCard = this.homey.flow.getTriggerCard("sun-value-changed");
    const now = new Date();
    const allArgs = (await triggerCard.getArgumentValues()) as Array<{
      startTime: unknown;
      endTime: unknown;
      direction?: unknown;
      step?: unknown;
    }>;

    return allArgs
      .map((args) => {
        const normalized = this._normalizeFlowArgs(args);
        if (!normalized) {
          return null;
        }

        const currentValue = computeSunValue(
          now,
          args.startTime,
          args.endTime,
          normalized.direction,
          this._timeZone,
        );
        const lastTriggeredValue = this._sunValueLastPercentage.get(normalized.key) ?? null;
        const durationMinutes = this._intervalDurationMinutes(
          normalized.startMinutes,
          normalized.endMinutes,
        );
        const ratePerSecond = 100 / (durationMinutes * 60);
        const diffSinceLast =
          currentValue === null || lastTriggeredValue === null
            ? 0
            : Math.abs(currentValue - lastTriggeredValue);
        const remainingToStep = Math.max(0, normalized.step - diffSinceLast);
        const nextTriggerSeconds =
          currentValue === null
            ? null
            : lastTriggeredValue === null
              ? 0
              : remainingToStep <= 0
                ? 0
                : Math.ceil(remainingToStep / ratePerSecond);

        return {
          startTime: this._formatMinutesToTime(normalized.startMinutes),
          endTime: this._formatMinutesToTime(normalized.endMinutes),
          direction: normalized.direction,
          step: normalized.step,
          activeNow: currentValue !== null,
          currentValue,
          lastTriggeredValue,
          nextTriggerSeconds,
          sortKey: normalized.startMinutes,
        };
      })
      .filter((item): item is SunValueConfigInfo & { sortKey: number } => item !== null)
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _sortKey, ...item }) => item);
  }

  _parseRampName(value: unknown): string | null {
    if (typeof value === "string" && value.trim() !== "") {
      const trimmed = value.trim();
      if (trimmed.startsWith(CREATE_PREFIX)) {
        const created = trimmed.slice(CREATE_PREFIX.length).trim();
        return created !== "" ? created : null;
      }
      return trimmed;
    }

    if (typeof value === "object" && value !== null) {
      const valueObject = value as Record<string, unknown>;
      const candidate = valueObject.id ?? valueObject.name ?? valueObject.value;
      if (typeof candidate === "string" && candidate.trim() !== "") {
        const trimmed = candidate.trim();
        if (trimmed.startsWith(CREATE_PREFIX)) {
          const created = trimmed.slice(CREATE_PREFIX.length).trim();
          return created !== "" ? created : null;
        }
        return trimmed;
      }
    }

    return null;
  }

  _toRampName(value: unknown): string {
    return this._parseRampName(value) ?? "default";
  }

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
    const rawStep = Number(args.step);
    const step = rawStep > 0 ? rawStep : 1;
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
    this.log("Virtual Sun has been initialized");
    try {
      this._timeZone = this.homey.clock.getTimezone();
    } catch (err) {
      this._timeZone = undefined;
    }
    
    this._loadRampsFromStorage();
    
    this._initSunValueTrigger();
    this._initRampAction();
    this._initSunRamp();
    this._initGetRampValue();
  }

  async onUninit() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._rampPollTimer) {
      clearInterval(this._rampPollTimer);
      this._rampPollTimer = null;
    }
    
    this._saveRampsToStorage();
  }

  _loadRampsFromStorage(): void {
    try {
      // Load active ramps
      const rampsData = this.homey.settings.get(RAMPS_STORAGE_KEY);
      if (rampsData && Array.isArray(rampsData)) {
        for (const rampData of rampsData) {
          if (rampData.id && rampData.ramp) {
            this._activeRamps.set(rampData.id, {
              name: rampData.ramp.name,
              startTime: rampData.ramp.startTime,
              durationMs: rampData.ramp.durationMs,
              direction: rampData.ramp.direction,
              step: rampData.ramp.step,
              lastPercentage: rampData.ramp.lastPercentage,
            });
            this._rampIdCounter = Math.max(this._rampIdCounter, parseInt(rampData.id));
          }
        }
        this.log(`Loaded ${rampsData.length} active ramps from storage`);
      }

      // Load completed ramps
      const completedData = this.homey.settings.get(COMPLETED_RAMPS_STORAGE_KEY);
      if (completedData && typeof completedData === "object") {
        for (const [name, value] of Object.entries(completedData)) {
          if (typeof value === "number") {
            this._completedRamps.set(name, value);
          }
        }
        this.log(`Loaded ${this._completedRamps.size} completed ramps from storage`);
      }
    } catch (err) {
      this.error("Failed to load ramps from storage", err);
    }
  }

  _saveRampsToStorage(): void {
    try {
      // Save active ramps
      const rampsData = Array.from(this._activeRamps.entries()).map(([id, ramp]) => ({
        id,
        ramp,
      }));
      this.homey.settings.set(RAMPS_STORAGE_KEY, rampsData);

      // Save completed ramps
      const completedData: Record<string, number> = {};
      for (const [name, value] of this._completedRamps.entries()) {
        completedData[name] = value;
      }
      this.homey.settings.set(COMPLETED_RAMPS_STORAGE_KEY, completedData);

      this.log(`Saved ${rampsData.length} active and ${this._completedRamps.size} completed ramps to storage`);
    } catch (err) {
      this.error("Failed to save ramps to storage", err);
    }
  }

  _initSunValueTrigger() {
    const triggerCard = this.homey.flow.getTriggerCard("sun-value-changed");

    triggerCard.registerRunListener(
      async (
        args: {
          startTime: unknown;
          endTime: unknown;
          direction?: unknown;
          step?: unknown;
        },
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
          normalized.startMinutes === state.startMinutes &&
          normalized.endMinutes === state.endMinutes &&
          normalized.direction === state.direction &&
          normalized.step === state.step
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

        const steppedPercentage = snapPercentageToStep(
          percentage,
          direction,
          normalized.step,
        );

        if (
          last === null ||
          last === undefined ||
          steppedPercentage !== last
        ) {
          this._sunValueLastPercentage.set(key, steppedPercentage);
          try {
            await triggerCard.trigger(
              { value: steppedPercentage },
              {
                startMinutes: normalized.startMinutes,
                endMinutes: normalized.endMinutes,
                direction,
                step: normalized.step,
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

  _initRampAction() {
    const actionCard = this.homey.flow.getActionCard("convert-range");

    actionCard.registerRunListener(
      async (args: { input: unknown; x: unknown; y: unknown }) => {
        const ramped = rampValueToRange(args.input, args.x, args.y);

        if (ramped === null) {
          throw new Error(
            "Invalid arguments for ramp action. Input, x and y must be numbers.",
          );
        }

        return { ramped };
      },
    );
  }

  async _collectRampNames(): Promise<string[]> {
    const names = new Set<string>(this._knownRampNames);

    for (const ramp of this._activeRamps.values()) {
      names.add(ramp.name);
    }

    try {
      const triggerCard = this.homey.flow.getTriggerCard("sun-ramp-value-changed");
      const triggerArgs = (await triggerCard.getArgumentValues()) as Array<{ rampName?: unknown }>;
      for (const args of triggerArgs) {
        const name = this._parseRampName(args.rampName);
        if (name !== null) {
          names.add(name);
        }
      }
    } catch (err) {
      this.error("Failed to read sun-ramp-value-changed arguments", err);
    }

    try {
      const startCard = this.homey.flow.getActionCard("sun-ramp-start");
      const startArgs = (await startCard.getArgumentValues()) as Array<{ rampName?: unknown }>;
      for (const args of startArgs) {
        const name = this._parseRampName(args.rampName);
        if (name !== null) {
          names.add(name);
        }
      }
    } catch (err) {
      this.error("Failed to read sun-ramp-start arguments", err);
    }

    try {
      const getRampCard = this.homey.flow.getActionCard("get-ramp-value");
      const getRampArgs = (await getRampCard.getArgumentValues()) as Array<{ rampName?: unknown }>;
      for (const args of getRampArgs) {
        const name = this._parseRampName(args.rampName);
        if (name !== null) {
          names.add(name);
        }
      }
    } catch (err) {
      this.error("Failed to read get-ramp-value arguments", err);
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  _initSunRamp() {
    const triggerCard = this.homey.flow.getTriggerCard("sun-ramp-value-changed");
    const actionCard = this.homey.flow.getActionCard("sun-ramp-start");

    const collectRampNames = () => this._collectRampNames();

    const toAutocompleteResults = async (query: string, includeCreateOption: boolean) => {
      const normalizedQuery = query.trim().toLowerCase();
      const names = await collectRampNames();
      const matchingNames = names
        .filter((name) => normalizedQuery === "" || name.toLowerCase().includes(normalizedQuery))
        .map((name) => ({
          id: name,
          name,
        }));

      if (!includeCreateOption) {
        return matchingNames;
      }

      const trimmedQuery = query.trim();
      if (trimmedQuery === "") {
        return matchingNames;
      }

      const hasExact = names.some((name) => name.toLowerCase() === trimmedQuery.toLowerCase());
      if (hasExact) {
        return matchingNames;
      }

      return [
        ...matchingNames,
        {
          id: `${CREATE_PREFIX}${trimmedQuery}`,
          name: trimmedQuery,
          description: `Create \"${trimmedQuery}\"`,
        },
      ];
    };

    triggerCard.registerRunListener(async (args: { rampName?: unknown }, state: { rampName: string }) => {
      return this._toRampName(args.rampName) === state.rampName;
    });

    triggerCard.registerArgumentAutocompleteListener("rampName", async (query: string) =>
      toAutocompleteResults(query, false),
    );
    actionCard.registerArgumentAutocompleteListener("rampName", async (query: string) =>
      toAutocompleteResults(query, true),
    );

    actionCard.registerRunListener(
      async (args: { rampName?: unknown; duration: unknown; direction?: unknown; step?: unknown }) => {
        const durationMinutes =
          typeof args.duration === "number" && args.duration > 0 ? args.duration : null;
        if (durationMinutes === null) {
          throw new Error("Invalid duration. Must be a positive number of minutes.");
        }
        const rampName = this._toRampName(args.rampName);
        const direction = normalizeDirection(args.direction);
        const rawStep = Number(args.step);
        const step = rawStep > 0 ? rawStep : 1;
        this._knownRampNames.add(rampName);

        if (this._findActiveRampIdByName(rampName) !== null) {
          return true;
        }

        const id = String(++this._rampIdCounter);
        const initialPercentage = direction === "up" ? 0 : 100;
        const steppedInitialPercentage = snapPercentageToStep(initialPercentage, direction, step);

        this._activeRamps.set(id, {
          name: rampName,
          startTime: Date.now(),
          durationMs: durationMinutes * 60 * 1000,
          direction,
          step,
          lastPercentage: steppedInitialPercentage,
        });

        try {
          await triggerCard.trigger({ value: steppedInitialPercentage }, { rampName });
          this._saveRampsToStorage();
        } catch (err) {
          this.error("Failed to trigger ramp start event", err);
        }
      },
    );

    const pollRamps = async () => {
      if (this._activeRamps.size === 0) return;
      const now = Date.now();
      let shouldSave = false;

      for (const [id, ramp] of this._activeRamps) {
        const elapsed = now - ramp.startTime;
        let percentage: number;
        let expired = false;

        if (elapsed >= ramp.durationMs) {
          percentage = ramp.direction === "up" ? 100 : 0;
          expired = true;
        } else {
          const progress = elapsed / ramp.durationMs;
          const raw = ramp.direction === "up" ? progress * 100 : (1 - progress) * 100;
          percentage = Math.round(raw * 10) / 10;
        }

        const last = ramp.lastPercentage;
        const steppedPercentage = snapPercentageToStep(
          percentage,
          ramp.direction,
          ramp.step,
        );
        const shouldFire = last === null || steppedPercentage !== last;
        if (shouldFire) {
          ramp.lastPercentage = steppedPercentage;
          try {
            await triggerCard.trigger({ value: steppedPercentage }, { rampName: ramp.name });
          } catch (err) {
            this.error("Ramp trigger dispatch failed", err);
          }
        }

        if (expired) {
          this._completedRamps.set(ramp.name, percentage);
          this._activeRamps.delete(id);
          shouldSave = true;
        }
      }

      if (shouldSave) {
        this._saveRampsToStorage();
      }
    };

    this._rampPollTimer = setInterval(() => {
      pollRamps().catch((err: unknown) => {
        this.error("Unhandled ramp polling error", err);
      });
    }, POLL_INTERVAL_MS);
  }

  _initGetRampValue() {
    const actionCard = this.homey.flow.getActionCard("get-ramp-value");

    actionCard.registerArgumentAutocompleteListener("rampName", async (query: string) => {
      const normalizedQuery = query.trim().toLowerCase();
      const names = await this._collectRampNames();
      const matchingNames = names
        .filter((name) => normalizedQuery === "" || name.toLowerCase().includes(normalizedQuery))
        .map((name) => ({
          id: name,
          name,
        }));

      return matchingNames;
    });

    actionCard.registerRunListener(
      async (args: { rampName?: unknown }) => {
        const rampName = this._toRampName(args.rampName);
        const rampId = this._findActiveRampIdByName(rampName);

        // If ramp is active, calculate its current value
        if (rampId !== null) {
          const ramp = this._activeRamps.get(rampId);
          if (ramp) {
            const now = Date.now();
            const elapsed = Math.max(0, now - ramp.startTime);
            let percentage: number;

            if (elapsed >= ramp.durationMs) {
              percentage = ramp.direction === "up" ? 100 : 0;
            } else {
              const progress = elapsed / ramp.durationMs;
              const raw = ramp.direction === "up" ? progress * 100 : (1 - progress) * 100;
              percentage = Math.round(raw * 10) / 10;
            }

            const steppedPercentage = snapPercentageToStep(
              percentage,
              ramp.direction,
              ramp.step,
            );
            return { value: steppedPercentage };
          }
        }

        // If ramp is not active, check if it has completed
        const completedValue = this._completedRamps.get(rampName);
        if (completedValue !== undefined) {
          return { value: completedValue };
        }

        throw new Error(`Ramp "${rampName}" is not found or not started`);
      },
    );
  }
};
