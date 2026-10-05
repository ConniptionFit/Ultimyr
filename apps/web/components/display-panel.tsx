"use client";

import { Button, Toggle } from "@/components/ui";
import { useDisplay, type Display } from "@/lib/display";

export function Choice<T extends string | number>({ legend, value, options, onChange, hint }: { legend: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void; hint?: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm">{legend}</legend>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map(([v, label]) => (
          <label key={String(v)} className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:text-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
            <input type="radio" name={legend} className="sr-only" checked={value === v} onChange={() => onChange(v)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Settings: comfort and accessibility. Stored on this device only. */
export function DisplayPanel() {
  const { display, setDisplay } = useDisplay();
  return (
    <section className="space-y-5 border-t border-line pt-8" aria-label="Display and accessibility">
      <div>
        <h2 className="text-xl">Display and accessibility</h2>
        <p className="text-sm text-muted">Saved on this device.</p>
      </div>
      <Choice<Display["theme"]> legend="Theme" value={display.theme} onChange={(theme) => setDisplay({ theme })} options={[["system", "Match my device"], ["light", "Light"], ["dark", "Dark"]]} />
      <Choice<Display["size"]> legend="Text size" value={display.size} onChange={(size) => setDisplay({ size })} options={[["default", "Default"], ["large", "Large"], ["xlarge", "Extra large"]]} />
      <Toggle label="Readable text" hint="A wider spaced, evenly shaped font with more room between lines." on={display.readable} onChange={(readable) => setDisplay({ readable })} />
      <Toggle label="Calm mode" hint="Turn off animation and motion everywhere." on={display.calm} onChange={(calm) => setDisplay({ calm })} />
      <Toggle label="Flashcard flip" hint="A short, gentle turn when a flashcard shows its answer. Off when Calm mode is on or your device asks for less motion." on={display.flip} onChange={(flip) => setDisplay({ flip })} />
      <Choice<Display["extraTime"]>
        legend="Extra time on timed exams"
        hint="Adds time to the limit when you start a timed attempt. It is recorded on the attempt, and practice mode is not timed."
        value={display.extraTime}
        onChange={(extraTime) => setDisplay({ extraTime })}
        options={[[0, "None"], [25, "+25%"], [50, "+50%"], [100, "+100%"]]}
      />
      <Button variant="quiet" onClick={() => setDisplay({ theme: "system", size: "default", readable: false, calm: false, flip: false, extraTime: 0 })}>
        Reset to defaults
      </Button>
    </section>
  );
}
