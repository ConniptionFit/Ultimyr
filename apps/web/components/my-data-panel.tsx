"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { collectMyData, myDataZip } from "@/lib/my-data";

/** Settings > Your data: one zip with everything the app can read about you, built in the browser. */
export function MyDataPanel() {
  const { api, state } = useAuth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function download() {
    if (state.status !== "authenticated") return;
    setBusy(true);
    setNote(null);
    try {
      const r = await collectMyData(api, state.user);
      const url = URL.createObjectURL(new Blob([myDataZip(r)], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ultimyr-my-data-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setNote(r.skipped.length ? `Downloaded, but could not read: ${r.skipped.join(", ")}.` : "Downloaded.");
    } catch {
      setNote("Could not build the download. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl">Your data</h2>
        <p className="text-sm text-muted">One zip with your archives, notes, credentials and progress, made in this browser. Passwords and keys are never included.</p>
      </div>
      <Button variant="quiet" onClick={download} disabled={busy}>
        {busy ? "Collecting…" : "Download my data"}
      </Button>
      <p role="status" className="text-sm text-muted">
        {note}
      </p>
    </section>
  );
}
