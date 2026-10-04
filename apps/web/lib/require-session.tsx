"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Header } from "@/components/header";
import { Loading } from "@/components/loading";
import { Shell } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/**
 * Page frame for signed-in screens. Sends anonymous visitors to sign in, and with `admin` shows a
 * plain "not allowed" screen unless the person holds the platform_admin role. The admin API enforces
 * the same rule on every call, so this only decides what to render.
 */
export function RequireSession({ children, admin = false, wide = false }: { children: ReactNode; admin?: boolean; wide?: boolean }) {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state.status, router]);

  let body: ReactNode;
  if (state.status !== "authenticated") body = <Loading />;
  else if (admin && !state.user.roles.includes("platform_admin")) {
    body = (
      <div className="space-y-2">
        <h1 className="text-3xl">Not available</h1>
        <p className="text-sm text-muted">The admin panel is only open to administrators.</p>
      </div>
    );
  } else body = children;
  return (
    <>
      <Header />
      <Shell wide={wide}>{body}</Shell>
    </>
  );
}
