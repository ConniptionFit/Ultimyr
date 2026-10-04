import {
  Award, BookOpen, Brain, Cloud, Code, Cpu, Database, Globe, GraduationCap, HardDrive, Key, Laptop, Library, Lock, Network, Router, Server, Shield, Terminal, Wifi,
  type LucideIcon,
} from "lucide-react";

/** Icons offered in the picker. The API accepts any Lucide name; unknown names fall back to a book. */
export const ICONS: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  "graduation-cap": GraduationCap,
  award: Award,
  library: Library,
  brain: Brain,
  cpu: Cpu,
  "hard-drive": HardDrive,
  laptop: Laptop,
  network: Network,
  router: Router,
  wifi: Wifi,
  server: Server,
  database: Database,
  cloud: Cloud,
  shield: Shield,
  lock: Lock,
  key: Key,
  terminal: Terminal,
  code: Code,
  globe: Globe,
};
export const iconFor = (name: string | undefined | null): LucideIcon => (name && ICONS[name]) || BookOpen;
