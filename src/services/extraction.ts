import { extractionSchema, type SlipExtraction } from "../domain/slip.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

export interface SlipExtractor {
  extract(image: Buffer): Promise<unknown>;
}

export class DummyExtractor implements SlipExtractor {
  async extract(_image: Buffer): Promise<SlipExtraction> {
    return {
      type: "expense",
      amount: 250,
      payee_payer: "ร้านค้าตัวอย่าง",
      category: "อาหาร",
      transaction_datetime: "2026-09-05T10:30:00+07:00",
      bank: "Other Bank",
    };
  }
}

export class GeminiExtractor implements SlipExtractor {
  constructor(
    private readonly apiKey: string,
    private readonly model = DEFAULT_GEMINI_MODEL,
  ) {}

  async extract(image: Buffer): Promise<unknown> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: "อ่านภาพสลิปและคืน JSON เท่านั้น: type (income|expense), amount, payee_payer, category (อาหาร|เดินทาง|ที่พัก|ช้อปปิ้ง|บิล/สาธารณูปโภค|สุขภาพ|บันเทิง|อื่น ๆ), transaction_datetime เป็น ISO 8601 พร้อม offset, bank เป็นชื่อธนาคารถ้าอ่านได้ ถ้าไม่แน่ใจให้ใช้ อื่น ๆ" },
            { inline_data: { mime_type: "image/jpeg", data: image.toString("base64") } },
          ] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!response.ok) throw new Error("Gemini extraction failed");
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no extraction");
    return JSON.parse(text);
  }
}

export function createExtractor(env: NodeJS.ProcessEnv = process.env): SlipExtractor {
  return env.GEMINI_API_KEY && env.GEMINI_API_KEY !== "replace-me"
    ? new GeminiExtractor(
      env.GEMINI_API_KEY,
      env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    )
    : new DummyExtractor();
}

export async function extractSlip(extractor: SlipExtractor, image: Buffer) {
  try {
    const parsed = extractionSchema.safeParse(await extractor.extract(image));
    if (!parsed.success) {
      return { success: false as const, message: "ข้อมูลจาก AI ไม่ครบถ้วน กรุณาตรวจสอบและแก้ไข" };
    }
    return { success: true as const, data: parsed.data };
  } catch {
    return { success: false as const, message: "ไม่สามารถประมวลผลสลิปได้ กรุณาลองใหม่" };
  }
}
