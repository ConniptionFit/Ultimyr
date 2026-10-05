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
  icon: { kind: "lucide" | "upload"; name: string; source?: "default" | "auto" | "user"; assetId: string | null; url: string | null };
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

export const RESOURCE_KINDS = ["video", "playlist", "article", "course", "docs", "practice", "book", "podcast", "other"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export interface Resource {
  id: string;
  archiveId: string;
  kind: ResourceKind;
  title: string;
  url: string;
  provider: string;
  summary: string;
  minutes: number | null;
  tags: string[];
  status: "draft" | "published";
}
export interface RoadmapStep {
  id: string;
  kind: "item" | "resource" | "milestone";
  required: boolean;
  minutes: number | null;
  note: string;
  /** Canonical tags (namespace:value) set on this step. */
  tagSet?: string[];
  icon?: { name: string | null; source: "none" | "auto" | "user" };
  done: boolean;
  /** Steps inside this one. Only leaves carry a tick; a parent is done when what it requires is done. */
  children: RoadmapStep[];
  progress?: { done: number; total: number };
  /** For a parent: the minutes of everything inside it. */
  minutesTotal?: number | null;
  effectiveRequired?: boolean;
  title?: string;
  item?: { id: string; kind: ItemSummary["kind"]; title: string; summary: string; status: "draft" | "published" };
  resource?: Resource;
}
export interface RoadmapTotals {
  steps: number;
  required: number;
  done: number;
  doneRequired: number;
  percent: number;
  minutes: number;
  minutesLeft: number;
}
export interface RoadmapNext {
  stepId: string;
  title: string;
  kind: RoadmapStep["kind"];
}
export interface Roadmap {
  archiveId: string;
  exists: boolean;
  status: "draft" | "published" | null;
  summary: string;
  stages: { id: string; title: string; summary: string; tagSet?: string[]; icon?: { name: string | null; source: "none" | "auto" | "user" }; progress: { done: number; total: number }; steps: RoadmapStep[] }[];
  totals: RoadmapTotals;
  next: RoadmapNext | null;
}
export interface RoadmapSummary {
  archiveId: string;
  title: string;
  icon: { kind: "lucide" | "upload"; name: string; url: string | null };
  started: boolean;
  totals: RoadmapTotals;
  next: RoadmapNext | null;
}
/** Only https links are ever rendered as links. */
export const safeHref = (u: string) => (/^https:\/\//i.test(u) ? u : undefined);
