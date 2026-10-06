import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY, parseDisplay, serializeDisplay, type Display } from "./display-shared";

describe("display cookie", () => {
  it("uses defaults for nothing or nonsense", () => {
    expect(parseDisplay(undefined)).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplay("")).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplay("t:purple|s:huge|x:7|zzz")).toEqual(DEFAULT_DISPLAY);
  });
  it("round trips every setting", () => {
    const all: Display = { theme: "dark", size: "xlarge", readable: true, calm: true, flip: true, extraTime: 50 };
    expect(parseDisplay(serializeDisplay(all))).toEqual(all);
  });
  it("writes nothing when everything is default", () => {
    expect(serializeDisplay(DEFAULT_DISPLAY)).toBe("");
  });
});
