"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/admin/copy-button";

/** A ready-to-paste prompt with the connection address beside it. */
export function PromptBox({ prompt, label }: { prompt: string; label: string }) {
  const [address, setAddress] = useState("");
  useEffect(() => setAddress(`${window.location.origin}/mcp`), []);
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-line bg-bg p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">{label}</span>
          <CopyButton text={prompt} label={label} />
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm text-ink" tabIndex={0} aria-label={label}>
          {prompt}
        </pre>
      </div>
      <p className="text-sm text-muted">
        Not connected yet? In Claude, add a custom connector with this address, sign in to Ultimyr and approve it:{" "}
        <code className="rounded bg-surface px-1">{address || "/mcp"}</code> <CopyButton text={address} label="connection address" />{" "}
        <Link href="/settings#apps" className="underline">
          Connected apps
        </Link>
      </p>
    </div>
  );
}
