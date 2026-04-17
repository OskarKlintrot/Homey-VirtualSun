'use strict';

const { HomeyAPI } = require('homey-api');

jest.mock('homey', () => {
  class MockApp {
    homey: any;
    log = jest.fn();
    error = jest.fn();
  }

  return {
    __esModule: true,
    default: {
      App: MockApp,
    },
  };
}, { virtual: true });

jest.mock('homey-api', () => ({
  HomeyAPI: {
    createAppAPI: jest.fn(),
  },
}), { virtual: true });

jest.mock('../lib/SunValue.js', () => jest.requireActual('./SunValue'), { virtual: true });
jest.mock('../lib/VirtualSun.js', () => jest.requireActual('./VirtualSun'), { virtual: true });
jest.mock('../lib/DeviceAutocomplete.js', () => jest.requireActual('./DeviceAutocomplete'), { virtual: true });

const VSun = require('../app.ts');

function createTriggerCard() {
  return {
    argumentValues: [] as any[],
    triggerCalls: [] as Array<{ tokens: any; state: any }>,
    autocompleteListeners: new Map<string, (query: string) => Promise<any[]>>(),
    runListener: null as null | ((args: any, state: any) => Promise<boolean>),
    registerArgumentAutocompleteListener(name: string, listener: (query: string) => Promise<any[]>) {
      this.autocompleteListeners.set(name, listener);
    },
    registerRunListener(listener: (args: any, state: any) => Promise<boolean>) {
      this.runListener = listener;
    },
    async getArgumentValues() {
      return this.argumentValues;
    },
    async trigger(tokens: any, state: any) {
      this.triggerCalls.push({ tokens, state });
      return true;
    },
  };
}

function createRapidDimHarness() {
  const triggerCard = createTriggerCard();
  let dimListener: null | (() => Promise<void>) = null;
  let destroyMock = jest.fn();

  const dimmableDevice = {
    id: 'device-1',
    name: 'Kok Matbordslampa',
    class: 'light',
    capabilities: ['onoff', 'dim'],
    makeCapabilityInstance: jest.fn((_capabilityId: string, listener: () => Promise<void>) => {
      dimListener = listener;
      destroyMock = jest.fn();
      return { destroy: destroyMock };
    }),
  };

  const homeyAPI = {
    devices: {
      getDevices: jest.fn().mockResolvedValue({
        [dimmableDevice.id]: dimmableDevice,
      }),
    },
    zones: {
      getZones: jest.fn().mockResolvedValue({}),
    },
  };

  const fallbackCard = {
    registerRunListener: jest.fn(),
    registerArgumentAutocompleteListener: jest.fn(),
    getArgumentValues: jest.fn().mockResolvedValue([]),
    trigger: jest.fn(),
  };

  const app = new VSun();
  app.homey = {
    clock: {
      getTimezone: jest.fn(() => 'UTC'),
    },
    settings: {
      get: jest.fn(),
      set: jest.fn(),
    },
    flow: {
      getTriggerCard: jest.fn((id: string) => id === 'device-dimmed-rapidly' ? triggerCard : fallbackCard),
      getActionCard: jest.fn(() => ({
        registerRunListener: jest.fn(),
        registerArgumentAutocompleteListener: jest.fn(),
      })),
      getConditionCard: jest.fn(() => ({
        registerRunListener: jest.fn(),
        registerArgumentAutocompleteListener: jest.fn(),
      })),
    },
  };

  return {
    app,
    triggerCard,
    homeyAPI,
    emitDim: async () => {
      if (!dimListener) {
        throw new Error('dim listener not initialized');
      }
      await dimListener();
    },
    getDestroyMock: () => destroyMock,
  };
}

describe('device-dimmed-rapidly runtime behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));
    jest.mocked(HomeyAPI.createAppAPI).mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('triggers after enough dim events arrive within the configured duration', async () => {
    const { app, triggerCard, homeyAPI, emitDim } = createRapidDimHarness();
    triggerCard.argumentValues = [
      {
        device: { id: 'device-1', name: 'Kok Matbordslampa' },
        events: 5,
        duration: 1,
        cooldown: 5,
      },
    ];
    jest.mocked(HomeyAPI.createAppAPI).mockResolvedValue(homeyAPI);

    await app.onInit();

    for (let index = 0; index < 5; index += 1) {
      await emitDim();
      await jest.advanceTimersByTimeAsync(150);
    }

    expect(triggerCard.triggerCalls).toHaveLength(1);
    expect(triggerCard.triggerCalls[0]).toEqual({
      tokens: {
        dimCount: 5,
        device: 'Kok Matbordslampa',
      },
      state: {
        deviceId: 'device-1',
        events: 5,
        duration: 1,
        cooldown: 5,
      },
    });

    await app.onUninit();
  });

  it('does not trigger again until cooldown has expired', async () => {
    const { app, triggerCard, homeyAPI, emitDim } = createRapidDimHarness();
    triggerCard.argumentValues = [
      {
        device: { id: 'device-1', name: 'Kok Matbordslampa' },
        events: 3,
        duration: 1,
        cooldown: 5,
      },
    ];
    jest.mocked(HomeyAPI.createAppAPI).mockResolvedValue(homeyAPI);

    await app.onInit();

    for (let index = 0; index < 3; index += 1) {
      await emitDim();
      await jest.advanceTimersByTimeAsync(100);
    }

    for (let index = 0; index < 3; index += 1) {
      await emitDim();
      await jest.advanceTimersByTimeAsync(100);
    }

    expect(triggerCard.triggerCalls).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(5_100);

    for (let index = 0; index < 3; index += 1) {
      await emitDim();
      await jest.advanceTimersByTimeAsync(100);
    }

    expect(triggerCard.triggerCalls).toHaveLength(2);

    await app.onUninit();
  });

  it('re-arms after cooldown even if more dim events arrived during cooldown', async () => {
    const { app, triggerCard, homeyAPI, emitDim } = createRapidDimHarness();
    triggerCard.argumentValues = [
      {
        device: { id: 'device-1', name: 'Kok Matbordslampa' },
        events: 3,
        duration: 1,
        cooldown: 5,
      },
    ];
    jest.mocked(HomeyAPI.createAppAPI).mockResolvedValue(homeyAPI);

    await app.onInit();

    for (let index = 0; index < 3; index += 1) {
      await emitDim();
      await jest.advanceTimersByTimeAsync(100);
    }

    expect(triggerCard.triggerCalls).toHaveLength(1);

    for (let index = 0; index < 6; index += 1) {
      await emitDim();
      await jest.advanceTimersByTimeAsync(100);
    }

    expect(triggerCard.triggerCalls).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(5_100);

    for (let index = 0; index < 3; index += 1) {
      await emitDim();
      await jest.advanceTimersByTimeAsync(100);
    }

    expect(triggerCard.triggerCalls).toHaveLength(2);

    await app.onUninit();
  });

  it('destroys device capability instances on uninit', async () => {
    const { app, homeyAPI, getDestroyMock } = createRapidDimHarness();
    jest.mocked(HomeyAPI.createAppAPI).mockResolvedValue(homeyAPI);

    await app.onInit();
    await app.onUninit();

    expect(getDestroyMock()).toHaveBeenCalledTimes(1);
  });
});
