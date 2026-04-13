"use strict";

module.exports = {
  async getActiveRamps({ homey }) {
    return {
      ramps: homey.app.getActiveRamps(),
    };
  },

  async getSunValueConfigurations({ homey }) {
    return {
      configurations: await homey.app.getSunValueConfigurations(),
    };
  },

  async stopRamp({ homey, params }) {
    const decodedName = decodeURIComponent(params.name || "");
    const stopped = homey.app.stopRampByName(decodedName);

    return {
      stopped,
    };
  },

  async stopAllRamps({ homey }) {
    const stoppedCount = homey.app.stopAllRamps();

    return {
      stoppedCount,
    };
  },
};
