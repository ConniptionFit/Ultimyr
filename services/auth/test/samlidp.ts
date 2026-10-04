import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";

export interface IdpKey {
  key: string;
  cert: string;
}

export function makeIdpKey(cn = "test-idp"): IdpKey {
  const dir = mkdtempSync(join(tmpdir(), "samlidp-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-subj", `/CN=${cn}`, "-days", "2"], { stdio: "ignore" });
  return { key: readFileSync(join(dir, "k.pem"), "utf8"), cert: readFileSync(join(dir, "c.pem"), "utf8") };
}

/** Pull the AuthnRequest ID and ACS URL out of the redirect the SP sent to the IdP. */
export function readAuthnRequest(location: string) {
  const u = new URL(location);
  const xml = inflateRawSync(Buffer.from(u.searchParams.get("SAMLRequest") ?? "", "base64")).toString();
  return {
    id: /ID="([^"]+)"/.exec(xml)?.[1] ?? "",
    acs: /AssertionConsumerServiceURL="([^"]+)"/.exec(xml)?.[1] ?? "",
    issuer: /<saml:Issuer[^>]*>([^<]+)</.exec(xml)?.[1] ?? "",
    relayState: u.searchParams.get("RelayState") ?? "",
  };
}

export interface ResponseOptions {
  idp: IdpKey;
  idpIssuer?: string;
  requestId: string;
  acs: string;
  audience: string;
  nameId: string;
  attributes?: Record<string, string | string[]>;
  notOnOrAfterMs?: number;
  /** Sign the assertion (default true). */
  sign?: boolean;
  /** Tamper with the XML after signing. */
  tamper?: (xml: string) => string;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function samlResponse(o: ResponseOptions): string {
  const now = Date.now();
  const issuer = o.idpIssuer ?? "https://idp.example/entity";
  const attrs = Object.entries(o.attributes ?? {})
    .map(([name, v]) => `<saml:Attribute Name="${name}">${(Array.isArray(v) ? v : [v]).map((x) => `<saml:AttributeValue>${x}</saml:AttributeValue>`).join("")}</saml:Attribute>`)
    .join("");
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a${now}${Math.floor(Math.random() * 1e6)}" Version="2.0" IssueInstant="${iso(now)}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${o.nameId}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(now + (o.notOnOrAfterMs ?? 300_000))}" Recipient="${o.acs}" InResponseTo="${o.requestId}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(now - 60_000)}" NotOnOrAfter="${iso(now + (o.notOnOrAfterMs ?? 300_000))}"><saml:AudienceRestriction><saml:Audience>${o.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attrs}</saml:AttributeStatement></saml:Assertion>`;

  let signedAssertion = assertion;
  if (o.sign !== false) {
    const sig = new SignedXml({
      privateKey: o.idp.key,
      publicCert: o.idp.cert,
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
    });
    sig.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    });
    sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: "after" } });
    signedAssertion = sig.getSignedXml();
  }
  let response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${now}" Version="2.0" IssueInstant="${iso(now)}" Destination="${o.acs}" InResponseTo="${o.requestId}"><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signedAssertion}</samlp:Response>`;
  if (o.tamper) response = o.tamper(response);
  return Buffer.from(response).toString("base64");
}
