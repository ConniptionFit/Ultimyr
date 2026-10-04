"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { MODE_LABEL, STATUS_LABEL, type Credential, type CredentialStatus, type ExamMode } from "@/lib/certs";
import type { Archive } from "@/lib/types";

const input = "w-full rounded-md border border-line bg-surface px-3 py-2 text-ink";

function Select({ id, label, children, ...rest }: { id: string; label: string; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <select id={id} className={input} {...rest}>
        {children}
      </select>
    </div>
  );
}

/** Add or edit one credential. Only the fields that matter for the chosen status are shown. */
export function CredentialForm({ initial, archives, onSaved, onCancel }: { initial?: Credential; archives: Archive[]; onSaved: () => void; onCancel: () => void }) {
  const { api } = useAuth();
  const [status, setStatus] = useState<CredentialStatus>(initial?.status ?? "planned");
  const [error, setError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const exam = status === "planned" || status === "scheduled";
  const earned = status === "earned";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    const day = (k: string) => text(k) || null;
    const num = (k: string) => (text(k) ? Number(text(k)) : null);
    const body = {
      name: text("name"),
      issuer: text("issuer"),
      archiveId: day("archive"),
      status,
      credentialNumber: text("number"),
      examDate: exam ? day("examDate") : null,
      examTime: exam ? day("examTime") : null,
      examMode: exam ? (text("examMode") as ExamMode) : "unknown",
      examLocation: exam ? text("examLocation") : "",
      voucherCode: exam ? text("voucher") : "",
      voucherExpires: exam ? day("voucherExpires") : null,
      earnedOn: earned ? day("earnedOn") : null,
      expiresOn: earned ? day("expiresOn") : null,
      renewalAlertDays: num("alertDays") ?? 90,
      ceuRequired: earned ? num("ceuRequired") : null,
      ceuUnit: text("ceuUnit") || "CEU",
      notes: text("notes"),
    };
    setBusy(true);
    setError([]);
    try {
      if (initial) await api("PATCH", `credentials/${initial.id}`, body);
      else await api("POST", "credentials", body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues.length ? err.issues : [err.code.replaceAll("_", " ")]) : ["Could not save."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-line p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="cr-name" name="name" label="Credential" defaultValue={initial?.name} placeholder="CompTIA A+ Core 1" required maxLength={160} autoFocus />
        <Field id="cr-issuer" name="issuer" label="Issued by (optional)" defaultValue={initial?.issuer} maxLength={120} />
        <Select id="cr-status" label="Where are you?" value={status} onChange={(e) => setStatus(e.target.value as CredentialStatus)}>
          {(Object.keys(STATUS_LABEL) as CredentialStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select id="cr-archive" label="Linked course (optional)" name="archive" defaultValue={initial?.archiveId ?? ""}>
          <option value="">None</option>
          {archives.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </Select>
      </div>

      {exam && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Exam</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="cr-exam-date" name="examDate" type="date" label="Exam date" defaultValue={initial?.examDate ?? ""} />
            <Field id="cr-exam-time" name="examTime" type="time" label="Start time (optional)" defaultValue={initial?.examTime ?? ""} />
            <Select id="cr-mode" label="How you will sit it" name="examMode" defaultValue={initial?.examMode ?? "unknown"}>
              {(Object.keys(MODE_LABEL) as ExamMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          </div>
          <Field id="cr-location" name="examLocation" label="Where (optional)" defaultValue={initial?.examLocation} maxLength={200} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cr-voucher" name="voucher" label="Voucher code (optional)" defaultValue={initial?.voucherCode} maxLength={200} autoComplete="off" />
            <Field id="cr-voucher-exp" name="voucherExpires" type="date" label="Voucher expires" defaultValue={initial?.voucherExpires ?? ""} />
          </div>
          <p className="text-xs text-muted">Only you can see this. It is stored as plain text on your server, so do not keep anything here you would not write in a notes app.</p>
        </fieldset>
      )}

      {earned && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Certification</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cr-earned" name="earnedOn" type="date" label="Earned on" defaultValue={initial?.earnedOn ?? ""} />
            <Field id="cr-expires" name="expiresOn" type="date" label="Expires on" defaultValue={initial?.expiresOn ?? ""} />
            <Field id="cr-number" name="number" label="Credential or candidate ID (optional)" defaultValue={initial?.credentialNumber} maxLength={120} />
            <Field id="cr-alert" name="alertDays" type="number" min={1} max={730} label="Remind me this many days before it expires" defaultValue={initial?.renewalAlertDays ?? 90} />
            <Field id="cr-ceu" name="ceuRequired" type="number" min={0.01} step="0.01" label="Continuing education needed to renew (optional)" defaultValue={initial?.ceuRequired ?? ""} />
            <Select id="cr-unit" label="Counted in" name="ceuUnit" defaultValue={initial?.ceuUnit ?? "CEU"}>
              {["CEU", "PDU", "CPE", "hours"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Select>
          </div>
        </fieldset>
      )}

      <div className="space-y-1">
        <label htmlFor="cr-notes" className="text-sm text-muted">
          Notes (optional)
        </label>
        <textarea id="cr-notes" name="notes" rows={2} maxLength={4000} defaultValue={initial?.notes} className={input} />
      </div>

      {error.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-danger">
          {error.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
