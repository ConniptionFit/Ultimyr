/**
 * A plain desk calculator, like the one in many vendor exam interfaces: operations run left to right as you press them
 * (2 + 3 × 4 = 20), with no operator precedence. Pure state machine, no eval.
 */
export type Op = "+" | "-" | "*" | "/";
export interface CalcState {
  /** What the display shows. */
  display: string;
  acc: number | null;
  op: Op | null;
  /** The next digit starts a new number. */
  fresh: boolean;
  error: boolean;
}
export const initialCalc: CalcState = { display: "0", acc: null, op: null, fresh: true, error: false };

const apply = (a: number, op: Op, b: number): number => (op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : a / b);
/** Trim float noise (0.1 + 0.2) and keep long results readable. */
const show = (n: number): string => {
  if (!Number.isFinite(n)) return "Error";
  const s = String(Number(n.toPrecision(12)));
  return s.length > 14 ? n.toExponential(6) : s;
};

export type CalcKey = { digit: string } | { op: Op } | "=" | "C" | "." | "sign" | "percent" | "sqrt" | "back";

export function press(s: CalcState, key: CalcKey): CalcState {
  if (s.error && key !== "C") return s;
  if (key === "C") return initialCalc;
  if (typeof key === "object" && "digit" in key) {
    const d = key.digit;
    if (!/^[0-9]$/.test(d)) return s;
    const display = s.fresh || s.display === "0" ? d : s.display.length >= 14 ? s.display : s.display + d;
    return { ...s, display, fresh: false };
  }
  if (key === ".") return s.fresh ? { ...s, display: "0.", fresh: false } : s.display.includes(".") ? s : { ...s, display: s.display + "." };
  if (key === "back") return s.fresh || s.display.length <= 1 || (s.display.length === 2 && s.display.startsWith("-")) ? { ...s, display: "0", fresh: true } : { ...s, display: s.display.slice(0, -1) };
  if (key === "sign") return s.display === "0" ? s : { ...s, display: s.display.startsWith("-") ? s.display.slice(1) : `-${s.display}` };
  if (key === "percent") return { ...s, display: show(Number(s.display) / 100), fresh: true };
  if (key === "sqrt") {
    const n = Number(s.display);
    return n < 0 ? { ...initialCalc, display: "Error", error: true } : { ...s, display: show(Math.sqrt(n)), fresh: true };
  }
  // An operator or equals: finish the pending operation first.
  const cur = Number(s.display);
  const result = s.acc !== null && s.op && !s.fresh ? apply(s.acc, s.op, cur) : s.acc !== null && s.op && s.fresh && key === "=" ? apply(s.acc, s.op, cur) : cur;
  if (!Number.isFinite(result)) return { ...initialCalc, display: "Error", error: true };
  if (key === "=") return { display: show(result), acc: null, op: null, fresh: true, error: false };
  return { display: show(result), acc: result, op: key.op, fresh: true, error: false };
}
