import type { TermKey } from "@ultimyr/lore";
import { ApiError } from "@/lib/auth";

export const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "never");
export const message = (e: unknown) => (e instanceof ApiError ? e.issues[0] ?? e.code.replaceAll("_", " ") : "Could not reach the server.");

/** `delegate` sections are also open to people with the curriculum_admin role. */
export const ADMIN_SECTIONS: Array<{ href: string; label: string; term?: TermKey; delegate?: boolean }> = [
  { href: "/admin", label: "General" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/groups", label: "Groups" },
  { href: "/admin/group-access", label: "Group access", term: "groupAccess", delegate: true },
  { href: "/admin/sign-in", label: "Sign-in methods" },
  { href: "/admin/provisioning", label: "Provisioning" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/about", label: "About this app", term: "about" },
];
