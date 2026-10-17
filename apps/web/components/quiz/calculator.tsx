"use client";

import { useState } from "react";
import { initialCalc, press, type CalcKey } from "@/lib/calculator";

const ROWS: Array<Array<{ label: string; key: CalcKey; aria?: string }>> = [
  [{ label: "C", key: "C", aria: "Clear" }, { label: "⌫", key: "back", aria: "Backspace" }, { label: "%", key: "percent", aria: "Percent" }, { label: "÷", key: { op: "/" }, aria: "Divide" }],
  [{ label: "7", key: { digit: "7" } }, { label: "8", key: { digit: "8" } }, { label: "9", key: { digit: "9" } }, { label: "×", key: { op: "*" }, aria: "Multiply" }],
  [{ label: "4", key: { digit: "4" } }, { label: "5", key: { digit: "5" } }, { label: "6", key: { digit: "6" } }, { label: "−", key: { op: "-" }, aria: "Subtract" }],
  [{ label: "1", key: { digit: "1" } }, { label: "2", key: { digit: "2" } }, { label: "3", key: { digit: "3" } }, { label: "+", key: { op: "+" }, aria: "Add" }],
  [{ label: "±", key: "sign", aria: "Change sign" }, { label: "0", key: { digit: "0" } }, { label: ".", key: ".", aria: "Decimal point" }, { label: "=", key: "=", aria: "Equals" }],
];

/** A small desk calculator for quizzes that allow one. Works with the mouse and, while it has focus, the keyboard. */
export function Calculator() {
  const [s, setS] = useState(initialCalc);
  const send = (k: CalcKey) => setS((c) => press(c, k));
  const fromKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (/^[0-9]$/.test(k)) send({ digit: k });
    else if (k === ".") send(".");
    else if (k === "+" || k === "-") send({ op: k });
    else if (k === "*") send({ op: "*" });
    else if (k === "/") send({ op: "/" });
    else if (k === "Enter" || k === "=") send("=");
    else if (k === "Backspace") send("back");
    else if (k === "Escape" || k.toLowerCase() === "c") send("C");
    else if (k === "%") send("percent");
    else return;
    e.preventDefault();
  };
  return (
    <div role="group" aria-label="Calculator" tabIndex={0} onKeyDown={fromKey} className="w-64 max-w-full space-y-2 rounded-md border border-line bg-surface p-3">
      <p role="status" aria-live="polite" aria-label="Display" className="truncate rounded bg-bg px-3 py-2 text-right font-mono text-xl">
        {s.display}
      </p>
      <div className="grid grid-cols-4 gap-1">
        {ROWS.flat().map((b) => (
          <button key={b.label} type="button" aria-label={b.aria} onClick={() => send(b.key)} className="h-10 rounded-md border border-line text-lg hover:bg-line">
            {b.label}
          </button>
        ))}
        <button type="button" aria-label="Square root" onClick={() => send("sqrt")} className="col-span-4 h-9 rounded-md border border-line text-sm hover:bg-line">
          Square root
        </button>
      </div>
    </div>
  );
}
