"use client";

import { CalendarClock, Check, ChevronDown, Copy, Pencil, Ticket, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CeuLog } from "@/components/credentials/ceu-log";
import { CredentialForm } from "@/components/credentials/credential-form";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { MODE_LABEL, STATUS_LABEL, daysText, formatDay, type Credential } from "@/lib/certs";
import type { Archive } from "@/lib/types";

export function CredentialCard({ c, archives, reload }: { c: Credential; archives: Archive[]; reload: () => void }) {
  const { api } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => undefined);
  };
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const archive = archives.find((a) => a.id === c.archiveId);
  const upcoming = c.status === "planned" || c.status === "scheduled";

  if (editing)
    return (
      <li>
        <CredentialForm
          initial={c}
          archives={archives}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      </li>
    );

  const examLeft = c.alerts.find((a) => a.kind.startsWith("exam_"))?.daysLeft;
  return (
    <li className="space-y-3 rounded-md border border-line p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 break-words font-serif text-lg" title={c.name}>{c.name}</h3>
          <p className="text-sm text-muted">{[STATUS_LABEL[c.status], c.issuer, archive ? `course: ${archive.title}` : null].filter(Boolean).join(" · ")}</p>
        </div>
        <Button variant="quiet" aria-label={`Edit ${c.name}`} onClick={() => setEditing(true)}>
          <Pencil size={16} aria-hidden />
        </Button>
        <Button
          variant="quiet"
          aria-label={`Delete ${c.name}`}
          onClick={async () => {
            if (!confirm(`Delete ${c.name} and its continuing education log? This cannot be undone.`)) return;
            await api("DELETE", `credentials/${c.id}`);
            reload();
          }}
        >
          <Trash2 size={16} aria-hidden />
        </Button>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {upcoming && c.examDate && (
          <Row k="Exam">
            {formatDay(c.examDate)}
            {c.examTime ? ` at ${c.examTime}` : ""}
            {examLeft !== undefined && examLeft !== null ? ` (${daysText(examLeft)})` : ""}
          </Row>
        )}
        {upcoming && c.examMode !== "unknown" && <Row k="Format">{[MODE_LABEL[c.examMode], c.examLocation].filter(Boolean).join(", ")}</Row>}
        {upcoming && c.voucherCode && (
          <Row k="Voucher">
            <span className="inline-flex items-center gap-1">
              <Ticket size={14} aria-hidden />
              <code>{c.voucherCode}</code>
              <button onClick={() => copy("voucher", c.voucherCode)} aria-label="Copy voucher code" title="Copy voucher code" className="rounded p-1 text-muted hover:text-ink">
                {copied === "voucher" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              </button>
            </span>
            {c.voucherExpires ? ` (expires ${formatDay(c.voucherExpires)})` : ""}
          </Row>
        )}
        {c.status === "earned" && c.earnedOn && <Row k="Earned">{formatDay(c.earnedOn)}</Row>}
        {c.status === "earned" && c.expiresOn && <Row k="Expires">{formatDay(c.expiresOn)}</Row>}
        {c.credentialNumber && (
          <Row k="ID">
            {c.credentialNumber}
            <button onClick={() => copy("id", c.credentialNumber)} aria-label="Copy credential ID" title="Copy credential ID" className="ml-1 rounded p-1 align-middle text-muted hover:text-ink">
              {copied === "id" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            </button>
          </Row>
        )}
      </dl>
      {c.notes && <p className="whitespace-pre-line text-sm text-muted">{c.notes}</p>}

      {c.alerts.length > 0 && (
        <ul className="space-y-1 text-sm">
          {c.alerts.map((a, i) => (
            <li key={i} className={a.severity === "urgent" ? "text-danger" : ""}>
              {a.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        {upcoming && c.examDate && c.archiveId && (
          <Link href={`/exam-day?credential=${c.id}`} className="inline-flex items-center gap-1 text-accent underline">
            <CalendarClock size={14} aria-hidden /> Countdown plan
          </Link>
        )}
        {upcoming && c.examDate && !c.archiveId && <span className="text-muted">Link a course to get a countdown plan.</span>}
        {c.archiveId && (
          <Link href={`/archives/${c.archiveId}#coverage`} className="text-accent underline">
            Coverage
          </Link>
        )}
        {c.status === "earned" && (
          <button className="ml-auto inline-flex items-center gap-1 text-muted hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
            Continuing education <ChevronDown size={14} aria-hidden className={open ? "rotate-180" : ""} />
          </button>
        )}
      </div>
      {c.status === "earned" && open && <CeuLog credential={c} onChange={reload} />}
    </li>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
