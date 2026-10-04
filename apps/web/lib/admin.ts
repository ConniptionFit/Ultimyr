import { ApiError } from "@/lib/auth";

export const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "never");
export const message = (e: unknown) => (e instanceof ApiError ? e.issues[0] ?? e.code.replaceAll("_", " ") : "Could not reach the server.");

export const ADMIN_SECTIONS = [
  { href: "/admin", label: "General" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/groups", label: "Groups" },
  { href: "/admin/sign-in", label: "Sign-in methods" },
  { href: "/admin/provisioning", label: "Provisioning" },
  { href: "/admin/notes", label: "Notes (Obsidian)" },
  { href: "/admin/audit", label: "Audit log" },
];
