export interface QuickStats {
  passingScore?: string;
  durationMinutes?: number;
  questionCount?: number;
  costUsd?: number;
  difficulty?: "beginner" | "intermediate" | "advanced" | "expert";
}
export interface Archive {
  id: string;
  ownerId: string;
  slug: string;
  title: string;
  overview: string;
  vendor: string | null;
  purchaseLinks: { label: string; url: string }[];
  validityMonths: number | null;
  quickStats: QuickStats;
  icon: { kind: "lucide" | "upload"; name: string; assetId: string | null; url: string | null };
  visibility: "private" | "shared" | "org" | "public";
  tags: string[];
  relation: "none" | "attempt" | "viewer" | "editor" | "owner";
  itemCount?: number;
  items?: ItemSummary[];
}
export interface ItemSummary {
  id: string;
  archiveId: string;
  kind: "guide" | "deck" | "quiz";
  title: string;
  summary: string;
  status: "draft" | "published";
  aiStatus: "none" | "draft" | "reviewed";
  relation: Archive["relation"];
}
export interface Section {
  order: number;
  anchor: string;
  heading: string;
  body: string;
}
export interface Card {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  tags: string[];
}
export interface ItemDetail extends ItemSummary {
  archive: { id: string; title: string };
  markdown?: string;
  sections?: Section[];
  version?: { number: number; source: string; createdAt: string } | null;
  cards?: Card[];
}
export interface Grant {
  id: string;
  subjectType: "user" | "group";
  subjectId: string;
  relation: "attempt" | "viewer" | "editor" | "owner";
  expiresAt: string | null;
}
export const canEdit = (r: Archive["relation"]) => r === "editor" || r === "owner";
