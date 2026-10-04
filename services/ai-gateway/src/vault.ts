import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError, type Pool } from "@ultimyr/service-kit";

/**
 * The secret vault: envelope encryption with AES-256-GCM.
 *
 *   KEK (master key, from a Docker secret, versioned)
 *    └─ wraps one random DEK per user   (AAD binds it to the user and KEK version)
 *        └─ encrypts each credential    (AAD binds it to user, credential id, provider, DEK version)
 *
 * Plaintext secrets exist only inside `open()` callers for the length of one provider call. There is no code path
 * that returns one over the API. If the KEK is absent the vault does not exist and nothing falls back to plaintext.
 */
export class KeyRing {
  private readonly keys = new Map<number, Buffer>();
  constructor(
    readonly currentVersion: number,
    keys: Map<number, Buffer>,
  ) {
    for (const [v, k] of keys) {
      if (k.length !== 32) throw new Error(`Vault key version ${v} must be 32 bytes (base64 of 32 random bytes)`);
      this.keys.set(v, k);
    }
    if (!this.keys.has(currentVersion)) throw new Error("Current vault key is missing");
  }
  get(version: number): Buffer {
    const k = this.keys.get(version);
    if (!k) throw new Error(`Vault key version ${version} is not available`);
    return k;
  }

  /** `current` is base64 of 32 bytes. `previous` is `version:base64,version:base64` for keys still needed to unwrap older DEKs. */
  static fromConfig(current: string | undefined, version = 1, previous?: string): KeyRing | null {
    if (!current) return null;
    const keys = new Map<number, Buffer>([[version, Buffer.from(current, "base64")]]);
    for (const part of (previous ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const [v, k] = part.split(":");
      if (!v || !k || !/^\d+$/.test(v)) throw new Error("ULTIMYR_VAULT_KEK_PREVIOUS must look like 1:base64key,2:base64key");
      keys.set(Number(v), Buffer.from(k, "base64"));
    }
    return new KeyRing(version, keys);
  }
}

function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, nonce);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, ct, c.getAuthTag()]); // version | nonce | ciphertext | tag
}

function unseal(key: Buffer, blob: Buffer, aad: string): Buffer {
  if (blob.length < 30 || blob[0] !== 1) throw new Error("unrecognised ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(1, 13));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([d.update(blob.subarray(13, blob.length - 16)), d.final()]);
}

const dekAad = (userId: string, kekVersion: number) => `dek|${userId}|${kekVersion}`;
const credAad = (userId: string, credentialId: string, provider: string, dekVersion: number) => `cred|${userId}|${credentialId}|${provider}|${dekVersion}`;

export class Vault {
  constructor(
    private readonly pool: Pool,
    private readonly ring: KeyRing,
  ) {}

  /** The user's data key, creating it on first use. */
  private async dek(userId: string, create: boolean): Promise<{ key: Buffer; version: number } | null> {
    const read = async () => {
      const { rows } = await this.pool.query("SELECT wrapped_dek, kek_version, dek_version FROM ai.user_deks WHERE user_id = $1", [userId]);
      return rows[0] as { wrapped_dek: Buffer; kek_version: number; dek_version: number } | undefined;
    };
    let row = await read();
    if (!row && create) {
      const fresh = randomBytes(32);
      await this.pool.query(
        "INSERT INTO ai.user_deks (user_id, wrapped_dek, kek_version) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING",
        [userId, seal(this.ring.get(this.ring.currentVersion), fresh, dekAad(userId, this.ring.currentVersion)), this.ring.currentVersion],
      );
      row = await read(); // if two requests raced, both end up using the one that won
    }
    if (!row) return null;
    return { key: unseal(this.ring.get(row.kek_version), row.wrapped_dek, dekAad(userId, row.kek_version)), version: row.dek_version };
  }

  async seal(userId: string, credentialId: string, provider: string, secret: string): Promise<{ ciphertext: Buffer; dekVersion: number }> {
    const dek = (await this.dek(userId, true))!;
    return { ciphertext: seal(dek.key, Buffer.from(secret, "utf8"), credAad(userId, credentialId, provider, dek.version)), dekVersion: dek.version };
  }

  /** Decrypt for immediate use. The caller must not log, store or return the result. */
  async open(userId: string, credentialId: string, provider: string, ciphertext: Buffer, dekVersion: number): Promise<string> {
    const dek = await this.dek(userId, false);
    if (!dek) throw new HttpError(409, "credential_unrecoverable");
    try {
      return unseal(dek.key, ciphertext, credAad(userId, credentialId, provider, dekVersion)).toString("utf8");
    } catch {
      throw new HttpError(409, "credential_unrecoverable");
    }
  }

  /** Crypto-shredding: with the data key gone, every ciphertext of this user is unrecoverable, backups included. */
  async destroy(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM ai.ai_credentials WHERE user_id = $1", [userId]);
    await this.pool.query("DELETE FROM ai.user_deks WHERE user_id = $1", [userId]);
  }

  /** After a KEK rotation: re-wrap every data key under the current KEK. Secrets themselves are untouched. */
  async rewrapAll(): Promise<number> {
    const { rows } = await this.pool.query("SELECT user_id, wrapped_dek, kek_version FROM ai.user_deks WHERE kek_version <> $1", [this.ring.currentVersion]);
    let n = 0;
    for (const r of rows) {
      const key = unseal(this.ring.get(r.kek_version), r.wrapped_dek, dekAad(r.user_id, r.kek_version));
      const wrapped = seal(this.ring.get(this.ring.currentVersion), key, dekAad(r.user_id, this.ring.currentVersion));
      const res = await this.pool.query(
        "UPDATE ai.user_deks SET wrapped_dek = $2, kek_version = $3, rotated_at = now() WHERE user_id = $1 AND kek_version = $4",
        [r.user_id, wrapped, this.ring.currentVersion, r.kek_version],
      );
      n += res.rowCount ?? 0;
    }
    return n;
  }
}
