"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

/** The splash call to action. People with a live session go straight in instead of back to the sign-in form. */
export function SplashCta({ label }: { label: string }) {
  const { state } = useAuth();
  const signedIn = state.status === "authenticated";
  return (
    <Link
      href={signedIn ? "/reading-room" : "/login"}
      className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition hover:brightness-90"
    >
      {signedIn ? "Continue" : label}
    </Link>
  );
}
