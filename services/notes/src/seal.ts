import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Seals a person's sync token with the operator's master key (AES-256-GCM, bound to the person by AAD).
 * Layout: 1 (format) | key version (u32) | nonce (12) | ciphertext | tag (16).
 */
export class Sealer {
  private readonly keys = new Map<number, Buffer>();
  constructor(
    private readonly current: number,
    keys: Map<number, Buffer>,
  ) {
    for (const [v, k] of keys) {
      if (k.length !== 32) throw new Error(`Vault key version ${v} must be 32 bytes (base64 of 32 random bytes)`);
      this.keys.set(v, k);
    }
    if (!this.keys.has(current)) throw new Error("Current vault key is missing");
  }

  static fromConfig(current: string | undefined, version = 1, previous?: string): Sealer | null {
    if (!current) return null;
    const keys = new Map<number, Buffer>([[version, Buffer.from(current, "base64")]]);
    for (const part of (previous ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const [v, k] = part.split(":");
      if (!v || !k || !/^\d+$/.test(v)) throw new Error("ULTIMYR_VAULT_KEK_PREVIOUS must look like 1:base64key,2:base64key");
      keys.set(Number(v), Buffer.from(k, "base64"));
    }
    return new Sealer(version, keys);
  }

  seal(userId: string, plaintext: string): Buffer {
    const nonce = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.keys.get(this.current)!, nonce);
    c.setAAD(Buffer.from(`fns|${userId}`));
    const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    const head = Buffer.alloc(5);
    head[0] = 1;
    head.writeUInt32BE(this.current, 1);
    return Buffer.concat([head, nonce, ct, c.getAuthTag()]);
  }

  open(userId: string, blob: Buffer): string {
    if (blob.length < 34 || blob[0] !== 1) throw new Error("unrecognised ciphertext");
    const key = this.keys.get(blob.readUInt32BE(1));
    if (!key) throw new Error("Vault key version is not available");
    const d = createDecipheriv("aes-256-gcm", key, blob.subarray(5, 17));
    d.setAAD(Buffer.from(`fns|${userId}`));
    d.setAuthTag(blob.subarray(blob.length - 16));
    return Buffer.concat([d.update(blob.subarray(17, blob.length - 16)), d.final()]).toString("utf8");
  }
}
