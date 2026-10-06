"use client";

import { useEffect, useState } from "react";

/** A quiet strip along the bottom while the browser has no connection, so a failed save is not a mystery. It leaves by itself when the connection returns. */
export function OfflineNotice() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return (
    <div role="status" aria-live="polite">
      {offline && (
        <p className="no-print fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface px-4 py-2 text-center text-sm text-muted">
          You are offline. Changes may not save until you are back online.
        </p>
      )}
    </div>
  );
}
