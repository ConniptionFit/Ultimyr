"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Shown when a page throws while rendering. Your work is saved on the server, so trying again is safe. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-32 text-center">
      <h1 className="text-3xl">Something went wrong</h1>
      <p className="mt-3 text-muted">This page hit a problem. Anything you saved is safe. Try again, and if it keeps happening, tell your admin{error.digest ? ` (reference ${error.digest})` : ""}.</p>
      <div className="mt-6 flex justify-center gap-4">
        <button onClick={reset} className="rounded-md bg-accent px-4 py-2 text-accent-ink">
          Try again
        </button>
        <Link href="/reading-room" className="self-center text-accent underline">
          Back to the reading room
        </Link>
      </div>
    </main>
  );
}
