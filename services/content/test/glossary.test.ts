import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("course glossary", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  const owner = uuid();
  const reader = uuid();
  const stranger = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown) => h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);
  let archive: string;

  beforeAll(async () => {
    archive = json(await call(owner, "POST", "/v1/archives", { title: "Security+" })).id;
    const g = await call(owner, "POST", `/v1/archives/${archive}/grants`, { subjectType: "user", subjectId: reader, relation: "viewer" });
    expect(g.statusCode).toBe(201);
  });

  it("adds and updates terms by name, ignoring case", async () => {
    const r = json(await call(owner, "PUT", `/v1/archives/${archive}/glossary`, { terms: [{ term: "AES", expansion: "Advanced Encryption Standard", definition: "A symmetric block cipher." }, { term: "aes", definition: "dup in one call" }, { term: "SYN", definition: "Starts a TCP handshake." }] }));
    expect(r).toEqual({ added: 2, updated: 0 });
    const again = json(await call(owner, "PUT", `/v1/archives/${archive}/glossary`, { terms: [{ term: "Aes", expansion: "Advanced Encryption Standard", definition: "A symmetric cipher, 128 bit blocks." }] }));
    expect(again).toEqual({ added: 0, updated: 1 });
    const list = json(await call(owner, "GET", `/v1/archives/${archive}/glossary`));
    expect(list.canEdit).toBe(true);
    expect(list.terms.map((t: any) => t.term)).toEqual(["Aes", "SYN"]);
    expect(list.terms[0].definition).toContain("128 bit");
  });

  it("searches terms, expansions and definitions", async () => {
    expect(json(await call(owner, "GET", `/v1/archives/${archive}/glossary?q=handshake`)).terms.map((t: any) => t.term)).toEqual(["SYN"]);
    expect(json(await call(owner, "GET", `/v1/archives/${archive}/glossary?q=%25`)).terms).toEqual([]);
  });

  it("keeps MCP and AI terms as drafts for editors until published", async () => {
    await call(owner, "PUT", `/v1/archives/${archive}/glossary`, { source: "mcp", terms: [{ term: "ACK", definition: "Acknowledges received data." }] });
    expect(json(await call(owner, "GET", `/v1/archives/${archive}/glossary`)).terms.map((t: any) => t.term)).toContain("ACK");
    const asReader = json(await call(reader, "GET", `/v1/archives/${archive}/glossary`));
    expect(asReader.canEdit).toBe(false);
    expect(asReader.terms.map((t: any) => t.term)).not.toContain("ACK");
    expect(json(await call(owner, "POST", `/v1/archives/${archive}/glossary/publish`))).toEqual({ published: 1 });
    expect(json(await call(reader, "GET", `/v1/archives/${archive}/glossary`)).terms.map((t: any) => t.term)).toContain("ACK");
  });

  it("only lets editors change it, and hides it from strangers", async () => {
    expect((await call(reader, "PUT", `/v1/archives/${archive}/glossary`, { terms: [{ term: "X", definition: "y" }] })).statusCode).toBe(403);
    expect((await call(stranger, "GET", `/v1/archives/${archive}/glossary`)).statusCode).toBe(404);
    const id = json(await call(owner, "GET", `/v1/archives/${archive}/glossary`)).terms[0].id;
    expect((await call(reader, "DELETE", `/v1/archives/${archive}/glossary/${id}`)).statusCode).toBe(403);
    expect((await call(owner, "DELETE", `/v1/archives/${archive}/glossary/${id}`)).statusCode).toBe(204);
    expect((await call(owner, "DELETE", `/v1/archives/${archive}/glossary/${id}`)).statusCode).toBe(404);
  });
});
