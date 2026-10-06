import { describe, expect, it } from "vitest";
import { deriveSso, keycloakRealm, oktaAdmin, SSO_PROVIDERS, ssoUrls, validSlug } from "./sso-providers";

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

describe("deriveSso", () => {
  const none = { issuer: null, entryPoint: null };
  it("builds authentik addresses from the base address and application slug", () => {
    expect(deriveSso("authentik", { base: "auth.example.com/", app: "ultimyr" })).toEqual({
      issuer: "https://auth.example.com/application/o/ultimyr/",
      entryPoint: "https://auth.example.com/application/saml/ultimyr/sso/binding/redirect/",
    });
    expect(deriveSso("authentik", { base: "https://auth.example.com" })).toEqual(none);
    expect(deriveSso("authentik", { base: "https://auth.example.com", app: "a/b" })).toEqual(none);
  });
  it("uses the org address for Okta and no SAML sign-in URL", () => {
    expect(deriveSso("okta", { base: "https://acme-admin.okta.com" })).toEqual({ issuer: "https://acme.okta.com", entryPoint: null });
    expect(deriveSso("okta", { base: "" })).toEqual(none);
  });
  it("builds Entra addresses from a tenant ID or domain only", () => {
    const t = "11111111-2222-3333-4444-555555555555";
    expect(deriveSso("entra", { app: t })).toEqual({ issuer: `https://login.microsoftonline.com/${t}/v2.0`, entryPoint: `https://login.microsoftonline.com/${t}/saml2` });
    expect(deriveSso("entra", { app: "contoso.onmicrosoft.com" }).issuer).toContain("contoso.onmicrosoft.com");
    expect(deriveSso("entra", { app: "../evil" })).toEqual(none);
  });
  it("builds Keycloak addresses from the realm address", () => {
    expect(deriveSso("keycloak", { base: "https://kc.test/realms/main/" })).toEqual({ issuer: "https://kc.test/realms/main", entryPoint: "https://kc.test/realms/main/protocol/saml" });
    expect(deriveSso("keycloak", { base: "https://kc.test" })).toEqual(none);
  });
  it("takes a generic address as typed and refuses non web values", () => {
    expect(deriveSso("generic", { base: "https://login.example.com" }).issuer).toBe("https://login.example.com");
    expect(deriveSso("generic", { base: "https://login.example.com/oauth2/default" }).issuer).toBe("https://login.example.com/oauth2/default");
    expect(deriveSso("generic", { base: "javascript:alert(1)" })).toEqual(none);
    expect(deriveSso("generic", {})).toEqual(none);
  });
});
