const { autocompleteDevices } = require("./DeviceAutocomplete.ts");

describe("autocompleteDevices", () => {
  it("returns dimmable light devices with room-prefixed display names sorted by room then name", async () => {
    const homeyAPI = {
      devices: {
        getDevices: jest.fn().mockResolvedValue({
          kitchen: { id: "kitchen", name: "Kitchen Light", class: "light", capabilities: ["onoff", "dim"], zone: "kitchen-zone" },
          island: { id: "island", name: "Island Light", class: "light", capabilities: ["dim"], zone: "kitchen-zone" },
          bedroom: { id: "bedroom", name: "Bedroom Light", class: "light", capabilities: ["dim"], zone: "bedroom-zone" },
          sensor: { id: "sensor", name: "Brightness Sensor", class: "sensor", capabilities: ["measure_luminance"] },
        }),
      },
      zones: {
        getZones: jest.fn().mockResolvedValue({
          home: { id: "home", name: "Home", parent: null },
          "bedroom-zone": { id: "bedroom-zone", name: "Bedroom", parent: "home" },
          "kitchen-zone": { id: "kitchen-zone", name: "Kitchen", parent: "home" },
        }),
      },
    };

    await expect(autocompleteDevices(homeyAPI, "")).resolves.toEqual([
      { id: "bedroom", name: "Bedroom / Bedroom Light", description: "Bedroom" },
      { id: "island", name: "Kitchen / Island Light", description: "Kitchen" },
      { id: "kitchen", name: "Kitchen / Kitchen Light", description: "Kitchen" },
    ]);
  });

  it("filters results by device name", async () => {
    const homeyAPI = {
      devices: {
        getDevices: jest.fn().mockResolvedValue({
          kitchen: { id: "kitchen", name: "Kitchen Light", class: "light", capabilities: ["dim"], zone: "kitchen-zone" },
          hallway: { id: "hallway", name: "Hallway Lamp", class: "light", capabilities: ["dim"], zone: "hallway-zone" },
        }),
      },
      zones: {
        getZones: jest.fn().mockResolvedValue({
          "hallway-zone": { id: "hallway-zone", name: "Hallway", parent: null },
          "kitchen-zone": { id: "kitchen-zone", name: "Kitchen", parent: null },
        }),
      },
    };

    await expect(autocompleteDevices(homeyAPI, "kit")).resolves.toEqual([
      { id: "kitchen", name: "Kitchen / Kitchen Light", description: "Kitchen" },
    ]);
  });

  it("filters results by room name", async () => {
    const homeyAPI = {
      devices: {
        getDevices: jest.fn().mockResolvedValue({
          kitchen: { id: "kitchen", name: "Ceiling", class: "light", capabilities: ["dim"], zone: "kitchen-zone" },
          hallway: { id: "hallway", name: "Wall Lamp", class: "light", capabilities: ["dim"], zone: "hallway-zone" },
        }),
      },
      zones: {
        getZones: jest.fn().mockResolvedValue({
          "hallway-zone": { id: "hallway-zone", name: "Hallway", parent: null },
          "kitchen-zone": { id: "kitchen-zone", name: "Kitchen", parent: null },
        }),
      },
    };

    await expect(autocompleteDevices(homeyAPI, "hall")).resolves.toEqual([
      { id: "hallway", name: "Hallway / Wall Lamp", description: "Hallway" },
    ]);
  });

  it("returns an empty list when HomeyAPI is missing", async () => {
    await expect(autocompleteDevices(null, "kit")).resolves.toEqual([]);
  });

  it("returns an empty list when getDevices fails", async () => {
    const homeyAPI = {
      devices: {
        getDevices: jest.fn().mockRejectedValue(new Error("boom")),
      },
    };

    await expect(autocompleteDevices(homeyAPI, "kit")).resolves.toEqual([]);
  });
});