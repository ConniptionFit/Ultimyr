"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { AUTO_ICON, IconPicker } from "@/components/icon-picker";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import type { Archive } from "@/lib/types";

/** Edit an archive's details, facts, links and icon. Deleting lives here too, for the owner. */
export function ArchiveEditForm({ archive: a, onSaved, onCancel, onError, onChanged }: { archive: Archive; onSaved: () => Promise<void>; onCancel: () => void; onError: (m: string | null) => void; onChanged: () => Promise<void> }) {
  const { state, api } = useAuth();
  const { copy } = useNaming();
  const router = useRouter();
  const id = a.id;
  const stats = a.quickStats;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const links = String(f.get("link") ?? "").trim();
    try {
      await api("PATCH", `archives/${a.id}`, {
        title: String(f.get("title")).trim(),
        overview: String(f.get("overview")),
        vendor: String(f.get("vendor")).trim() || null,
        ...(f.get("icon") === AUTO_ICON ? { iconName: null } : f.get("icon") ? { iconName: String(f.get("icon")) } : {}),
        validityMonths: Number(f.get("validity")) || null,
        quickStats: {
          ...(String(f.get("passing")).trim() ? { passingScore: String(f.get("passing")).trim() } : {}),
          ...(Number(f.get("duration")) ? { durationMinutes: Number(f.get("duration")) } : {}),
          ...(Number(f.get("questions")) ? { questionCount: Number(f.get("questions")) } : {}),
          ...(Number(f.get("cost")) ? { costUsd: Number(f.get("cost")) } : {}),
          ...(f.get("difficulty") ? { difficulty: String(f.get("difficulty")) } : {}),
        },
        purchaseLinks: links ? [{ label: "Buy or schedule", url: links }] : [],
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? (err.issues[0] ?? err.code.replaceAll("_", " ")) : "Could not save.");
    }
  }

  async function uploadIcon(file: File) {
    onError(null);
    const res = await fetch(`/api/v1/archives/${a.id}/icon`, {
      method: "POST",
      headers: { "content-type": "image/png", authorization: `Bearer ${state.status === "authenticated" ? state.accessToken : ""}` },
      body: file,
    });
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      onError(
        code === "icon_needs_transparency" ? "Icons must be PNGs with a transparent background." : code === "icon_bad_dimensions" ? "Icons must be between 16 and 1024 pixels." : code === "icon_too_large" ? "That file is over 512 KB." : "That is not a usable PNG.",
      );
      return;
    }
    await onChanged();
  }


  return (
    <form onSubmit={save} className="space-y-3 rounded-md border border-line p-4">
        <Field id="e-title" name="title" label="Name" defaultValue={a.title} required maxLength={120} />
        <Field id="e-vendor" name="vendor" label="Vendor" defaultValue={a.vendor ?? ""} maxLength={120} />
        <div className="space-y-1">
          <label htmlFor="e-overview" className="text-sm text-muted">
            Overview
          </label>
          <textarea id="e-overview" name="overview" defaultValue={a.overview} rows={4} maxLength={10000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="e-passing" name="passing" label="Passing score" defaultValue={stats.passingScore ?? ""} />
          <Field id="e-duration" name="duration" type="number" min={1} label="Minutes" defaultValue={stats.durationMinutes ?? ""} />
          <Field id="e-questions" name="questions" type="number" min={1} label="Questions" defaultValue={stats.questionCount ?? ""} />
          <Field id="e-cost" name="cost" type="number" min={0} step="0.01" label="Cost (USD)" defaultValue={stats.costUsd ?? ""} />
          <Field id="e-validity" name="validity" type="number" min={1} label="Valid for (months)" defaultValue={a.validityMonths ?? ""} />
          <div className="space-y-1">
            <label htmlFor="e-difficulty" className="text-sm text-muted">
              Difficulty
            </label>
            <select id="e-difficulty" name="difficulty" defaultValue={stats.difficulty ?? ""} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
              <option value="">Not set</option>
              {["beginner", "intermediate", "advanced", "expert"].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
        <Field id="e-link" name="link" type="url" label="Purchase or scheduling link" defaultValue={a.purchaseLinks[0]?.url ?? ""} />
        <fieldset className="space-y-2">
          <legend className="text-sm text-muted">Icon</legend>
          <IconPicker archiveId={id} icon={a.icon} />
          <label className="block text-sm text-muted">
            Or upload a PNG with a transparent background (16 to 1024 px, up to 512 KB)
            <input type="file" accept="image/png" className="mt-1 block max-w-full text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-bg" onChange={(e) => e.target.files?.[0] && uploadIcon(e.target.files[0])} />
          </label>
        </fieldset>
        <div className="flex gap-2">
          <Button type="submit">Save</Button>
          <Button type="button" variant="quiet" onClick={() => onCancel()}>
            Cancel
          </Button>
          {a.relation === "owner" && (
            <Button
              type="button"
              variant="quiet"
              className="ml-auto text-danger"
              onClick={async () => {
                if (!confirm(copy("deleteConfirm"))) return;
                await api("DELETE", `archives/${id}`);
                router.push("/reading-room");
              }}
            >
              <Trash2 size={16} /> Delete
            </Button>
          )}
        </div>
      </form>
  );
}
