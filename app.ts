"use strict";

import Homey from "homey";
import {
  computeSunValue,
  normalizeDirection,
  parseTimeToMinutes,
  SunDirection,
} from "./lib/SunValue.ts";
import { virtualSunValueToRange, snapPercentageToStep } from "./lib/VirtualSun.ts";

const POLL_INTERVAL_MS = 1000;

interface VirtualSun {
  name: string;
  startTime: number;
  durationMs: number;
  direction: SunDirection;
  step: number;
  lastPercentage: number | null;
}

interface ActiveVirtualSunInfo {
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
const VIRTUAL_SUNS_STORAGE_KEY = "virtual_suns_state";
const COMPLETED_VIRTUAL_SUNS_STORAGE_KEY = "completed_virtual_suns_state";

function toFlowPercentageValue(percentage: number): number {
  const clampedPercentage = Math.min(100, Math.max(0, percentage));
  return Math.round((clampedPercentage / 100) * 1000) / 1000;
}

module.exports = class VSun extends Homey.App {
  private _sunValueLastPercentage: Map<string, number | null> = new Map();
  private _pollTimer: NodeJS.Timeout | null = null;
  private _timeZone: string | undefined;
  private _activeVirtualSuns: Map<string, VirtualSun> = new Map();
  private _completedVirtualSuns: Map<string, number> = new Map();
  private _knownVirtualSunNames: Set<string> = new Set();
  private _virtualSunIdCounter: number = 0;
  private _virtualSunPollTimer: NodeJS.Timeout | null = null;

  _findActiveVirtualSunIdByName(virtualSunName: string): string | null {
    for (const [id, virtualSun] of this._activeVirtualSuns) {
      if (virtualSun.name === virtualSunName) {
        return id;
      }
    }

    return null;
  }

  _computeVirtualSunPercentage(virtualSun: VirtualSun, now: number): number {
    const elapsed = Math.max(0, now - virtualSun.startTime);
    if (elapsed >= virtualSun.durationMs) {
      return virtualSun.direction === "up" ? 100 : 0;
    }

    const progress = elapsed / virtualSun.durationMs;
    const raw = virtualSun.direction === "up" ? progress * 100 : (1 - progress) * 100;
    return Math.round(raw * 10) / 10;
  }

  getActiveVirtualSuns(): ActiveVirtualSunInfo[] {
    const now = Date.now();

    return Array.from(this._activeVirtualSuns.values())
      .map((virtualSun) => {
        const elapsedMs = Math.max(0, now - virtualSun.startTime);
        const remainingMs = Math.max(0, virtualSun.durationMs - elapsedMs);

        return {
          name: virtualSun.name,
          direction: virtualSun.direction,
          step: virtualSun.step,
          durationMinutes: Math.round((virtualSun.durationMs / 60000) * 10) / 10,
          elapsedSeconds: Math.round(elapsedMs / 1000),
          remainingSeconds: Math.round(remainingMs / 1000),
          value: this._computeVirtualSunPercentage(virtualSun, now),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _getCurrentVirtualSunSteppedPercentage(virtualSun: VirtualSun, now: number): number {
    const elapsed = Math.max(0, now - virtualSun.startTime);
    let percentage: number;

    if (elapsed >= virtualSun.durationMs) {
      percentage = virtualSun.direction === "up" ? 100 : 0;
    } else {
      const progress = elapsed / virtualSun.durationMs;
      const raw = virtualSun.direction === "up" ? progress * 100 : (1 - progress) * 100;
      percentage = Math.round(raw * 10) / 10;
    }

    return snapPercentageToStep(
      percentage,
      virtualSun.direction,
      virtualSun.step,
    );
  }

  async _triggerVirtualSunAborted(name: string, steppedPercentage: number): Promise<void> {
    const triggerCard = this.homey.flow.getTriggerCard("virtual-sun-aborted");

    try {
      await triggerCard.trigger(
        { value: toFlowPercentageValue(steppedPercentage) },
        { name },
      );
    } catch (err) {
      this.error("Failed to trigger virtual sun aborted event", err);
    }
  }

  async stopVirtualSunByName(virtualSunNameInput: unknown): Promise<boolean> {
    const virtualSunName = this._parseVirtualSunName(virtualSunNameInput);
    if (virtualSunName === null) {
      return false;
    }

    const id = this._findActiveVirtualSunIdByName(virtualSunName);
    if (id === null) {
      return false;
    }

    const virtualSun = this._activeVirtualSuns.get(id);
    if (!virtualSun) {
      return false;
    }

    const steppedPercentage = this._getCurrentVirtualSunSteppedPercentage(virtualSun, Date.now());

    this._activeVirtualSuns.delete(id);
    this._saveVirtualSunsToStorage();

    await this._triggerVirtualSunAborted(virtualSun.name, steppedPercentage);
    return true;
  }

  async stopAllVirtualSuns(): Promise<number> {
    const activeVirtualSuns = Array.from(this._activeVirtualSuns.values()).map((virtualSun) => ({
      name: virtualSun.name,
      steppedPercentage: this._getCurrentVirtualSunSteppedPercentage(virtualSun, Date.now()),
    }));
    const count = activeVirtualSuns.length;

    this._activeVirtualSuns.clear();
    this._saveVirtualSunsToStorage();

    for (const virtualSun of activeVirtualSuns) {
      await this._triggerVirtualSunAborted(virtualSun.name, virtualSun.steppedPercentage);
    }

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

  _parseVirtualSunName(value: unknown): string | null {
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

  _toVirtualSunName(value: unknown): string {
    return this._parseVirtualSunName(value) ?? "default";
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
    
    this._loadVirtualSunsFromStorage();
    
    this._initSunValueTrigger();
    this._initVirtualSunAction();
    this._initVirtualSun();
    this._initGetVirtualSunValue();
    this._initVirtualSunIsActiveCondition();
    this._initVirtualSunStopAction();
    this._initVirtualSunAbortedTrigger();
  }

  async onUninit() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._virtualSunPollTimer) {
      clearInterval(this._virtualSunPollTimer);
      this._virtualSunPollTimer = null;
    }
    
    this._saveVirtualSunsToStorage();
  }

  _loadVirtualSunsFromStorage(): void {
    try {
      // Load active virtualSuns
      const virtualSunsData = this.homey.settings.get(VIRTUAL_SUNS_STORAGE_KEY);
      if (virtualSunsData && Array.isArray(virtualSunsData)) {
        for (const virtualSunData of virtualSunsData) {
          if (virtualSunData.id && virtualSunData.virtualSun) {
            this._activeVirtualSuns.set(virtualSunData.id, {
              name: virtualSunData.virtualSun.name,
              startTime: virtualSunData.virtualSun.startTime,
              durationMs: virtualSunData.virtualSun.durationMs,
              direction: virtualSunData.virtualSun.direction,
              step: virtualSunData.virtualSun.step,
              lastPercentage: virtualSunData.virtualSun.lastPercentage,
            });
            this._virtualSunIdCounter = Math.max(this._virtualSunIdCounter, parseInt(virtualSunData.id));
          }
        }
        this.log(`Loaded ${virtualSunsData.length} active virtualSuns from storage`);
      }

      // Load completed virtualSuns
      const completedData = this.homey.settings.get(COMPLETED_VIRTUAL_SUNS_STORAGE_KEY);
      if (completedData && typeof completedData === "object") {
        for (const [name, value] of Object.entries(completedData)) {
          if (typeof value === "number") {
            this._completedVirtualSuns.set(name, value);
          }
        }
        this.log(`Loaded ${this._completedVirtualSuns.size} completed virtualSuns from storage`);
      }
    } catch (err) {
      this.error("Failed to load virtualSuns from storage", err);
    }
  }

  _saveVirtualSunsToStorage(): void {
    try {
      // Save active virtualSuns
      const virtualSunsData = Array.from(this._activeVirtualSuns.entries()).map(([id, virtualSun]) => ({
        id,
        virtualSun,
      }));
      this.homey.settings.set(VIRTUAL_SUNS_STORAGE_KEY, virtualSunsData);

      // Save completed virtualSuns
      const completedData: Record<string, number> = {};
      for (const [name, value] of this._completedVirtualSuns.entries()) {
        completedData[name] = value;
      }
      this.homey.settings.set(COMPLETED_VIRTUAL_SUNS_STORAGE_KEY, completedData);

      this.log(`Saved ${virtualSunsData.length} active and ${this._completedVirtualSuns.size} completed virtualSuns to storage`);
    } catch (err) {
      this.error("Failed to save virtualSuns to storage", err);
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
              { value: toFlowPercentageValue(steppedPercentage) },
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

  _initVirtualSunAction() {
    const actionCard = this.homey.flow.getActionCard("convert-range");

    actionCard.registerRunListener(
      async (args: { input: unknown; x: unknown; y: unknown }) => {
        const convertedValue = virtualSunValueToRange(args.input, args.x, args.y);

        if (convertedValue === null) {
          throw new Error(
            "Invalid arguments for virtual sun action. Input, x and y must be numbers.",
          );
        }

        return { convertedValue };
      },
    );
  }

  async _collectVirtualSunNames(): Promise<string[]> {
    const names = new Set<string>(this._knownVirtualSunNames);

    for (const virtualSun of this._activeVirtualSuns.values()) {
      names.add(virtualSun.name);
    }

    try {
      const abortedTriggerCard = this.homey.flow.getTriggerCard("virtual-sun-aborted");
      const abortedTriggerArgs = (await abortedTriggerCard.getArgumentValues()) as Array<{ name?: unknown }>;
      for (const args of abortedTriggerArgs) {
        const name = this._parseVirtualSunName(args.name);
        if (name !== null) {
          names.add(name);
        }
      }
    } catch (err) {
      this.error("Failed to read virtual-sun-aborted arguments", err);
    }

    try {
      const triggerCard = this.homey.flow.getTriggerCard("virtual-sun-value-changed");
      const triggerArgs = (await triggerCard.getArgumentValues()) as Array<{ name?: unknown }>;
      for (const args of triggerArgs) {
        const name = this._parseVirtualSunName(args.name);
        if (name !== null) {
          names.add(name);
        }
      }
    } catch (err) {
      this.error("Failed to read virtual-sun-value-changed arguments", err);
    }

    try {
      const startCard = this.homey.flow.getActionCard("virtual-sun-start");
      const startArgs = (await startCard.getArgumentValues()) as Array<{ name?: unknown }>;
      for (const args of startArgs) {
        const name = this._parseVirtualSunName(args.name);
        if (name !== null) {
          names.add(name);
        }
      }
    } catch (err) {
      this.error("Failed to read virtual-sun-start arguments", err);
    }

    try {
      const getVirtualSunCard = this.homey.flow.getActionCard("get-virtual-sun-value");
      const getVirtualSunArgs = (await getVirtualSunCard.getArgumentValues()) as Array<{ name?: unknown }>;
      for (const args of getVirtualSunArgs) {
        const name = this._parseVirtualSunName(args.name);
        if (name !== null) {
          names.add(name);
        }
      }
    } catch (err) {
      this.error("Failed to read get-virtual-sun-value arguments", err);
    }

    try {
      const stopCard = this.homey.flow.getActionCard("virtual-sun-stop");
      const stopArgs = (await stopCard.getArgumentValues()) as Array<{ name?: unknown }>;
      for (const args of stopArgs) {
        const name = this._parseVirtualSunName(args.name);
        if (name !== null) {
          names.add(name);
        }
      }
    } catch (err) {
      this.error("Failed to read virtual-sun-stop arguments", err);
    }

    try {
      const conditionCard = this.homey.flow.getConditionCard("virtual-sun-is-active");
      const conditionArgs = (await conditionCard.getArgumentValues()) as Array<{ name?: unknown }>;
      for (const args of conditionArgs) {
        const name = this._parseVirtualSunName(args.name);
        if (name !== null) {
          names.add(name);
        }
      }
    } catch (err) {
      this.error("Failed to read virtual-sun-is-active arguments", err);
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  _initVirtualSun() {
    const triggerCard = this.homey.flow.getTriggerCard("virtual-sun-value-changed");
    const actionCard = this.homey.flow.getActionCard("virtual-sun-start");

    const collectVirtualSunNames = () => this._collectVirtualSunNames();

    const toAutocompleteResults = async (query: string, includeCreateOption: boolean) => {
      const normalizedQuery = query.trim().toLowerCase();
      const names = await collectVirtualSunNames();
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

    triggerCard.registerRunListener(async (args: { name?: unknown }, state: { name: string }) => {
      return this._toVirtualSunName(args.name) === state.name;
    });

    triggerCard.registerArgumentAutocompleteListener("name", async (query: string) =>
      toAutocompleteResults(query, false),
    );
    actionCard.registerArgumentAutocompleteListener("name", async (query: string) =>
      toAutocompleteResults(query, true),
    );

    actionCard.registerRunListener(
      async (args: { name?: unknown; duration: unknown; direction?: unknown; step?: unknown }) => {
        const durationMinutes =
          typeof args.duration === "number" && args.duration > 0 ? args.duration : null;
        if (durationMinutes === null) {
          throw new Error("Invalid duration. Must be a positive number of minutes.");
        }
        const virtualSunName = this._toVirtualSunName(args.name);
        const direction = normalizeDirection(args.direction);
        const rawStep = Number(args.step);
        const step = rawStep > 0 ? rawStep : 1;
        this._knownVirtualSunNames.add(virtualSunName);

        if (this._findActiveVirtualSunIdByName(virtualSunName) !== null) {
          return true;
        }

        const id = String(++this._virtualSunIdCounter);
        const initialPercentage = direction === "up" ? 0 : 100;
        const steppedInitialPercentage = snapPercentageToStep(initialPercentage, direction, step);

        this._activeVirtualSuns.set(id, {
          name: virtualSunName,
          startTime: Date.now(),
          durationMs: durationMinutes * 60 * 1000,
          direction,
          step,
          lastPercentage: steppedInitialPercentage,
        });

        try {
          await triggerCard.trigger(
            { value: toFlowPercentageValue(steppedInitialPercentage) },
            { name: virtualSunName },
          );
          this._saveVirtualSunsToStorage();
        } catch (err) {
          this.error("Failed to trigger virtual sun start event", err);
        }
      },
    );

    const pollVirtualSuns = async () => {
      if (this._activeVirtualSuns.size === 0) return;
      const now = Date.now();
      let shouldSave = false;

      for (const [id, virtualSun] of this._activeVirtualSuns) {
        const elapsed = now - virtualSun.startTime;
        let percentage: number;
        let expired = false;

        if (elapsed >= virtualSun.durationMs) {
          percentage = virtualSun.direction === "up" ? 100 : 0;
          expired = true;
        } else {
          const progress = elapsed / virtualSun.durationMs;
          const raw = virtualSun.direction === "up" ? progress * 100 : (1 - progress) * 100;
          percentage = Math.round(raw * 10) / 10;
        }

        const last = virtualSun.lastPercentage;
        const steppedPercentage = snapPercentageToStep(
          percentage,
          virtualSun.direction,
          virtualSun.step,
        );
        const shouldFire = last === null || steppedPercentage !== last;
        if (shouldFire) {
          virtualSun.lastPercentage = steppedPercentage;
          try {
            await triggerCard.trigger(
              { value: toFlowPercentageValue(steppedPercentage) },
              { name: virtualSun.name },
            );
          } catch (err) {
            this.error("Virtual Sun trigger dispatch failed", err);
          }
        }

        if (expired) {
          this._completedVirtualSuns.set(virtualSun.name, percentage);
          this._activeVirtualSuns.delete(id);
          shouldSave = true;
        }
      }

      if (shouldSave) {
        this._saveVirtualSunsToStorage();
      }
    };

    this._virtualSunPollTimer = setInterval(() => {
      pollVirtualSuns().catch((err: unknown) => {
        this.error("Unhandled virtual sun polling error", err);
      });
    }, POLL_INTERVAL_MS);
  }

  _initGetVirtualSunValue() {
    const actionCard = this.homey.flow.getActionCard("get-virtual-sun-value");

    actionCard.registerArgumentAutocompleteListener("name", async (query: string) => {
      const normalizedQuery = query.trim().toLowerCase();
      const names = await this._collectVirtualSunNames();
      const matchingNames = names
        .filter((name) => normalizedQuery === "" || name.toLowerCase().includes(normalizedQuery))
        .map((name) => ({
          id: name,
          name,
        }));

      return matchingNames;
    });

    actionCard.registerRunListener(
      async (args: { name?: unknown }) => {
        const virtualSunName = this._toVirtualSunName(args.name);
        const virtualSunId = this._findActiveVirtualSunIdByName(virtualSunName);

        // If virtualSun is active, calculate its current value
        if (virtualSunId !== null) {
          const virtualSun = this._activeVirtualSuns.get(virtualSunId);
          if (virtualSun) {
            const now = Date.now();
            const elapsed = Math.max(0, now - virtualSun.startTime);
            let percentage: number;

            if (elapsed >= virtualSun.durationMs) {
              percentage = virtualSun.direction === "up" ? 100 : 0;
            } else {
              const progress = elapsed / virtualSun.durationMs;
              const raw = virtualSun.direction === "up" ? progress * 100 : (1 - progress) * 100;
              percentage = Math.round(raw * 10) / 10;
            }

            const steppedPercentage = snapPercentageToStep(
              percentage,
              virtualSun.direction,
              virtualSun.step,
            );
            return { value: toFlowPercentageValue(steppedPercentage) };
          }
        }

        // If virtualSun is not active, check if it has completed
        const completedValue = this._completedVirtualSuns.get(virtualSunName);
        if (completedValue !== undefined) {
          return { value: toFlowPercentageValue(completedValue) };
        }

        throw new Error(`Virtual Sun "${virtualSunName}" is not found or not started`);
      },
    );
  }

  _initVirtualSunIsActiveCondition() {
    const conditionCard = this.homey.flow.getConditionCard("virtual-sun-is-active");

    conditionCard.registerArgumentAutocompleteListener("name", async (query: string) => {
      const normalizedQuery = query.trim().toLowerCase();
      const names = await this._collectVirtualSunNames();
      const matchingNames = names
        .filter((name) => normalizedQuery === "" || name.toLowerCase().includes(normalizedQuery))
        .map((name) => ({
          id: name,
          name,
        }));

      return matchingNames;
    });

    conditionCard.registerRunListener(async (args: { name?: unknown }) => {
      const virtualSunName = this._parseVirtualSunName(args.name);
      if (virtualSunName === null) {
        return false;
      }

      return this._findActiveVirtualSunIdByName(virtualSunName) !== null;
    });
  }

  _initVirtualSunStopAction() {
    const actionCard = this.homey.flow.getActionCard("virtual-sun-stop");

    actionCard.registerArgumentAutocompleteListener("name", async (query: string) => {
      const normalizedQuery = query.trim().toLowerCase();
      const names = await this._collectVirtualSunNames();
      const matchingNames = names
        .filter((name) => normalizedQuery === "" || name.toLowerCase().includes(normalizedQuery))
        .map((name) => ({
          id: name,
          name,
        }));

      return matchingNames;
    });

    actionCard.registerRunListener(async (args: { name?: unknown }) => {
      const virtualSunName = this._parseVirtualSunName(args.name);
      if (virtualSunName === null) {
        throw new Error("Invalid virtual sun name.");
      }

      this._knownVirtualSunNames.add(virtualSunName);
      await this.stopVirtualSunByName(virtualSunName);
      return true;
    });
  }

  _initVirtualSunAbortedTrigger() {
    const triggerCard = this.homey.flow.getTriggerCard("virtual-sun-aborted");

    triggerCard.registerRunListener(async (args: { name?: unknown }, state: { name: string }) => {
      return this._toVirtualSunName(args.name) === state.name;
    });

    triggerCard.registerArgumentAutocompleteListener("name", async (query: string) => {
      const normalizedQuery = query.trim().toLowerCase();
      const names = await this._collectVirtualSunNames();
      const matchingNames = names
        .filter((name) => normalizedQuery === "" || name.toLowerCase().includes(normalizedQuery))
        .map((name) => ({
          id: name,
          name,
        }));

      return matchingNames;
    });
  }
};
