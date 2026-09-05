import { extractionSchema, type SlipExtraction } from "../domain/slip.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type HttpStatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "unknown";
export type SlipExtractionFailureReason = "provider-error" | "response-error" | "schema-invalid" | "unknown";

export type SlipExtractionFailure = {
  success: false;
  message: string;
  reason: SlipExtractionFailureReason;
  httpStatusClass?: HttpStatusClass;
  httpStatusCode?: number;
};

export type SlipExtractionResult =
  | { success: true; data: SlipExtraction }
  | SlipExtractionFailure;

class GeminiProviderError extends Error {
  constructor(
    readonly httpStatusClass: HttpStatusClass = "unknown",
    readonly httpStatusCode?: number,
  ) {
    super("Gemini provider error");
  }
}
class GeminiResponseError extends Error {}

export interface SlipExtractor {
  extract(image: Buffer, mimeType?: string): Promise<unknown>;
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

  async extract(image: Buffer, mimeType = "image/jpeg"): Promise<unknown> {
    const normalizedMimeType = mimeType.split(";", 1)[0].trim().toLowerCase() || "image/jpeg";
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
      throw new GeminiProviderError();
    }
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: "อ่านภาพสลิปและคืน JSON เท่านั้น: type (income|expense), amount, payee_payer, category (อาหาร|เดินทาง|ที่พัก|ช้อปปิ้ง|บิล/สาธารณูปโภค|สุขภาพ|บันเทิง|อื่น ๆ), transaction_datetime เป็น ISO 8601 พร้อม offset, bank เป็นชื่อธนาคารถ้าอ่านได้ ถ้าไม่แน่ใจให้ใช้ อื่น ๆ" },
            { inline_data: { mime_type: normalizedMimeType, data: image.toString("base64") } },
          ] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!response.ok) {
      throw new GeminiProviderError(toHttpStatusClass(response.status), toHttpStatusCode(response.status));
    }
    let payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    } catch {
      throw new GeminiResponseError("Gemini returned invalid response");
    }
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text)
      .find((partText): partText is string => Boolean(partText?.trim()));
    if (!text) throw new GeminiResponseError("Gemini returned no extraction");
    try {
      return JSON.parse(text);
    } catch {
      throw new GeminiResponseError("Gemini returned invalid extraction");
    }
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

export async function extractSlip(extractor: SlipExtractor, image: Buffer, mimeType?: string): Promise<SlipExtractionResult> {
  try {
    const parsed = extractionSchema.safeParse(await extractor.extract(image, mimeType));
    if (!parsed.success) {
      return { success: false, message: "ข้อมูลจาก AI ไม่ครบถ้วน กรุณาตรวจสอบและแก้ไข", reason: "schema-invalid" };
    }
    return { success: true as const, data: parsed.data };
  } catch (error) {
    if (error instanceof GeminiResponseError) {
      return { success: false, message: "AI ส่งข้อมูลไม่ถูกต้อง กรุณาลองใหม่", reason: "response-error" };
    }
    if (error instanceof GeminiProviderError) {
      return {
        success: false,
        message: "บริการ AI ไม่พร้อมใช้งาน กรุณาลองใหม่",
        reason: "provider-error",
        httpStatusClass: error.httpStatusClass,
        ...(error.httpStatusCode === undefined ? {} : { httpStatusCode: error.httpStatusCode }),
      };
    }
    return { success: false, message: "บริการ AI ไม่พร้อมใช้งาน กรุณาลองใหม่", reason: "unknown" };
  }
}

function toHttpStatusClass(status: number): HttpStatusClass {
  return status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` as HttpStatusClass : "unknown";
}

function toHttpStatusCode(status: number): number | undefined {
  return Number.isInteger(status) && status >= 100 && status < 600 ? status : undefined;
}
