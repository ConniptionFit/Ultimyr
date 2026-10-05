import { describe, expect, it } from "vitest";
import { crc32, zip } from "./zip";

describe("zip", () => {
  it("computes the standard crc32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("writes a readable store-only archive", () => {
    const z = zip([{ path: "a/SKILL.md", text: "hello" }]);
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(1);
    expect(new TextDecoder().decode(z.slice(30 + 10, 30 + 10 + 5))).toBe("hello");
  });
});
