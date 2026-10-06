export interface AuditRow {
  id: number;
  ts: Date | string;
  actorId: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  metadata: unknown;
}

/** One CSV cell. Quotes when needed, and a leading = + - @ is prefixed with an apostrophe so a spreadsheet never runs it as a formula. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function auditCsv(rows: AuditRow[]): string {
  const head = ["id", "time", "actor", "action", "target", "address", "details"].join(",");
  const lines = rows.map((r) =>
    [r.id, r.ts instanceof Date ? r.ts.toISOString() : r.ts, r.actorId, r.action, r.target, r.ip, JSON.stringify(r.metadata ?? {})].map(csvCell).join(","),
  );
  return [head, ...lines].join("\r\n") + "\r\n";
}

export interface UserCsvRow {
  email: string;
  displayName: string;
  status: string;
  createdVia: string;
  createdAt: Date | string;
  roles: string[];
}

export function usersCsv(rows: UserCsvRow[]): string {
  const head = ["email", "name", "status", "created_via", "roles", "created"].join(",");
  const lines = rows.map((u) =>
    [u.email, u.displayName, u.status, u.createdVia, u.roles.join(" "), u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt].map(csvCell).join(","),
  );
  return [head, ...lines].join("\r\n") + "\r\n";
}
