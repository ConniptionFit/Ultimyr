import { zip } from "./zip";

type Api = <T>(method: string, path: string, body?: unknown) => Promise<T>;
interface ArchiveRow { id: string; slug: string; title: string; relation?: string }

export interface MyDataResult {
  files: { path: string; text: string }[];
  skipped: string[];
}

const safe = (s: string) => s.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";
const json = (v: unknown) => JSON.stringify(v, null, 2);

/**
 * Collects what Ultimyr holds about you, using only the calls the app already makes as you: your profile,
 * every archive you own (the same file Export gives), your credentials, quiz attempts, progress and notes.
 * A part that cannot be read is listed in `skipped` instead of stopping the download.
 */
export async function collectMyData(api: Api, profile: unknown, now = new Date()): Promise<MyDataResult> {
  const files: { path: string; text: string }[] = [];
  const skipped: string[] = [];
  const grab = async (label: string, path: string, run: () => Promise<string>) => {
    try {
      files.push({ path, text: await run() });
    } catch {
      skipped.push(label);
    }
  };

  files.push({ path: "profile.json", text: json(profile) });
  await grab("credentials", "credentials.json", async () => json(await api("GET", "credentials")));
  await grab("quiz attempts", "attempts.json", async () => json(await api("GET", "attempts")));
  await grab("progress", "progress.json", async () => json(await api("GET", "analytics?days=365")));

  let archives: ArchiveRow[] = [];
  try {
    archives = (await api<{ archives: ArchiveRow[] }>("GET", "archives?scope=mine")).archives;
  } catch {
    skipped.push("archives");
  }
  const used = new Set<string>();
  for (const a of archives) {
    let name = safe(a.slug || a.title);
    for (let n = 2; used.has(name); n++) name = `${safe(a.slug || a.title)}-${n}`;
    used.add(name);
    await grab(`archive ${a.title}`, `archives/${name}.ultimyr.json`, async () => json(await api("GET", `archives/${a.id}/export`)));
    await grab(`notes for ${a.title}`, `notes/${name}.json`, async () => json(await api("GET", `notes/archives/${a.id}/text`)));
  }

  files.push({
    path: "README.txt",
    text: [
      `Your Ultimyr data, collected ${now.toISOString()}.`,
      "archives/  each archive you own, in the format Export and Import use.",
      "notes/     your step notes per archive.",
      "attempts.json, credentials.json, progress.json, profile.json  your records and account details.",
      "Passwords, API keys and AI keys are never included.",
      skipped.length ? `Could not read: ${skipped.join(", ")}.` : "Everything was read.",
    ].join("\n"),
  });
  return { files, skipped };
}

export const myDataZip = (r: MyDataResult) => zip(r.files);
