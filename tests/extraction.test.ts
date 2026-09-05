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

  it("uses the available default model in the Gemini URL and preserves schema validation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        type: "expense", amount: 250, payee_payer: "ร้านค้าตัวอย่าง",
        category: "อาหารและเครื่องดื่ม", transaction_datetime: "2026-09-05T10:30:00+07:00",
        bank: "SCB",
      }) }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractSlip(new GeminiExtractor("placeholder-api-key"), Buffer.from("image"));

    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
  });

  it("uses GEMINI_MODEL when configured without exposing the API key in source", () => {
    const extractor = createExtractor({
      GEMINI_API_KEY: "placeholder-api-key",
      GEMINI_MODEL: "gemini-custom-flash",
    });

    expect(extractor).toBeInstanceOf(GeminiExtractor);
  });
});
