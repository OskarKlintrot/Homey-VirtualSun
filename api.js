"use strict";

module.exports = {
  async getActiveRamps({ homey }) {
    return {
      ramps: homey.app.getActiveRamps(),
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
