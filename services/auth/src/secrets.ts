import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM box for secrets the auth service must read back later (TOTP seeds,
 * IdP client secrets). Layout: version(1) | nonce(12) | ciphertext | tag(16).
 * The caller supplies AAD so a ciphertext cannot be moved to another row.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Encryption key must be 32 bytes (base64 of 32 random bytes)");
  }

  encrypt(plaintext: string, aad: string): Buffer {
    const nonce = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, nonce);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, ct, c.getAuthTag()]);
  }

  decrypt(blob: Buffer, aad: string): string {
    if (blob.length < 30 || blob[0] !== 1) throw new Error("Unrecognised secret format");
    const nonce = blob.subarray(1, 13);
    const tag = blob.subarray(blob.length - 16);
    const ct = blob.subarray(13, blob.length - 16);
    const d = createDecipheriv("aes-256-gcm", this.key, nonce);
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  }
}

export interface Secrets {
  box: SecretBox;
  /** Keyed hash for high-entropy tokens (API keys, SCIM tokens, recovery codes). */
  hashToken(token: string): string;
}

export function createSecrets(encKeyB64: string, pepper: string): Secrets {
  return {
    box: new SecretBox(Buffer.from(encKeyB64, "base64")),
    hashToken: (token) => createHmac("sha256", pepper).update(token).digest("hex"),
  };
}

/** Deterministic, publicly known keys used ONLY outside production so dev restarts keep working. */
export const DEV_ENC_KEY_B64 = createHash("sha256").update("ultimyr-insecure-dev-enc-key").digest("base64");
export const DEV_PEPPER = "ultimyr-insecure-dev-pepper";

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
