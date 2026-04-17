const autocompleteDevicesMock = jest.fn();

jest.mock("homey", () => ({
  __esModule: true,
  default: {
    App: class {
      homey: any;
      log = jest.fn();
      error = jest.fn();
    },
  },
}), { virtual: true });

jest.mock("homey-api", () => ({
  HomeyAPI: {
    createAppAPI: jest.fn(),
  },
}), { virtual: true });

jest.mock("../lib/SunValue.js", () => jest.requireActual("./SunValue"), { virtual: true });
jest.mock("../lib/VirtualSun.js", () => jest.requireActual("./VirtualSun"), { virtual: true });
jest.mock("../lib/DeviceAutocomplete.js", () => ({
  autocompleteDevices: (...args: unknown[]) => autocompleteDevicesMock(...args),
}), { virtual: true });

const VirtualSunApp = require("../app.ts");

describe("device-dimmed-rapidly trigger", () => {
  beforeEach(() => {
    autocompleteDevicesMock.mockReset();
  });

  it("registers an autocomplete listener that uses HomeyAPI", async () => {
    const triggerCard = {
      registerArgumentAutocompleteListener: jest.fn(),
      registerRunListener: jest.fn(),
    };

    const app = new VirtualSunApp();
    app.homey = {
      flow: {
        getTriggerCard: jest.fn().mockReturnValue(triggerCard),
      },
    };
    app._homeyAPI = { devices: { getDevices: jest.fn().mockResolvedValue({}) } };

    const expectedResults = [{ id: "kitchen", name: "Kitchen Light" }];
    autocompleteDevicesMock.mockResolvedValue(expectedResults);

    app._initDeviceDimmedRapidlyTrigger();

    expect(triggerCard.registerArgumentAutocompleteListener).toHaveBeenCalledWith("device", expect.any(Function));

    const listener = triggerCard.registerArgumentAutocompleteListener.mock.calls[0][1];
    await expect(listener("kit")).resolves.toEqual(expectedResults);
    expect(autocompleteDevicesMock).toHaveBeenCalledWith(app._homeyAPI, "kit");
  });

  it("does nothing when the trigger card is unavailable", () => {
    const app = new VirtualSunApp();
    app.homey = {
      flow: {
        getTriggerCard: jest.fn().mockReturnValue(null),
      },
    };

    expect(() => app._initDeviceDimmedRapidlyTrigger()).not.toThrow();
  });
});
