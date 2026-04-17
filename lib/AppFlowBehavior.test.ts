'use strict';

type RunListener = (args: any, state?: any) => Promise<any>;
type AutocompleteListener = (query: string) => Promise<Array<{ id: string; name: string; description?: string }>>;

class MockFlowCard {
  id: string;
  argumentValues: any[] = [];
  triggerCalls: Array<{ tokens: any; state: any }> = [];
  runListener: RunListener | null = null;
  autocompleteListeners = new Map<string, AutocompleteListener>();

  constructor(id: string) {
    this.id = id;
  }

  registerRunListener(listener: RunListener) {
    this.runListener = listener;
  }

  registerArgumentAutocompleteListener(name: string, listener: AutocompleteListener) {
    this.autocompleteListeners.set(name, listener);
  }

  async getArgumentValues() {
    return this.argumentValues;
  }

  async trigger(tokens: any, state: any) {
    this.triggerCalls.push({ tokens, state });
    return true;
  }
}

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

jest.mock('../lib/SunValue.js', () => jest.requireActual('./SunValue'), { virtual: true });
jest.mock('../lib/VirtualSun.js', () => jest.requireActual('./VirtualSun'), { virtual: true });
jest.mock('../lib/DeviceAutocomplete.js', () => jest.requireActual('./DeviceAutocomplete'), { virtual: true });

const VSun = require('../app.ts');

function createCardRegistry(ids: string[]) {
  return Object.fromEntries(ids.map((id) => [id, new MockFlowCard(id)])) as Record<string, MockFlowCard>;
}

function createAppHarness() {
  const triggers = createCardRegistry([
    'sun-value-changed',
    'virtual-sun-value-changed',
    'virtual-sun-started',
    'virtual-sun-finished',
    'virtual-sun-aborted',
  ]);
  const actions = createCardRegistry([
    'convert-range',
    'virtual-sun-start',
    'get-virtual-sun-value',
    'virtual-sun-stop',
  ]);
  const conditions = createCardRegistry([
    'virtual-sun-is-active',
  ]);
  const settingsStore = new Map<string, any>();

  const app = new VSun();
  app.homey = {
    clock: {
      getTimezone: jest.fn(() => 'UTC'),
    },
    settings: {
      get: jest.fn((key: string) => settingsStore.get(key)),
      set: jest.fn((key: string, value: any) => settingsStore.set(key, value)),
    },
    flow: {
      getTriggerCard: jest.fn((id: string) => triggers[id]),
      getActionCard: jest.fn((id: string) => actions[id]),
      getConditionCard: jest.fn((id: string) => conditions[id]),
    },
  };

  return { app, triggers, actions, conditions };
}

describe('app flow behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('triggers started only when a virtual sun is started', async () => {
    const { app, triggers, actions } = createAppHarness();

    await app.onInit();

    await actions['virtual-sun-start'].runListener?.({
      name: 'morning',
      duration: 1,
      direction: 'down',
      step: 1,
    });

    await actions['virtual-sun-start'].runListener?.({
      name: 'morning',
      duration: 1,
      direction: 'down',
      step: 1,
    });

    expect(triggers['virtual-sun-started'].triggerCalls).toHaveLength(1);
    expect(triggers['virtual-sun-finished'].triggerCalls).toHaveLength(0);
    expect(triggers['virtual-sun-aborted'].triggerCalls).toHaveLength(0);
    expect(triggers['virtual-sun-started'].triggerCalls[0].tokens).toEqual({ value: 1 });

    await app.onUninit();
  });

  it('triggers finished only on natural completion', async () => {
    const { app, triggers, actions } = createAppHarness();

    await app.onInit();

    await actions['virtual-sun-start'].runListener?.({
      name: 'evening',
      duration: 1,
      direction: 'down',
      step: 1,
    });

    await jest.advanceTimersByTimeAsync(61_000);

    expect(triggers['virtual-sun-started'].triggerCalls).toHaveLength(1);
    expect(triggers['virtual-sun-finished'].triggerCalls).toHaveLength(1);
    expect(triggers['virtual-sun-aborted'].triggerCalls).toHaveLength(0);
    expect(triggers['virtual-sun-finished'].triggerCalls[0].state).toEqual({ name: 'evening' });

    await app.onUninit();
  });

  it('triggers aborted only on manual stop and never finishes afterward', async () => {
    const { app, triggers, actions } = createAppHarness();

    await app.onInit();

    await actions['virtual-sun-start'].runListener?.({
      name: 'manual-stop',
      duration: 1,
      direction: 'down',
      step: 1,
    });

    await actions['virtual-sun-stop'].runListener?.({ name: 'manual-stop' });
    await jest.advanceTimersByTimeAsync(61_000);

    expect(triggers['virtual-sun-started'].triggerCalls).toHaveLength(1);
    expect(triggers['virtual-sun-aborted'].triggerCalls).toHaveLength(1);
    expect(triggers['virtual-sun-finished'].triggerCalls).toHaveLength(0);
    expect(triggers['virtual-sun-aborted'].triggerCalls[0].state).toEqual({ name: 'manual-stop' });

    await app.onUninit();
  });

  it('reports active condition correctly across lifecycle changes', async () => {
    const { app, actions, conditions } = createAppHarness();

    await app.onInit();

    expect(await conditions['virtual-sun-is-active'].runListener?.({ name: 'status-check' })).toBe(false);

    await actions['virtual-sun-start'].runListener?.({
      name: 'status-check',
      duration: 1,
      direction: 'down',
      step: 1,
    });

    expect(await conditions['virtual-sun-is-active'].runListener?.({ name: 'status-check' })).toBe(true);

    await actions['virtual-sun-stop'].runListener?.({ name: 'status-check' });

    expect(await conditions['virtual-sun-is-active'].runListener?.({ name: 'status-check' })).toBe(false);

    await app.onUninit();
  });
});