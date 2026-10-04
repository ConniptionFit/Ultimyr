/** Data for Admin panel > About: the running build, the latest release on GitHub and the matching changelog. */

declare const __BUILD_INFO__: { version: string; commit: string; builtAt: string } | undefined;

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string | null;
}

/** Baked in by tsup at image build time. Plain `tsx` and tests have none, so they report a development build. */
export function currentBuild(): BuildInfo {
  const b = typeof __BUILD_INFO__ === "undefined" ? undefined : __BUILD_INFO__;
  return { version: b?.version ?? "dev", commit: b?.commit ?? "", builtAt: b?.builtAt ?? null };
}

export type UpdateStatus = "current" | "behind" | "unknown" | "disabled";

export interface AboutLatest {
  version: string;
  url: string;
  publishedAt: string | null;
}

export interface About {
  name: string;
  repo: { name: string; url: string };
  build: BuildInfo & { commitUrl: string | null };
  update: {
    status: UpdateStatus;
    checkedAt: string | null;
    /** Newest GitHub release, if the repository has one. */
    latest: AboutLatest | null;
    /** True when the newest release is newer than this build's version. */
    newRelease: boolean;
    /** Changes on the main branch that this build does not have (when the commit is known). */
    commitsBehind: number | null;
    /** Why a check did not complete, for example "offline". */
    reason: string | null;
  };
  changelog: { title: string; body: string } | null;
  links: Record<"repo" | "docs" | "changelog" | "issues" | "security" | "license" | "releases", string>;
  license: string;
}

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface AboutOptions {
  repo: string;
  enabled: boolean;
  build?: BuildInfo;
  fetch?: Fetch;
  now?: () => number;
}

const OK_TTL_MS = 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;
const MIN_REFRESH_MS = 30 * 1000;
const MAX_CHANGELOG = 12_000;

/** Compare dotted versions ("v1.2.3" or "1.2"). Returns <0, 0 or >0; non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const nums = (v: string) => v.replace(/^v/i, "").split(/[-+]/)[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const x = nums(a);
  const y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** One `## Heading` section of a Markdown changelog, without its heading. Matches "Unreleased" or a version (with or without a date). */
export function changelogSection(md: string, which: "unreleased" | string): { title: string; body: string } | null {
  const parts = md.split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    const hit =
      which === "unreleased" ? /^unreleased$/i.test(heading) : compareVersions(heading.split(/\s/)[0] ?? "", which) === 0 && /^v?\d/.test(heading);
    if (!hit) continue;
    const body = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    return { title: heading, body: body.length > MAX_CHANGELOG ? `${body.slice(0, MAX_CHANGELOG)}\n\n...` : body };
  }
  return null;
}

export function createAbout(opts: AboutOptions) {
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? Date.now;
  const build = opts.build ?? currentBuild();
  const base = `https://github.com/${opts.repo}`;
  let cache: { at: number; ttl: number; value: About["update"] & { changelog: About["changelog"] } } | null = null;

  async function get(url: string, kind: "json" | "text") {
    const res = await doFetch(url, {
      headers: { Accept: kind === "json" ? "application/vnd.github+json" : "text/plain", "User-Agent": "ultimyr-about" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw Object.assign(new Error(`http_${res.status}`), { status: res.status });
    return kind === "json" ? res.json() : res.text();
  }

  async function check(): Promise<NonNullable<typeof cache>["value"]> {
    const at = new Date(now()).toISOString();
    let latest: AboutLatest | null = null;
    let commitsBehind: number | null = null;
    let reached = false;
    try {
      const r = (await get(`https://api.github.com/repos/${opts.repo}/releases/latest`, "json")) as { tag_name?: string; html_url?: string; published_at?: string };
      reached = true;
      if (r.tag_name) latest = { version: r.tag_name.replace(/^v/i, ""), url: r.html_url ?? `${base}/releases/tag/${r.tag_name}`, publishedAt: r.published_at ?? null };
    } catch (e) {
      if ((e as { status?: number }).status === 404) reached = true; // reachable, no releases yet
    }
    if (build.commit) {
      try {
        const c = (await get(`https://api.github.com/repos/${opts.repo}/compare/${build.commit}...main`, "json")) as { ahead_by?: number };
        reached = true;
        if (typeof c.ahead_by === "number") commitsBehind = c.ahead_by;
      } catch (e) {
        if ((e as { status?: number }).status === 404) reached = true; // commit unknown to GitHub (local build)
      }
    }
    const newerRelease = latest !== null && build.version !== "dev" && compareVersions(latest.version, build.version) > 0;
    const behind = newerRelease || (commitsBehind ?? 0) > 0;

    let changelog: About["changelog"] = null;
    if (reached) {
      try {
        const md = (await get(`https://raw.githubusercontent.com/${opts.repo}/main/CHANGELOG.md`, "text")) as string;
        const wantRelease = latest !== null && (newerRelease || !behind);
        changelog = (wantRelease && latest ? changelogSection(md, latest.version) : null) ?? changelogSection(md, "unreleased") ?? (latest ? changelogSection(md, latest.version) : null);
      } catch {
        /* changelog is optional */
      }
    }
    return {
      status: !reached ? "unknown" : behind ? "behind" : "current",
      checkedAt: at,
      latest,
      newRelease: newerRelease,
      commitsBehind,
      reason: reached ? null : "Could not reach GitHub.",
      changelog,
    } satisfies NonNullable<typeof cache>["value"];
  }

  return async function about(refresh = false): Promise<About> {
    const links = {
      repo: base,
      docs: `${base}/blob/main/docs/README.md`,
      changelog: `${base}/blob/main/CHANGELOG.md`,
      issues: `${base}/issues/new/choose`,
      security: `${base}/security/advisories/new`,
      license: `${base}/blob/main/LICENSE`,
      releases: `${base}/releases`,
    };
    let update: About["update"] = { status: "disabled", checkedAt: null, latest: null, newRelease: false, commitsBehind: null, reason: "Update checks are switched off (ULTIMYR_UPDATE_CHECK=false)." };
    let changelog: About["changelog"] = null;
    if (opts.enabled) {
      const t = now();
      const usable = cache && t - cache.at < (refresh ? MIN_REFRESH_MS : cache.ttl);
      if (!usable) {
        const value = await check();
        cache = { at: t, ttl: value.status === "unknown" ? FAIL_TTL_MS : OK_TTL_MS, value };
      }
      const { changelog: c, ...u } = cache!.value;
      update = u;
      changelog = c;
    }
    return {
      name: "Ultimyr",
      repo: { name: opts.repo, url: base },
      build: { ...build, commitUrl: build.commit ? `${base}/commit/${build.commit}` : null },
      update,
      changelog,
      links,
      license: "MIT",
    };
  };
}
