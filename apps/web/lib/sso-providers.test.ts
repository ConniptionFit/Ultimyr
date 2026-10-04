import { describe, expect, it } from "vitest";
import { keycloakRealm, oktaAdmin, SSO_PROVIDERS, ssoUrls, validSlug } from "./sso-providers";

describe("ssoUrls", () => {
  it("matches the addresses the auth service builds", () => {
    const u = ssoUrls("https://u.test", "acme");
    expect(u.redirect).toBe("https://u.test/api/v1/auth/sso/acme/callback");
    expect(u.acs).toBe("https://u.test/api/v1/auth/saml/acme/acs");
    expect(u.entity).toBe("https://u.test/api/v1/auth/saml/acme/metadata");
    expect(u.start.oidc).toBe("https://u.test/api/v1/auth/sso/acme/start");
    expect(u.start.saml).toBe("https://u.test/api/v1/auth/saml/acme/start");
  });
});

describe("validSlug", () => {
  it("follows the server rule", () => {
    for (const ok of ["ab", "authentik", "a-b-1"]) expect(validSlug(ok)).toBe(true);
    for (const bad of ["", "a", "-ab", "ab-", "Ab", "a_b", "a/b", "x".repeat(41)]) expect(validSlug(bad)).toBe(false);
  });
  it("gives every provider a valid default short name", () => {
    for (const p of SSO_PROVIDERS) expect(validSlug(p.slug)).toBe(true);
  });
});

describe("helpers", () => {
  it("builds the Okta admin address from either form", () => {
    expect(oktaAdmin("https://acme.okta.com")).toBe("https://acme-admin.okta.com");
    expect(oktaAdmin("https://acme-admin.okta.com")).toBe("https://acme-admin.okta.com");
    expect(oktaAdmin(null)).toBeNull();
  });
  it("splits a Keycloak realm address", () => {
    expect(keycloakRealm("https://kc.test/realms/main")).toEqual({ origin: "https://kc.test", realm: "main" });
    expect(keycloakRealm("https://kc.test")).toBeNull();
  });
});

describe("providers", () => {
  it("lists authentik first and covers both protocols everywhere", () => {
    expect(SSO_PROVIDERS[0]?.id).toBe("authentik");
    for (const p of SSO_PROVIDERS) for (const proto of ["oidc", "saml"] as const) {
      const steps = p.steps[proto];
      expect(steps.length).toBeGreaterThan(2);
      expect(steps.at(-2)?.action).toBe("prefill");
      expect(steps.at(-1)?.action).toBe("test");
    }
  });
  it("only copies addresses that belong to the protocol", () => {
    for (const p of SSO_PROVIDERS) {
      for (const s of p.steps.oidc) for (const c of s.copy ?? []) expect(c).toBe("redirect");
      for (const s of p.steps.saml) for (const c of s.copy ?? []) expect(["acs", "entity"]).toContain(c);
    }
  });
  it("builds deep links from the provider address, null without one, https only", () => {
    for (const p of SSO_PROVIDERS) for (const proto of ["oidc", "saml"] as const) for (const s of p.steps[proto]) {
      if (!s.link) continue;
      const base = p.id === "keycloak" ? "https://kc.test/realms/main" : "https://idp.test";
      expect(s.link.href(base)).toMatch(/^https:\/\//);
    }
    expect(SSO_PROVIDERS[0]!.steps.oidc[0]!.link!.href(null)).toBeNull();
  });
});
