import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { resolve } from "node:path";
import { migrate } from "@ultimyr/db";
import { KeyRing, Vault } from "../src/vault.js";
import { newKek, testDbUrl, uuid } from "./helpers.js";

describe("key ring", () => {
  it("is absent without a key, parses previous keys, and rejects bad ones", () => {
    expect(KeyRing.fromConfig(undefined)).toBeNull();
    expect(KeyRing.fromConfig("")).toBeNull();
    const ring = KeyRing.fromConfig(newKek(), 2, `1:${newKek()}`)!;
    expect(ring.currentVersion).toBe(2);
    expect(ring.get(1)).toHaveLength(32);
    expect(() => ring.get(9)).toThrow(/not available/);
    expect(() => KeyRing.fromConfig(Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
    expect(() => KeyRing.fromConfig(newKek(), 1, "garbage")).toThrow(/ULTIMYR_VAULT_KEK_PREVIOUS/);
    expect(() => new KeyRing(3, new Map([[1, randomBytes(32)]]))).toThrow(/missing/);
  });
});

describe.skipIf(!testDbUrl)("vault", () => {
  let pool: pg.Pool;
  const kekA = newKek();
  let vault: Vault;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: testDbUrl });
    await pool.query("DROP SCHEMA IF EXISTS ai CASCADE");
    await pool.query("DELETE FROM public.ultimyr_migrations WHERE service = 'ai'").catch(() => {});
    await migrate(pool, { service: "ai", dir: resolve(import.meta.dirname, "../migrations") });
    vault = new Vault(pool, KeyRing.fromConfig(kekA)!);
  });
  afterAll(() => pool.end());

  const alice = uuid();
  const bob = uuid();
  const SECRET = "sk-test-0123456789abcdef";

  it("round trips a secret and never stores it in the clear", async () => {
    const cid = uuid();
    const { ciphertext, dekVersion } = await vault.seal(alice, cid, "openai", SECRET);
    expect(ciphertext.includes(Buffer.from(SECRET))).toBe(false);
    expect(await vault.open(alice, cid, "openai", ciphertext, dekVersion)).toBe(SECRET);
    const { rows } = await pool.query("SELECT wrapped_dek FROM ai.user_deks WHERE user_id = $1", [alice]);
    expect(rows[0].wrapped_dek).toHaveLength(1 + 12 + 32 + 16); // the data key is only ever stored wrapped
  });

  it("uses a fresh nonce for every write, even for the same secret", async () => {
    const nonces = new Set<string>();
    const cid = uuid();
    for (let i = 0; i < 300; i++) nonces.add((await vault.seal(alice, cid, "openai", SECRET)).ciphertext.subarray(1, 13).toString("hex"));
    expect(nonces.size).toBe(300);
  });

  it("refuses to decrypt for another user, provider, credential or key version (AAD binding)", async () => {
    const cid = uuid();
    const { ciphertext, dekVersion } = await vault.seal(alice, cid, "openai", SECRET);
    await vault.seal(bob, uuid(), "openai", "bobs-secret-value"); // bob has a data key too
    const fails = async (...args: [string, string, string, Buffer, number]) => {
      await expect(vault.open(...args)).rejects.toMatchObject({ code: "credential_unrecoverable" });
    };
    await fails(bob, cid, "openai", ciphertext, dekVersion); // moved to bob's row: wrong user and wrong DEK
    await fails(alice, cid, "anthropic", ciphertext, dekVersion);
    await fails(alice, uuid(), "openai", ciphertext, dekVersion);
    await fails(alice, cid, "openai", ciphertext, dekVersion + 1);
    await fails(uuid(), cid, "openai", ciphertext, dekVersion); // a user with no data key
  });

  it("detects tampering anywhere in the blob", async () => {
    const cid = uuid();
    const { ciphertext, dekVersion } = await vault.seal(alice, cid, "gemini", SECRET);
    for (const i of [0, 5, 14, ciphertext.length - 1]) {
      const bad = Buffer.from(ciphertext);
      bad[i] = bad[i]! ^ 1;
      await expect(vault.open(alice, cid, "gemini", bad, dekVersion)).rejects.toMatchObject({ code: "credential_unrecoverable" });
    }
    await expect(vault.open(alice, cid, "gemini", ciphertext.subarray(0, 20), dekVersion)).rejects.toMatchObject({ code: "credential_unrecoverable" });
  });

  it("cannot be opened with a different master key", async () => {
    const cid = uuid();
    const { ciphertext, dekVersion } = await vault.seal(alice, cid, "openai", SECRET);
    const other = new Vault(pool, KeyRing.fromConfig(newKek())!);
    await expect(other.open(alice, cid, "openai", ciphertext, dekVersion)).rejects.toThrow();
  });

  it("survives master key rotation: old key kept for unwrapping, rewrap moves data keys to the new one", async () => {
    const carol = uuid();
    const cid = uuid();
    const { ciphertext, dekVersion } = await vault.seal(carol, cid, "openai", SECRET);
    const kekB = newKek();
    const rotated = new Vault(pool, KeyRing.fromConfig(kekB, 2, `1:${kekA}`)!);
    expect(await rotated.open(carol, cid, "openai", ciphertext, dekVersion)).toBe(SECRET); // still readable via the previous key
    const only2 = new Vault(pool, KeyRing.fromConfig(kekB, 2)!);
    await expect(only2.open(carol, cid, "openai", ciphertext, dekVersion)).rejects.toThrow(); // old key dropped too early
    const n = await rotated.rewrapAll();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await only2.open(carol, cid, "openai", ciphertext, dekVersion)).toBe(SECRET); // now the old key is no longer needed
    expect(await rotated.rewrapAll()).toBe(0);
    const { rows } = await pool.query("SELECT kek_version, rotated_at FROM ai.user_deks WHERE user_id = $1", [carol]);
    expect(rows[0].kek_version).toBe(2);
    expect(rows[0].rotated_at).not.toBeNull();
  });

  it("shreds a person's secrets by destroying their data key", async () => {
    const dave = uuid();
    const cid = uuid();
    const { ciphertext, dekVersion } = await vault.seal(dave, cid, "openai", SECRET);
    await pool.query("INSERT INTO ai.ai_credentials (id, user_id, provider, label, ciphertext, dek_version, last4) VALUES ($1,$2,'openai','x',$3,$4,'cdef')", [cid, dave, ciphertext, dekVersion]);
    await vault.destroy(dave);
    expect((await pool.query("SELECT 1 FROM ai.user_deks WHERE user_id = $1", [dave])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM ai.ai_credentials WHERE user_id = $1", [dave])).rowCount).toBe(0);
    // even a restored backup of the credential row is useless: a new data key cannot open it
    await vault.seal(dave, uuid(), "openai", "later");
    await expect(vault.open(dave, cid, "openai", ciphertext, dekVersion)).rejects.toMatchObject({ code: "credential_unrecoverable" });
  });

  it("two requests creating the first key at once end up with one", async () => {
    const erin = uuid();
    const [a, b] = await Promise.all([vault.seal(erin, uuid(), "openai", "one-secret-aaaa"), vault.seal(erin, uuid(), "openai", "two-secret-bbbb")]);
    expect((await pool.query("SELECT 1 FROM ai.user_deks WHERE user_id = $1", [erin])).rowCount).toBe(1);
    expect(a.dekVersion).toBe(b.dekVersion);
  });
});
