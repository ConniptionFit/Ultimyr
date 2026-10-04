"use client";

import { Maximize2 } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui";
import { useDisplay } from "@/lib/display";

/** Hides the navigation so only the task is left. Always switched off again when the page is left. */
export function FocusButton() {
  const { setFocus } = useDisplay();
  useEffect(() => () => setFocus(false), [setFocus]);
  return (
    <Button variant="quiet" onClick={() => setFocus(true)}>
      <Maximize2 size={14} aria-hidden /> Focus
    </Button>
  );
}
