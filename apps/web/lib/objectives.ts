"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import type { ObjectiveTreeNode } from "@/lib/certs";

/** An archive's exam objectives. `null` while loading; an empty list when there are none or they cannot be read. */
export function useObjectives(archiveId: string) {
  const { state, api } = useAuth();
  const [tree, setTree] = useState<ObjectiveTreeNode[] | null>(null);
  const load = useCallback(async () => {
    try {
      setTree((await api<{ objectives: ObjectiveTreeNode[] }>("GET", `archives/${archiveId}/objectives`)).objectives);
    } catch {
      setTree([]);
    }
  }, [api, archiveId]);
  useEffect(() => {
    if (state.status === "authenticated") void load();
  }, [state.status, load]);
  return { tree, reload: load };
}

/** "1.1 Install laptops" or just the title. */
export const objectiveLabel = (o: { code: string; title: string }) => (o.code ? `${o.code} ${o.title}` : o.title);
