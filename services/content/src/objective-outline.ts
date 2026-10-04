/**
 * A plain text exam outline becomes a list of domains and objectives, so a vendor's objective list can be pasted in one go.
 *
 *   ## 1.0 Mobile Devices (15%)                 a domain, with its exam weight
 *   - 1.1 Install and configure laptop hardware an objective inside it
 *   - 1.2 Compare display types
 *   ## Domain 2: Networking (20%)               "Domain 2:" works too
 */
export interface ParsedObjective {
  code: string;
  title: string;
  weightBp: number | null;
}
export interface ParsedDomain extends ParsedObjective {
  children: ParsedObjective[];
}
export interface ParsedObjectives {
  domains: ParsedDomain[];
  warnings: string[];
}

const CODE = /^(?:domain|objective|section)?\s*(\d+(?:\.\d+)*)[.):]?\s+(?=\S)/i;
const WEIGHT = /\s*[(\[]\s*(\d+(?:\.\d+)?)\s*%\s*[)\]]\s*/;
const MAX_DOMAINS = 40;
const MAX_PER_DOMAIN = 40;

function parseLine(raw: string, warnings: string[], n: number): ParsedObjective | null {
  let text = raw.replace(/^[-*+]\s+/, "").replace(/^\[[ xX]\]\s+/, "").trim();
  text = text.replace(/[*_`]/g, "").trim();
  let weightBp: number | null = null;
  const w = WEIGHT.exec(text);
  if (w) {
    const pct = Number(w[1]);
    if (pct > 100) warnings.push(`Line ${n}: ${pct}% is more than 100%, so the weight was ignored.`);
    else weightBp = Math.round(pct * 100);
    text = text.replace(w[0], " ").trim();
  }
  let code = "";
  const c = CODE.exec(text);
  if (c) {
    code = c[1]!;
    text = text.slice(c[0].length).trim();
  }
  text = text.replace(/\s{2,}/g, " ").replace(/^[-–:]\s*/, "").trim();
  if (!text) return null;
  return { code: code.slice(0, 20), title: text.slice(0, 300), weightBp };
}

export function parseObjectives(md: string): ParsedObjectives {
  const warnings: string[] = [];
  const domains: ParsedDomain[] = [];
  let domain: ParsedDomain | null = null;
  const lines = md.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  for (const [i, line] of lines.entries()) {
    const heading = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const d = parseLine(heading[1]!, warnings, i + 1);
      if (!d) continue;
      domain = { ...d, children: [] };
      domains.push(domain);
      continue;
    }
    if (!line.trim()) continue;
    const o = parseLine(line.trim(), warnings, i + 1);
    if (!o) continue;
    if (!domain) {
      domain = { code: "", title: "Objectives", weightBp: null, children: [] };
      domains.push(domain);
    }
    domain.children.push({ ...o, weightBp: null });
  }
  if (domains.length > MAX_DOMAINS) warnings.push(`Only the first ${MAX_DOMAINS} domains were kept.`);
  for (const d of domains) if (d.children.length > MAX_PER_DOMAIN) warnings.push(`"${d.title}" has more than ${MAX_PER_DOMAIN} objectives; the rest were dropped.`);
  const kept = domains.slice(0, MAX_DOMAINS).map((d) => ({ ...d, children: d.children.slice(0, MAX_PER_DOMAIN) }));
  const total = kept.reduce((s, d) => s + (d.weightBp ?? 0), 0);
  if (total > 10_000) warnings.push(`Domain weights add up to ${(total / 100).toFixed(0)}%, which is more than 100%.`);
  return { domains: kept, warnings };
}
