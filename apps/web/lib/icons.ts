import {
  Award, BookOpen, Brain, Cloud, Code, Cpu, Database, Globe, GraduationCap, HardDrive, Key, Laptop, Library, Lock, Network, Router, Server, Shield, Terminal, Wifi,
  type LucideIcon,
} from "lucide-react";
import { createElement } from "react";
import { CatalogIcon } from "@/components/catalog-icon";

/** Icons offered first in the picker. The API accepts any icon in the bundled Lucide library (search for more). */
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
const drawn = new Map<string, LucideIcon>();
/**
 * An icon component by name. The twenty common ones are bundled; any other name from the Lucide library is drawn from
 * shapes fetched on demand (see CatalogIcon), so automatic icon picks of any kind show up.
 */
export function iconFor(name: string | undefined | null): LucideIcon {
  if (!name) return BookOpen;
  if (ICONS[name]) return ICONS[name];
  if (!/^[a-z0-9-]{1,60}$/.test(name)) return BookOpen;
  let c = drawn.get(name);
  if (!c) {
    c = ((props: Record<string, unknown>) => createElement(CatalogIcon, { name, ...props })) as unknown as LucideIcon;
    drawn.set(name, c);
  }
  return c;
}
