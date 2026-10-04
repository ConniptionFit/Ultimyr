"use client";

import { AlertTriangle, BellRing } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import type { Alert } from "@/lib/certs";

/** The few things in your credentials that need attention soon. Shows nothing when all is quiet or the service is unavailable. */
export function AlertsBanner() {
  const { state, api } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    if (state.status !== "authenticated") return;
    api<{ alerts: Alert[] }>("GET", "credentials/alerts")
      .then((r) => setAlerts(r.alerts))
      .catch(() => setAlerts([]));
  }, [state.status, api]);

  if (!alerts.length) return null;
  const shown = alerts.slice(0, 3);
  const urgent = alerts.some((a) => a.severity === "urgent");
  return (
    <section aria-labelledby="alerts-h" className={`space-y-2 rounded-md border p-4 ${urgent ? "border-danger" : "border-line"}`}>
      <h2 id="alerts-h" className="flex items-center gap-2 text-sm font-medium">
        {urgent ? <AlertTriangle size={16} aria-hidden /> : <BellRing size={16} aria-hidden />}
        Needs attention
      </h2>
      <ul className="space-y-1 text-sm">
        {shown.map((a, i) => (
          <li key={`${a.credentialId}-${a.kind}-${i}`} className={a.severity === "urgent" ? "text-danger" : ""}>
            {a.message}
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <Link href="/credentials" className="text-accent underline">
          {alerts.length > shown.length ? `See all ${alerts.length}` : "Open credentials"}
        </Link>
      </p>
    </section>
  );
}
