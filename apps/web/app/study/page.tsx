"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Header } from "@/components/header";
import { StudyQueuePanel } from "@/components/study-queue";
import { Shell } from "@/components/ui";

function Study() {
  const params = useSearchParams();
  return (
    <>
      <Header />
      <Shell>
        <StudyQueuePanel archive={params.get("archive")} deck={params.get("deck")} />
      </Shell>
    </>
  );
}

export default function StudyPage() {
  return (
    <Suspense>
      <Study />
    </Suspense>
  );
}
