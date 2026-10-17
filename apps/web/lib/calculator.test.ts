import { describe, expect, it } from "vitest";
import { initialCalc, press, type CalcKey, type CalcState } from "./calculator";

const run = (keys: CalcKey[]): CalcState => keys.reduce(press, initialCalc);
const d = (s: string): CalcKey[] => [...s].map((c) => (c === "." ? "." : { digit: c }) as CalcKey);

describe("calculator", () => {
  it("adds and multiplies left to right with no precedence", () => {
    expect(run([...d("2"), { op: "+" }, ...d("3"), { op: "*" }, ...d("4"), "="]).display).toBe("20");
  });
  it("trims float noise", () => {
    expect(run([...d("0.1"), { op: "+" }, ...d("0.2"), "="]).display).toBe("0.3");
  });
  it("divides, and reports division by zero as an error until cleared", () => {
    expect(run([...d("9"), { op: "/" }, ...d("4"), "="]).display).toBe("2.25");
    const e = run([...d("1"), { op: "/" }, ...d("0"), "="]);
    expect(e.error).toBe(true);
    expect(press(e, { digit: "5" })).toBe(e);
    expect(press(e, "C")).toEqual(initialCalc);
  });
  it("handles sign, percent, square root and backspace", () => {
    expect(run([...d("5"), "sign"]).display).toBe("-5");
    expect(run([...d("50"), "percent"]).display).toBe("0.5");
    expect(run([...d("144"), "sqrt"]).display).toBe("12");
    expect(run([...d("-4".slice(1)), "sign", "sqrt"]).error).toBe(true);
    expect(run([...d("123"), "back"]).display).toBe("12");
    expect(run([...d("1"), "back"]).display).toBe("0");
  });
  it("repeats the last operand when equals is pressed after an operator", () => {
    expect(run([...d("6"), { op: "*" }, "="]).display).toBe("36");
  });
  it("does not allow a second decimal point or an endless number", () => {
    expect(run([...d("1.2"), "."]).display).toBe("1.2");
    expect(run(d("12345678901234567890")).display.length).toBe(14);
  });
});
