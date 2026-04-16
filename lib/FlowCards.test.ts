"use strict";

import fs from "fs";
import path from "path";

function readJson(relativePath: string): any {
  const fullPath = path.resolve(__dirname, "..", relativePath);
  const content = fs.readFileSync(fullPath, "utf8");
  return JSON.parse(content);
}

describe("flow cards", () => {
  it("virtual-sun-start has named virtualSun input", () => {
    const card = readJson(".homeycompose/flow/actions/virtual-sun-start.json");

    expect(card.id).toBe("virtual-sun-start");
    expect(card.titleFormatted.en).toContain("[[name]]");

    const virtualSunNameArg = card.args.find((arg: any) => arg.name === "name");
    expect(virtualSunNameArg).toBeDefined();
    expect(virtualSunNameArg.type).toBe("autocomplete");

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

  it("virtual-sun-value-changed has virtual sun picker", () => {
    const card = readJson(".homeycompose/flow/triggers/virtual-sun-value-changed.json");

    expect(card.id).toBe("virtual-sun-value-changed");
    expect(card.titleFormatted.en).toContain("[[name]]");

    const virtualSunArg = card.args.find((arg: any) => arg.name === "name");
    expect(virtualSunArg).toBeDefined();
    expect(virtualSunArg.type).toBe("autocomplete");

    expect(Array.isArray(card.tokens)).toBe(true);
    const valueToken = card.tokens.find((token: any) => token.name === "value");
    expect(valueToken).toBeDefined();
    expect(valueToken.type).toBe("number");
  });

  it("virtual-sun-aborted has virtual sun picker and value token", () => {
    const card = readJson(".homeycompose/flow/triggers/virtual-sun-aborted.json");

    expect(card.id).toBe("virtual-sun-aborted");
    expect(card.titleFormatted.en).toContain("[[name]]");

    const virtualSunArg = card.args.find((arg: any) => arg.name === "name");
    expect(virtualSunArg).toBeDefined();
    expect(virtualSunArg.type).toBe("autocomplete");

    expect(Array.isArray(card.tokens)).toBe(true);
    const valueToken = card.tokens.find((token: any) => token.name === "value");
    expect(valueToken).toBeDefined();
    expect(valueToken.type).toBe("number");
  });

  it("get-virtual-sun-value has virtual sun picker and value token", () => {
    const card = readJson(".homeycompose/flow/actions/get-virtual-sun-value.json");

    expect(card.id).toBe("get-virtual-sun-value");
    expect(card.titleFormatted.en).toContain("[[name]]");

    const virtualSunArg = card.args.find((arg: any) => arg.name === "name");
    expect(virtualSunArg).toBeDefined();
    expect(virtualSunArg.type).toBe("autocomplete");

    expect(Array.isArray(card.tokens)).toBe(true);
    const valueToken = card.tokens.find((token: any) => token.name === "value");
    expect(valueToken).toBeDefined();
    expect(valueToken.type).toBe("number");
  });

  it("virtual-sun-stop has virtual sun picker", () => {
    const card = readJson(".homeycompose/flow/actions/virtual-sun-stop.json");

    expect(card.id).toBe("virtual-sun-stop");
    expect(card.titleFormatted.en).toContain("[[name]]");

    const virtualSunArg = card.args.find((arg: any) => arg.name === "name");
    expect(virtualSunArg).toBeDefined();
    expect(virtualSunArg.type).toBe("autocomplete");
  });

  it("virtual-sun-is-active has virtual sun picker", () => {
    const card = readJson(".homeycompose/flow/conditions/virtual-sun-is-active.json");

    expect(card.id).toBe("virtual-sun-is-active");
    expect(card.titleFormatted.en).toContain("[[name]]");

    const virtualSunArg = card.args.find((arg: any) => arg.name === "name");
    expect(virtualSunArg).toBeDefined();
    expect(virtualSunArg.type).toBe("autocomplete");
  });

  it("convert-range accepts normalized percentage input", () => {
    const card = readJson(".homeycompose/flow/actions/convert-range.json");

    expect(card.id).toBe("convert-range");

    const inputArg = card.args.find((arg: any) => arg.name === "input");
    expect(inputArg).toBeDefined();
    expect(inputArg.type).toBe("range");
    expect(inputArg.min).toBe(0);
    expect(inputArg.max).toBe(1);
    expect(inputArg.labelMultiplier).toBe(100);

    const convertedValueToken = card.tokens.find((token: any) => token.name === "convertedValue");
    expect(convertedValueToken).toBeDefined();
    expect(convertedValueToken.example).toBe(0.42);
  });
});

