import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAiConfig } from "../src/config.js";
import { ADAPTERS, DEFAULT_BASE_URLS, MODEL_NAME, ProviderError, complete, sseEvents, type Provider } from "../src/providers.js";
import { startStub, type Stub } from "./helpers.js";

const stream = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
      c.close();
    },
  });
const collect = async (it: AsyncGenerator<any>) => {
  const out = [];
  for await (const x of it) out.push(x);
  return out;
};

describe("server-sent events parser", () => {
  it("handles split chunks, CRLF, multi-line data, comments and events", async () => {
    const evs = await collect(sseEvents(stream(["event: a\r\ndata: one\r\n\r\nda", "ta: two\ndata: three\n\n: comment\n\nevent: b\ndata:x\n\n"])));
    expect(evs).toEqual([{ event: "a", data: "one" }, { event: undefined, data: "two\nthree" }, { event: "b", data: "x" }]);
  });
});

describe("adapters against a fake provider", () => {
  let stub: Stub;
  beforeAll(async () => {
    stub = await startStub();
  });
  afterAll(() => stub.close());
  const urls = () => ({ gemini: stub.url, openai: stub.url, anthropic: stub.url });
  const req = { apiKey: "key-1234567890", model: "m-1", system: "be brief", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 50 };

  for (const p of ["openai", "anthropic", "gemini"] as Provider[]) {
    it(`${p}: streams text, reports usage, and puts the key in a header, never the URL`, async () => {
      stub.requests.length = 0;
      stub.reply = "Hello there, this is a fairly long reply that spans more than one chunk.";
      stub.fail = null;
      const out = await complete(p, req, urls());
      expect(out).toEqual({ text: stub.reply, tokensIn: 11, tokensOut: 7 });
      const seen = stub.requests[0]!;
      expect(seen.path).not.toContain(req.apiKey);
      expect(JSON.stringify(seen.body)).not.toContain(req.apiKey);
      expect(JSON.stringify(seen.headers)).toContain(req.apiKey);
      expect(JSON.stringify(seen.body)).toContain("be brief");
    });

    it(`${p}: maps failures to safe codes without echoing the response`, async () => {
      for (const [status, code] of [[429, "rate_limited"], [500, "provider_unavailable"], [400, "provider_error"]] as const) {
        stub.fail = status;
        await expect(complete(p, req, urls())).rejects.toMatchObject({ code, status });
      }
      stub.fail = null;
      const err = await complete(p, { ...req, apiKey: "bad-key-123456" }, urls()).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.code).toBe("credential_rejected");
      expect(JSON.stringify(err)).not.toContain("bad-key"); // the stub's error body echoes the key; we must not
      expect(String(err.message)).not.toContain("bad-key");
    });

    it(`${p}: a dead endpoint is reported as unavailable`, async () => {
      await expect(complete(p, req, { ...urls(), [p]: "http://127.0.0.1:1" })).rejects.toMatchObject({ code: "provider_unavailable" });
    });
  }

  it("asks for JSON where the provider supports it", async () => {
    stub.requests.length = 0;
    stub.reply = "{}";
    await complete("openai", { ...req, json: true }, urls());
    await complete("gemini", { ...req, json: true }, urls());
    expect(stub.requests[0]!.body.response_format).toEqual({ type: "json_object" });
    expect(stub.requests[1]!.body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("gemini refuses model names that could alter the URL", async () => {
    expect(MODEL_NAME.test("gemini-2.5-flash")).toBe(true);
    for (const bad of ["../x", "a/b", "a?b=c", "", "-x", "a b"]) expect(MODEL_NAME.test(bad)).toBe(false);
    await expect(complete("gemini", { ...req, model: "x/../../admin" }, urls())).rejects.toMatchObject({ code: "provider_error" });
  });

  it("rejects malformed provider events", async () => {
    const fetchBad = (async () => new Response(stream(["data: {not json\n\n"]), { status: 200 })) as typeof fetch;
    await expect(collect(ADAPTERS.openai.stream(req, "http://x", fetchBad))).rejects.toMatchObject({ code: "bad_response" });
    const fetchErr = (async () => new Response(stream([`data: ${JSON.stringify({ type: "error", error: { message: "secret detail" } })}\n\n`]), { status: 200 })) as typeof fetch;
    const e = await collect(ADAPTERS.anthropic.stream(req, "http://x", fetchErr)).catch((x) => x);
    expect(e.code).toBe("provider_error");
    expect(String(e.message)).not.toContain("secret detail");
  });
});

describe("configuration", () => {
  it("defaults to the real provider endpoints and requires https for overrides", () => {
    const cfg = loadAiConfig({ NODE_ENV: "test" });
    expect(cfg.baseUrls).toEqual(DEFAULT_BASE_URLS);
    expect(cfg.vaultKek).toBeUndefined();
    expect(() => loadAiConfig({ NODE_ENV: "test", AI_BASE_URL_OPENAI: "http://evil.example" })).toThrow(/https/);
    expect(loadAiConfig({ NODE_ENV: "test", AI_BASE_URL_OPENAI: "https://proxy.example/" }).baseUrls.openai).toBe("https://proxy.example");
    expect(loadAiConfig({ NODE_ENV: "test", AI_BASE_URL_OPENAI: "http://127.0.0.1:9", AI_ALLOW_INSECURE_PROVIDER: "true" }).baseUrls.openai).toBe("http://127.0.0.1:9");
  });
});
