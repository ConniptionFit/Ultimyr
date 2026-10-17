import { describe, expect, it } from "vitest";
import { glossaryCards, parseGlossary } from "./glossary";

describe("parseGlossary", () => {
  it("reads colon, dash and tab forms, with optional acronym expansions", () => {
    const { terms, skipped } = parseGlossary("# Crypto\nAES (Advanced Encryption Standard): A symmetric block cipher\n- SYN - Starts a TCP handshake\nACK\tAcknowledges data\nlonely line");
    expect(terms).toEqual([
      { term: "AES", expansion: "Advanced Encryption Standard", definition: "A symmetric block cipher" },
      { term: "SYN", expansion: "", definition: "Starts a TCP handshake" },
      { term: "ACK", expansion: "", definition: "Acknowledges data" },
    ]);
    expect(skipped).toEqual(["lonely line"]);
  });
  it("keeps a colon inside the definition", () => {
    expect(parseGlossary("TLS: Transport Layer Security: encrypts traffic").terms[0]).toEqual({ term: "TLS", expansion: "", definition: "Transport Layer Security: encrypts traffic" });
  });
  it("builds flashcards", () => {
    expect(glossaryCards([{ term: "AES", expansion: "Advanced Encryption Standard", definition: "Cipher" }, { term: "SYN", expansion: "", definition: "Handshake" }])).toEqual([
      { front: "AES (Advanced Encryption Standard)", back: "Cipher" },
      { front: "SYN", back: "Handshake" },
    ]);
  });
});
