/** Guided single sign-on setup content. Menu names were checked against each vendor's current docs (see docs/identity.md). */
import { cleanBase } from "./scim-providers";

export type Protocol = "oidc" | "saml";
export type SsoFill = "redirect" | "acs" | "entity" | "metadata" | "issuer";

export interface SsoUrls { redirect: string; acs: string; entity: string; metadata: string; start: Record<Protocol, string> }

const SLUG = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

/** Same rule the auth service applies to a provider short name. */
export const validSlug = (s: string) => SLUG.test(s);

/** Mirrors the addresses the auth service builds from its public URL and the provider short name. */
export function ssoUrls(origin: string, slug: string): SsoUrls {
  const entity = `${origin}/api/v1/auth/saml/${slug}/metadata`;
  return {
    redirect: `${origin}/api/v1/auth/sso/${slug}/callback`,
    acs: `${origin}/api/v1/auth/saml/${slug}/acs`,
    entity,
    metadata: entity,
    start: { oidc: `${origin}/api/v1/auth/sso/${slug}/start`, saml: `${origin}/api/v1/auth/saml/${slug}/start` },
  };
}

/** Okta serves the admin console from `-admin`, but tokens are issued by the plain org domain, so accept either and link to the console. */
export const oktaAdmin = (base: string | null) => (base ? base.replace(/^(https?:\/\/[^./]+?)(-admin)?\./i, "$1-admin.") : null);

