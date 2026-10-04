/** Guided SCIM setup content. Menu names were checked against each vendor's current docs (see docs/identity.md). */

export type Fill = "url" | "token";

export interface GuideStep {
  title: string;
  body: string;
  /** Menu location in the provider, shown as plain text next to the link. */
  menu?: string;
  /** Values the admin has to paste into this step. */
  copy?: Fill[];
  link?: { label: string; href: (providerBase: string | null) => string | null };
}

export interface ScimProvider {
  id: string;
  name: string;
  intro: string;
  /** What the admin types so deep links can point at their own tenant. Absent when the console address is fixed. */
  base?: { label: string; placeholder: string };
  steps: GuideStep[];
  warning?: string;
}

/** Accepts only http(s) and returns the origin without a trailing slash, so a typed value can never become a script link. */
export function cleanBase(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

const at = (path: string) => (b: string | null) => (b ? `${b}${path}` : null);
const fixed = (url: string) => () => url;

const createToken: GuideStep = {
  title: "Create a token in Ultimyr",
  body: "The provider proves who it is with a bearer token. Create one here, then keep this page open. It is shown once.",
  copy: ["token"],
};

const reachable =
  "The provider calls Ultimyr from its own servers, so the address must be reachable from the internet (or from wherever the provider runs). Local addresses will not work for cloud providers.";

export const SCIM_PROVIDERS: ScimProvider[] = [
  {
    id: "authentik",
    name: "authentik",
    intro: "authentik pushes users and groups through a SCIM provider that sits beside your sign-in provider as a backchannel provider.",
    base: { label: "Your authentik address", placeholder: "https://auth.example.com" },
    steps: [
      createToken,
      {
        title: "Create the application and SCIM provider",
        body: `Click New Application and name it (or edit your existing Ultimyr application and skip to the next step). Choose SCIM as the Provider Type. Paste the Ultimyr address into URL and the token into Token. Leave Compatibility Mode on Default, then click through to Create. ${reachable}`,
        menu: "Applications > Applications > New Application",
        copy: ["url", "token"],
        link: { label: "Open authentik Applications", href: at("/if/admin/#/core/applications") },
      },
      {
        title: "Check the user mapping",
        body: "Ultimyr needs an email address in the SCIM userName field. authentik's default mapping sends the username, so if usernames are not email addresses, edit the SCIM provider's User Property Mapping to send the email instead.",
        menu: "Customization > Property Mappings",
        link: { label: "Open Property Mappings", href: at("/if/admin/#/core/property-mappings") },
      },
      {
        title: "Attach it as a backchannel provider",
        body: "Edit the application, click the plus icon next to Backchannel Providers, pick the SCIM provider, Confirm, then Save changes. Users and groups bound to the application will sync.",
        menu: "Applications > Applications > (your app) > Edit",
        link: { label: "Open authentik Applications", href: at("/if/admin/#/core/applications") },
      },
      {
        title: "Run a sync and confirm",
        body: "Open the SCIM provider and start a sync. Then check Ultimyr: accounts appear in Users flagged as SCIM managed, and the token below shows a last used time.",
        menu: "Applications > Providers > (your SCIM provider)",
        link: { label: "Open authentik Providers", href: at("/if/admin/#/core/providers") },
      },
    ],
  },
  {
    id: "okta",
    name: "Okta",
    intro: "Okta provisions to apps that have SCIM turned on. The catalog's SCIM 2.0 template is the quickest route.",
    base: { label: "Your Okta admin address", placeholder: "https://example-admin.okta.com" },
    steps: [
      createToken,
      {
        title: "Add a SCIM app",
        body: "Browse the app catalog for \"SCIM 2.0 Test App (Header Auth)\" and add it. If you already have a SAML app for Ultimyr and it offers SCIM on its General tab, you can enable it there instead.",
        menu: "Applications > Applications > Browse App Catalog",
        link: { label: "Open Okta Applications", href: at("/admin/apps/active") },
      },
      {
        title: "Enter the connection details",
        body: `Open the Provisioning tab, choose Configure API Integration and tick Enable API Integration. Paste the address into SCIM connector base URL, set the unique identifier field to userName, and choose HTTP Header authentication. Okta sends what you enter as the Authorization header, so type "Bearer " before the token. Click Test API Credentials, then Save. ${reachable}`,
        menu: "(your app) > Provisioning > Integration",
        copy: ["url", "token"],
      },
      {
        title: "Turn on provisioning actions",
        body: "Under Settings, open To App and click Edit. Enable Create Users, Update User Attributes and Deactivate Users, then Save.",
        menu: "(your app) > Provisioning > To App",
      },
      {
        title: "Assign people and groups",
        body: "Only assigned users are sent to Ultimyr. To sync groups, add them under Push Groups.",
        menu: "(your app) > Assignments, then Push Groups",
      },
    ],
  },
  {
    id: "entra",
    name: "Microsoft Entra ID",
    intro: "Entra provisions to a custom (non-gallery) enterprise application using its automatic provisioning service.",
    steps: [
      createToken,
      {
        title: "Create a non-gallery application",
        body: "Create your own application (or open the existing Ultimyr one) under Enterprise apps. You need at least the Application Administrator role.",
        menu: "Entra ID > Enterprise apps > New application",
        link: {
          label: "Open Enterprise apps",
          href: fixed("https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview"),
        },
      },
      {
        title: "Enter the connection details",
        body: `Open Provisioning, select New configuration, and paste the address into Tenant URL and the token into Secret Token. Select Test Connection, then Create. ${reachable}`,
        menu: "(your app) > Provisioning > New configuration",
        copy: ["url", "token"],
      },
      {
        title: "Assign people and check the mapping",
        body: "Add users or groups on the Users and groups tab. Under Attribute mapping, make sure userName comes from an attribute that holds an email address. userPrincipalName works only when it is a real email, otherwise map the mail attribute.",
        menu: "(your app) > Users and groups, then Attribute mapping",
      },
      {
        title: "Start provisioning",
        body: "On Overview select Start provisioning. The first cycle can take around 40 minutes, and the Provisioning logs page shows each step.",
        menu: "(your app) > Overview > Start provisioning",
      },
    ],
  },
  {
    id: "keycloak",
    name: "Keycloak",
    intro: "Keycloak cannot push users out over SCIM on its own.",
    warning:
      "Keycloak's built in SCIM support is an inbound API (other tools provision into Keycloak). To push users to Ultimyr you need a community SCIM client extension for Keycloak, or place authentik or another provider in front. If you add an extension, use the values below.",
    steps: [
      createToken,
      {
        title: "Read how Keycloak's SCIM works",
        body: "Keycloak's own SCIM feature is experimental and inbound only. Read the announcement before choosing an extension.",
        link: { label: "Open the Keycloak announcement", href: fixed("https://www.keycloak.org/2026/04/scim-as-experimental-feature") },
      },
      {
        title: "Configure your SCIM client extension",
        body: "Give the extension the Ultimyr address as the SCIM endpoint and the token as a bearer token. Send userName as the email address. Menu names depend on the extension you install.",
        copy: ["url", "token"],
      },
    ],
  },
  {
    id: "generic",
    name: "Other provider",
    intro: "Any provider that speaks SCIM 2.0 can connect with the same three values.",
    steps: [
      createToken,
      {
        title: "Enter the connection details",
        body: `Look for SCIM or provisioning settings. Use the address as the base URL (also called tenant URL or connector URL) and the token as a bearer token (the Authorization header value is "Bearer " plus the token). ${reachable}`,
        copy: ["url", "token"],
      },
      {
        title: "Match the attributes",
        body: "Send userName as an email address, since Ultimyr signs people in by email. Optional: displayName, name.givenName, name.familyName, externalId and active. Enable both Users and Groups. Both PUT and PATCH updates work.",
      },
      {
        title: "Test and assign",
        body: "Use the provider's test button, or the terminal check below, then assign users or groups to start syncing.",
      },
    ],
  },
];

export const curlCheck = (url: string) => `curl -H "Authorization: Bearer <your token>" ${url}/ServiceProviderConfig`;
