"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant="quiet"
      className="px-3 py-1"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          setOk(false);
        }
      }}
    >
      {ok ? "Copied" : "Copy"}
    </Button>
  );
}
