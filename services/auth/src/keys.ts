import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { calculateJwkThumbprint, exportJWK, type JWK } from "jose";

export interface SigningKeys {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicJwk: JWK;
}

/** Load an Ed25519 PEM key, or generate an ephemeral one (development and tests only). */
export async function loadSigningKeys(pem?: string): Promise<SigningKeys> {
  let privateKey: KeyObject;
  if (pem) {
    privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("JWT signing key must be Ed25519");
  } else {
    privateKey = generateKeyPairSync("ed25519").privateKey;
  }
  const publicKey = createPublicKey(privateKey);
  const jwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(jwk);
  return { kid, privateKey, publicKey, publicJwk: { ...jwk, kid, alg: "EdDSA", use: "sig" } };
}
