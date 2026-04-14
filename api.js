"use strict";

module.exports = {
  async getActiveVirtualSuns({ homey }) {
    return {
      virtualSuns: homey.app.getActiveVirtualSuns(),
    };
  },

  async getSunValueConfigurations({ homey }) {
    return {
      configurations: await homey.app.getSunValueConfigurations(),
    };
  },

  async stopVirtualSun({ homey, params }) {
    const decodedName = decodeURIComponent(params.name || "");
    const stopped = homey.app.stopVirtualSunByName(decodedName);

    return {
      stopped,
    };
  },

  async stopAllVirtualSuns({ homey }) {
    const stoppedCount = homey.app.stopAllVirtualSuns();

    return {
      stoppedCount,
    };
  },
};
