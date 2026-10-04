"use client";

import { ArchiveIcon, StatusIcon } from "@ultimyr/ui-icons";
import { Plus, Library } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/header";
import { Button, Shell } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

export default function ReadingRoom() {
  const { state } = useAuth();
  const { t, copy } = useNaming();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state.status, router]);

  return (
    <>
      <Header />
      <Shell>
        {state.status !== "authenticated" ? (
          <StatusIcon status="loading" size={22} />
        ) : (
          <div className="ulti-fade space-y-10">
            <div>
              <h1 className="text-3xl">{t("dashboard")}</h1>
              <p className="text-muted">Welcome, {state.user.displayName}.</p>
            </div>
            <section className="rounded-lg border border-dashed border-line p-10 text-center">
              <div className="mx-auto mb-4 flex justify-center text-muted">
                <ArchiveIcon fallback={Library} size={32} />
              </div>
              <h2 className="text-xl">{t("archives")}</h2>
              <p className="mx-auto mt-2 max-w-sm text-muted">{copy("emptyArchives")}</p>
              <Button variant="quiet" className="mt-5" disabled title="Arrives in Phase 3">
                <Plus size={16} aria-hidden /> New {t("archive").toLowerCase()}
              </Button>
            </section>
          </div>
        )}
      </Shell>
    </>
  );
}
