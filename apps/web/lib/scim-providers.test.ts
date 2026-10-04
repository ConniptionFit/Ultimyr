import { describe, expect, it } from "vitest";
import { cleanBase, curlCheck, SCIM_PROVIDERS } from "./scim-providers";

describe("cleanBase", () => {
  it("normalises to an origin", () => {
    expect(cleanBase("auth.example.com/")).toBe("https://auth.example.com");
    expect(cleanBase(" https://auth.example.com/if/admin/ ")).toBe("https://auth.example.com");
    expect(cleanBase("http://localhost:9000")).toBe("http://localhost:9000");
  });
  it("rejects empty and non web values", () => {
    expect(cleanBase("")).toBeNull();
    expect(cleanBase("javascript:alert(1)")).toBeNull();
    expect(cleanBase("not a url")).toBeNull();
  });
});

describe("providers", () => {
  it("lists authentik first as the default", () => {
    expect(SCIM_PROVIDERS[0]?.id).toBe("authentik");
  });
  it("builds deep links from the entered base and only https for fixed ones", () => {
    const authentik = SCIM_PROVIDERS[0]!;
    const hrefs = authentik.steps.flatMap((s) => (s.link ? [s.link.href("https://a.test")] : []));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).toMatch(/^https:\/\/a\.test\/if\/admin\/#\//);
    for (const p of SCIM_PROVIDERS) for (const s of p.steps) expect(s.link?.href(null) ?? "https://x").toMatch(/^(https:\/\/|$)/);
    expect(authentik.steps[1]!.link!.href(null)).toBeNull();
  });
  it("has unique ids and a token step everywhere", () => {
    expect(new Set(SCIM_PROVIDERS.map((p) => p.id)).size).toBe(SCIM_PROVIDERS.length);
    for (const p of SCIM_PROVIDERS) expect(p.steps[0]!.copy).toContain("token");
  });
  it("shows a curl check", () => expect(curlCheck("https://u.test/scim/v2")).toContain("/ServiceProviderConfig"));
});
