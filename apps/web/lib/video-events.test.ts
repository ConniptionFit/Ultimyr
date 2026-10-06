import { describe, expect, it } from "vitest";
import { parseSignal, withApi, withStart } from "./video-events";

describe("video events", () => {
  it("reads YouTube end and time", () => {
    expect(parseSignal("YouTube", JSON.stringify({ event: "onStateChange", info: 0 }))).toEqual({ kind: "ended" });
    expect(parseSignal("YouTube", JSON.stringify({ event: "infoDelivery", info: { currentTime: 42.5 } }))).toEqual({ kind: "time", seconds: 42.5 });
    expect(parseSignal("YouTube", JSON.stringify({ event: "onStateChange", info: 1 }))).toBeNull();
  });
  it("reads Vimeo finish and time", () => {
    expect(parseSignal("Vimeo", { event: "finish" })).toEqual({ kind: "ended" });
    expect(parseSignal("Vimeo", JSON.stringify({ event: "timeupdate", data: { seconds: 12 } }))).toEqual({ kind: "time", seconds: 12 });
  });
  it("ignores junk", () => {
    expect(parseSignal("YouTube", "not json")).toBeNull();
    expect(parseSignal("YouTube", null)).toBeNull();
    expect(parseSignal("Loom", { event: "finish" })).toBeNull();
  });
  it("adds a resume point and the API flag", () => {
    expect(withStart("https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0", "YouTube", 90)).toContain("start=90");
    expect(withStart("https://player.vimeo.com/video/123456?dnt=1", "Vimeo", 61)).toMatch(/#t=61s$/);
    expect(withStart("https://x/y", "YouTube", 2)).toBe("https://x/y");
    expect(withApi("https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0", "YouTube")).toContain("enablejsapi=1");
  });
});
