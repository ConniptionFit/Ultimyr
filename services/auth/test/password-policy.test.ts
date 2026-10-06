import { describe, expect, it } from "vitest";
import { passwordIssue } from "../src/password-policy.js";

describe("passwordIssue", () => {
  it("rejects common passwords whatever the case", () => {
    expect(passwordIssue("Password12345")).toBeTruthy();
    expect(passwordIssue("QWERTYUIOP12")).toBeTruthy();
  });
  it("rejects repeats and runs", () => {
    expect(passwordIssue("aaaaaaaaaaaa")).toBeTruthy();
    expect(passwordIssue("abababababab")).toBeTruthy();
    expect(passwordIssue("abcabcabcabc")).toBeTruthy();
    expect(passwordIssue("abcdefghijkl")).toBeTruthy();
    expect(passwordIssue("123456789013")).toBeNull();
  });
  it("rejects the email name inside the password", () => {
    expect(passwordIssue("johnsmith-2026-x", "johnsmith@example.com")).toBeTruthy();
    expect(passwordIssue("johnsmith-2026-x", "bo@example.com")).toBeNull();
  });
  it("accepts a normal passphrase", () => {
    expect(passwordIssue("correct horse battery")).toBeNull();
    expect(passwordIssue("yet another passphrase")).toBeNull();
  });
});
