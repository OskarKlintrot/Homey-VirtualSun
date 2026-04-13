"use strict";

import fs from "fs";
import path from "path";

function readJson(relativePath: string): any {
  const fullPath = path.resolve(__dirname, "..", relativePath);
  const content = fs.readFileSync(fullPath, "utf8");
  return JSON.parse(content);
}

describe("flow cards", () => {
  it("sun-ramp-start has named ramp input", () => {
    const card = readJson(".homeycompose/flow/actions/sun-ramp-start.json");

    expect(card.id).toBe("sun-ramp-start");
    expect(card.titleFormatted.en).toContain("[[rampName]]");

    const rampNameArg = card.args.find((arg: any) => arg.name === "rampName");
    expect(rampNameArg).toBeDefined();
    expect(rampNameArg.type).toBe("autocomplete");

    const durationArg = card.args.find((arg: any) => arg.name === "duration");
    expect(durationArg).toBeDefined();
    expect(durationArg.type).toBe("number");

    const directionArg = card.args.find((arg: any) => arg.name === "direction");
    expect(directionArg).toBeDefined();
    expect(directionArg.type).toBe("dropdown");

    const stepArg = card.args.find((arg: any) => arg.name === "step");
    expect(stepArg).toBeDefined();
    expect(stepArg.type).toBe("number");
  });

  it("sun-ramp-value-changed has ramp picker", () => {
    const card = readJson(".homeycompose/flow/triggers/sun-ramp-value-changed.json");

    expect(card.id).toBe("sun-ramp-value-changed");
    expect(card.titleFormatted.en).toContain("[[rampName]]");

    const rampArg = card.args.find((arg: any) => arg.name === "rampName");
    expect(rampArg).toBeDefined();
    expect(rampArg.type).toBe("autocomplete");

    expect(Array.isArray(card.tokens)).toBe(true);
    const valueToken = card.tokens.find((token: any) => token.name === "value");
    expect(valueToken).toBeDefined();
    expect(valueToken.type).toBe("number");
  });
});
