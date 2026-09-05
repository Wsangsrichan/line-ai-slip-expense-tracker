import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtractor, DEFAULT_GEMINI_MODEL, DummyExtractor, extractSlip, GeminiExtractor } from "../src/services/extraction.js";

afterEach(() => vi.unstubAllGlobals());

describe("slip extraction", () => {
  it("normalizes a dummy AI response into the save schema", async () => {
    const result = await extractSlip(new DummyExtractor(), Buffer.from("image"));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(250);
      expect(result.data.type).toBe("expense");
    }
  });

  it("does not expose provider errors as secrets", async () => {
    const result = await extractSlip(
      { extract: async () => ({ type: "expense", amount: -1 }) },
      Buffer.from("image"),
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toContain("ตรวจสอบ");
  });

  it("classifies provider failures without returning provider details", async () => {
    const result = await extractSlip({ extract: async () => { throw new Error("provider detail with key=do-not-return"); } }, Buffer.from("image"));

    expect(result).toEqual({ success: false, message: "บริการ AI ไม่พร้อมใช้งาน กรุณาลองใหม่" });
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it("classifies malformed provider responses separately from schema errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractSlip(new GeminiExtractor("placeholder-api-key"), Buffer.from("image"));

    expect(result).toEqual({ success: false, message: "AI ส่งข้อมูลไม่ถูกต้อง กรุณาลองใหม่" });
  });

  it("uses the safe default model in the Gemini URL and preserves schema validation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        type: "expense", amount: 250, payee_payer: "ร้านค้าตัวอย่าง",
        category: "อาหารและเครื่องดื่ม", transaction_datetime: "2026-09-05T10:30:00+07:00",
        bank: "SCB",
      }) }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractSlip(
      createExtractor({ GEMINI_API_KEY: "placeholder-api-key" }),
      Buffer.from("image"),
    );

    expect(result.success).toBe(true);
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-2.5-flash");
    expect(fetchMock.mock.calls[0][0]).toContain("/models/gemini-2.5-flash:generateContent");
  });

  it("maps Gemini provider HTTP failures to a safe generic result", async () => {
    const providerSecret = "provider-response-secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(providerSecret, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractSlip(
      createExtractor({ GEMINI_API_KEY: "secret-api-key" }),
      Buffer.from("image"),
    );

    expect(result).toEqual({ success: false, message: "บริการ AI ไม่พร้อมใช้งาน กรุณาลองใหม่" });
    expect(JSON.stringify(result)).not.toContain(providerSecret);
    expect(JSON.stringify(result)).not.toContain("secret-api-key");
  });

  it("sends the uploaded image MIME type and finds text in any response part", async () => {
    const extracted = JSON.stringify({
      type: "expense", amount: 250, payee_payer: "ร้านค้าตัวอย่าง",
      category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ thought: true }, { text: extracted }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractSlip(new GeminiExtractor("placeholder-api-key"), Buffer.from("image"), "image/png");

    expect(result.success).toBe(true);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.contents[0].parts.find((part: { inline_data?: unknown }) => part.inline_data)?.inline_data.mime_type).toBe("image/png");
  });

  it("normalizes image MIME parameters and keeps the API key out of the URL", async () => {
    const extracted = JSON.stringify({
      type: "expense", amount: 250, payee_payer: "ร้านค้าตัวอย่าง",
      category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: extracted }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractSlip(
      new GeminiExtractor("secret-api-key"),
      Buffer.from("image"),
      "IMAGE/PNG; charset=binary",
    );

    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).not.toContain("secret-api-key");
    expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("secret-api-key");
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.contents[0].parts.find((part: { inline_data?: unknown }) => part.inline_data)?.inline_data.mime_type).toBe("image/png");
  });

  it("uses GEMINI_MODEL override in the Gemini URL", async () => {
    const extractor = createExtractor({
      GEMINI_API_KEY: "placeholder-api-key",
      GEMINI_MODEL: "gemini-custom-flash",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractor.extract(Buffer.from("image"))).rejects.toThrow("Gemini returned invalid extraction");

    expect(extractor).toBeInstanceOf(GeminiExtractor);
    expect(fetchMock.mock.calls[0][0]).toContain("/models/gemini-custom-flash:generateContent");
  });
});