/** Splits `https://kc.example.com/realms/acme` into the server origin and realm name. */
export function keycloakRealm(input: string): { origin: string; realm: string } | null {
  const origin = cleanBase(input);
  const m = /\/realms\/([^/?#]+)/i.exec(input.trim());
  return origin && m ? { origin, realm: decodeURIComponent(m[1]!) } : null;
}

export interface Derived { issuer: string | null; entryPoint: string | null }

const TENANT = /^(?:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|(?:[a-z0-9-]+\.)+[a-z]{2,})$/i;
const APP_SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/i;

/** Works out the OpenID Connect issuer and SAML sign-in URL from what the admin typed. Null where it cannot be known. */
export function deriveSso(providerId: string, f: { base?: string; app?: string }): Derived {
  const none: Derived = { issuer: null, entryPoint: null };
  const base = cleanBase(f.base ?? "");
  const app = (f.app ?? "").trim();
  switch (providerId) {
    case "authentik":
      return base && APP_SLUG.test(app)
        ? { issuer: `${base}/application/o/${app}/`, entryPoint: `${base}/application/saml/${app}/sso/binding/redirect/` }
        : none;
    case "okta": {
      const org = base && base.replace(/^(https?:\/\/[^./]+)-admin\./i, "$1.");
      return org ? { issuer: org, entryPoint: null } : none;
    }
    case "entra":
      return TENANT.test(app)
        ? { issuer: `https://login.microsoftonline.com/${app}/v2.0`, entryPoint: `https://login.microsoftonline.com/${app}/saml2` }
        : none;
    case "keycloak": {
      const k = keycloakRealm(f.base ?? "");
      if (!k) return none;
      const realm = `${k.origin}/realms/${encodeURIComponent(k.realm)}`;
      return { issuer: realm, entryPoint: `${realm}/protocol/saml` };
    }
    default: {
      const raw = (f.base ?? "").trim();
      if (!raw) return none;
      try {
        const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        return u.protocol === "https:" || u.protocol === "http:" ? { issuer: u.pathname === "/" ? u.origin : u.href, entryPoint: u.href } : none;
      } catch {
        return none;
      }
    }
  }
}

export interface SsoStep {
  title: string;
  body: string;
  menu?: string;
  copy?: SsoFill[];
  link?: { label: string; href: (providerBase: string | null) => string | null };
  /** Built in steps that act on the Ultimyr side. */
  action?: "prefill" | "test";
}

export interface SsoField { key: "base" | "app"; label: string; placeholder: string; hint?: string }

export interface SsoProvider {
  id: string;
  name: string;
  slug: string;
  intro: string;
  /** What the admin types so Ultimyr can work out the provider's addresses and links. */
  fields: SsoField[];
  warning?: Partial<Record<Protocol, string>>;
  steps: Record<Protocol, SsoStep[]>;
}

const at = (path: string) => (b: string | null) => (b ? `${b}${path}` : null);
const fixed = (url: string) => () => url;
const signed = "Ultimyr only accepts signed assertions, so keep assertion signing switched on.";
const emailNote = "Ultimyr identifies people by email, so make sure an email address is sent.";

const prefill: SsoStep = {
  title: "Add the provider in Ultimyr",
  body: "Use the button to open the Add a provider form. The issuer or sign-in URL is already filled in from what you typed, and an OpenID Connect issuer is checked live. Paste the remaining values you collected. Keep the short name the same, because the addresses you gave your provider contain it. For OpenID Connect, the secret is stored encrypted and never shown again.",
  action: "prefill",
};
const test: SsoStep = {
  title: "Test the sign-in",
  body: "Once the provider is saved and enabled, open the test link in a private window. You should land at your provider, sign in, and return to Ultimyr signed in. If you see an error on the sign-in page, recheck the addresses, the secret or certificate, and that your provider shows the user an email address.",
  action: "test",
};

export const SSO_PROVIDERS: SsoProvider[] = [
  {
    id: "authentik",
    name: "authentik",
    slug: "authentik",
    intro: "authentik acts as an application with either an OAuth2/OpenID or a SAML provider attached.",
    fields: [
      { key: "base", label: "Your authentik address", placeholder: "https://auth.example.com" },
      { key: "app", label: "Application slug", placeholder: "ultimyr", hint: "The slug you gave the application (shown as Slug on its details). It appears in the issuer address." },
    ],
    steps: {
      oidc: [
        {
          title: "Create the application and provider",
          body: "Click New Application and name it. Choose OAuth2/OIDC as the Provider Type. Set Client type to Confidential and paste the redirect address into Redirect URIs/Origins (strict match). Keep the default scopes (openid, email, profile), then Create Application.",
          menu: "Applications > Applications > New Application",
          copy: ["redirect"],
          link: { label: "Open authentik Applications", href: at("/if/admin/#/core/applications") },
        },
        {
          title: "Collect the client details",
          body: "Open the provider and copy the Client ID and Client Secret. Copy the OpenID Configuration Issuer too. It looks like https://auth.example.com/application/o/your-app/ and the trailing slash matters.",
          menu: "Applications > Providers > (your provider)",
          link: { label: "Open authentik Providers", href: at("/if/admin/#/core/providers") },
        },
        {
          title: "Decide who can sign in",
          body: "By default everyone who can reach the application may use it. To limit it, add policy, group or user bindings.",
          menu: "Applications > Applications > (your app) > Policy / Group / User Bindings",
          link: { label: "Open authentik Applications", href: at("/if/admin/#/core/applications") },
        },
        prefill,
        test,
      ],
      saml: [
        {
          title: "Create the application and provider",
          body: `Click New Application and name it. Choose SAML Provider as the Provider Type. Paste the ACS address into ACS URL and the entity ID into Audience. Choose a Signing Certificate and turn on signing of assertions, with POST as the binding. ${signed} Pick a NameID mapping that sends the email address, then Create Application.`,
          menu: "Applications > Applications > New Application",
          copy: ["acs", "entity"],
          link: { label: "Open authentik Applications", href: at("/if/admin/#/core/applications") },
        },
        {
          title: "Collect the provider details",
          body: "Open the provider's Metadata tab (or download the metadata). Copy the SSO URL for the Redirect binding and the signing certificate. The certificate can be pasted with or without the BEGIN and END lines.",
          menu: "Applications > Providers > (your provider) > Metadata",
          link: { label: "Open authentik Providers", href: at("/if/admin/#/core/providers") },
        },
        prefill,
        test,
      ],
    },
  },
  {
    id: "okta",
    name: "Okta",
    slug: "okta",
    intro: "Okta uses an app integration, either OIDC (Web Application) or SAML 2.0.",
    fields: [{ key: "base", label: "Your Okta address", placeholder: "https://example.okta.com" }],
    steps: {
      oidc: [
        {
          title: "Create an OIDC app integration",
          body: "Choose OIDC - OpenID Connect as the sign-in method and Web Application as the type. Paste the redirect address into Sign-in redirect URIs. Authorization Code is the grant type and cannot be changed. Pick who should have access, then Save.",
          menu: "Applications > Applications > Create App Integration",
          copy: ["redirect"],
          link: { label: "Open Okta Applications", href: (b) => (b ? `${oktaAdmin(b)}/admin/apps/active` : null) },
        },
        {
          title: "Collect the client details",
          body: "On the General tab copy the Client ID and Client secret. The issuer is your Okta domain without the -admin part (the org authorization server), for example https://example.okta.com.",
          menu: "(your app) > General > Client Credentials",
        },
        {
          title: "Assign people",
          body: "Only assigned people and groups can sign in through the app.",
          menu: "(your app) > Assignments",
        },
        prefill,
        test,
      ],
      saml: [
        {
          title: "Create a SAML 2.0 app integration",
          body: `Choose Classic experience, then SAML 2.0. Paste the ACS address into Single sign-on URL and the entity ID into Audience URI (SP Entity ID). Set Name ID format to EmailAddress and Application username to Email. ${signed}`,
          menu: "Applications > Applications > Create App Integration > Classic experience > SAML 2.0",
          copy: ["acs", "entity"],
          link: { label: "Open Okta Applications", href: (b) => (b ? `${oktaAdmin(b)}/admin/apps/active` : null) },
        },
        {
          title: "Collect the provider details",
          body: "Open the app's Sign On tab and choose View SAML setup instructions. Copy the Identity Provider Single Sign-On URL and the X.509 Certificate.",
          menu: "(your app) > Sign On > View SAML setup instructions",
        },
        {
          title: "Assign people",
          body: "Only assigned people and groups can sign in through the app.",
          menu: "(your app) > Assignments",
        },
        prefill,
        test,
      ],
    },
  },
  {
    id: "entra",
    name: "Microsoft Entra ID",
    slug: "entra",
    intro: "Entra uses an app registration for OpenID Connect, or an enterprise application for SAML.",
    fields: [{ key: "app", label: "Directory (tenant) ID", placeholder: "00000000-0000-0000-0000-000000000000", hint: "Shown on the Overview page of your Entra tenant or app registration. A domain such as contoso.onmicrosoft.com also works." }],
    steps: {
      oidc: [
        {
          title: "Register an application",
          body: "Choose New registration and name it. Under Redirect URI choose the Web platform and paste the redirect address.",
          menu: "Entra ID > App registrations > New registration",
          copy: ["redirect"],
          link: { label: "Open App registrations", href: fixed("https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade") },
        },
        {
          title: "Create a client secret",
          body: "Add a client secret and copy its Value straight away (not the Secret ID). It is shown only once.",
          menu: "(your app) > Certificates & secrets > Client secrets > New client secret",
        },
        {
          title: "Collect the client details",
          body: "On Overview, copy the Application (client) ID and the Directory (tenant) ID. The issuer is https://login.microsoftonline.com/<tenant ID>/v2.0 with your tenant ID filled in.",
          menu: "(your app) > Overview",
        },
        {
          title: "Send the email claim",
          body: `Entra does not always put the email in the ID token. Add it as an optional claim. ${emailNote}`,
          menu: "(your app) > Token configuration > Add optional claim > ID > email",
        },
        prefill,
        test,
      ],
      saml: [
        {
          title: "Create the enterprise application",
          body: "Create your own non-gallery application, then open Single sign-on and choose SAML.",
          menu: "Entra ID > Enterprise apps > New application > Create your own application",
          link: {
            label: "Open Enterprise apps",
            href: fixed("https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview"),
          },
        },
        {
          title: "Enter the Ultimyr addresses",
          body: "Edit Basic SAML Configuration. Paste the entity ID into Identifier (Entity ID) and the ACS address into Reply URL (Assertion Consumer Service URL), then Save.",
          menu: "(your app) > Single sign-on > Basic SAML Configuration",
          copy: ["entity", "acs"],
        },
        {
          title: "Check the email claim",
          body: `${emailNote} Under Attributes & Claims, set the Unique User Identifier (the name ID) to user.mail, or send an attribute named email. ${signed} Entra signs the assertion by default.`,
          menu: "(your app) > Single sign-on > Attributes & Claims",
        },
        {
          title: "Collect the provider details",
          body: "Under SAML Certificates download Certificate (Base64) and open it in a text editor to copy it. Under Set up (your app) copy the Login URL.",
          menu: "(your app) > Single sign-on > SAML Certificates",
        },
        {
          title: "Assign people",
          body: "Add the users and groups who may sign in.",
          menu: "(your app) > Users and groups",
        },
        prefill,
        test,
      ],
    },
  },
  {
    id: "keycloak",
    name: "Keycloak",
    slug: "keycloak",
    intro: "Keycloak uses a client in your realm, either OpenID Connect or SAML.",
    fields: [{ key: "base", label: "Your Keycloak realm address", placeholder: "https://kc.example.com/realms/main" }],
    steps: {
      oidc: [
        {
          title: "Create an OpenID Connect client",
          body: "Choose Create client, set Client type to OpenID Connect and give it a Client ID. Turn Client authentication on, and paste the redirect address into Valid redirect URIs.",
          menu: "Clients > Create client",
          copy: ["redirect"],
          link: {
            label: "Open Keycloak Clients",
            href: (b) => {
              const k = b ? keycloakRealm(b) : null;
              return k ? `${k.origin}/admin/master/console/#/${encodeURIComponent(k.realm)}/clients` : null;
            },
          },
        },
        {
          title: "Collect the client details",
          body: "Open the client's Credentials tab and copy the Client secret. The issuer is your realm address, for example https://kc.example.com/realms/main.",
          menu: "Clients > (your client) > Credentials",
        },
        prefill,
        test,
      ],
      saml: [
        {
          title: "Create a SAML client",
          body: "Choose Create client, set Client type to SAML and paste the entity ID into Client ID. Paste the ACS address into Valid redirect URIs and into Master SAML Processing URL.",
          menu: "Clients > Create client",
          copy: ["entity", "acs"],
          link: {
            label: "Open Keycloak Clients",
            href: (b) => {
              const k = b ? keycloakRealm(b) : null;
              return k ? `${k.origin}/admin/master/console/#/${encodeURIComponent(k.realm)}/clients` : null;
            },
          },
        },
        {
          title: "Match Ultimyr's expectations",
          body: `${signed} In the client's Settings turn Sign assertions on and set Name ID format to email. Ultimyr does not sign its requests, so on the Keys tab turn Client signature required off. ${emailNote}`,
          menu: "Clients > (your client) > Settings, then Keys",
        },
        {
          title: "Collect the provider details",
          body: "The sign-in URL is your realm address plus /protocol/saml. For the certificate, open the realm's Keys tab and use the Certificate button on the RS256 signing key.",
          menu: "Realm settings > Keys",
          link: {
            label: "Open Realm settings keys",
            href: (b) => {
              const k = b ? keycloakRealm(b) : null;
              return k ? `${k.origin}/admin/master/console/#/${encodeURIComponent(k.realm)}/realm-settings/keys` : null;
            },
          },
        },
        prefill,
        test,
      ],
    },
  },
  {
    id: "generic",
    name: "Other provider",
    slug: "sso",
    intro: "Any provider that supports OpenID Connect or SAML 2.0 can connect.",
    fields: [{ key: "base", label: "Issuer address (OpenID Connect) or sign-in URL (SAML)", placeholder: "https://login.example.com" }],
    steps: {
      oidc: [
        {
          title: "Register Ultimyr as a client",
          body: "Create a confidential web application that uses the authorization code flow. Use the redirect address below, and allow the scopes openid, email and profile. Ultimyr uses PKCE.",
          copy: ["redirect"],
        },
        {
          title: "Collect the client details",
          body: "Copy the Client ID, Client secret and the issuer address. The issuer must serve /.well-known/openid-configuration and be reachable over https.",
        },
        prefill,
        test,
      ],
      saml: [
        {
          title: "Register Ultimyr as a service provider",
          body: `Use the ACS address as the assertion consumer service URL with the POST binding, and the entity ID as the audience (SP entity ID). ${signed} ${emailNote} Send it as the name ID or as an attribute named email. Sign-in always starts from Ultimyr (SP-initiated), so provider-initiated login is not supported.`,
          copy: ["acs", "entity"],
        },
        {
          title: "Collect the provider details",
          body: "Copy the provider's single sign-on URL (HTTP-Redirect binding) and its signing certificate.",
        },
        prefill,
        test,
      ],
    },
  },
];
