import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { Encoder } from "cbor-x";

// Records off: WebAuthn needs plain CBOR maps.
const { encode } = new Encoder({ useRecords: false, variableMapSize: true });

/** A minimal software WebAuthn authenticator (ES256, "none" attestation) for tests. */
export class SoftKey {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  counter = 0;

  constructor(
    private readonly rpId = "localhost",
    private readonly origin = "http://localhost:3000",
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    this.publicJwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  }

  get id() {
    return this.credentialId.toString("base64url");
  }

  private rpIdHash(rpId = this.rpId) {
    return createHash("sha256").update(rpId).digest();
  }

  private clientData(type: string, challenge: string, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private counterBytes(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  }

  register(challenge: string, opts: { origin?: string; rpId?: string; flags?: number } = {}) {
    // COSE_Key (EC2, ES256, P-256) hand-encoded: cbor-x would wrap a Map in a tag WebAuthn rejects.
    const coseKey = Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
      Buffer.from(this.publicJwk.x, "base64url"),
      Buffer.from([0x22, 0x58, 0x20]),
      Buffer.from(this.publicJwk.y, "base64url"),
    ]);
    const credLen = Buffer.alloc(2);
    credLen.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      this.rpIdHash(opts.rpId),
      Buffer.from([opts.flags ?? 0x45]),
      this.counterBytes(this.counter),
      Buffer.alloc(16),
      credLen,
      this.credentialId,
      coseKey,
    ]);
    const attestationObject = encode({ fmt: "none", attStmt: {}, authData });
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: this.clientData("webauthn.create", challenge, opts.origin).toString("base64url"),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        transports: ["internal"],
      },
    };
  }

  authenticate(challenge: string, opts: { origin?: string; flags?: number; counter?: number } = {}) {
    this.counter = opts.counter ?? this.counter + 1;
    const authData = Buffer.concat([this.rpIdHash(), Buffer.from([opts.flags ?? 0x05]), this.counterBytes(this.counter)]);
    const clientDataJSON = this.clientData("webauthn.get", challenge, opts.origin);
    const signedData = Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]);
    const signature = createSign("SHA256").update(signedData).sign(this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  }
}
