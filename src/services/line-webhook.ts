import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { extractSlip, type SlipExtractor } from "./extraction.js";
import { validateImageUpload } from "./upload.js";
import type { PendingSlipStore, SlipStorage, WebhookEventStore } from "./persistence.js";

export interface LineContentClient {
  download(messageId: string): Promise<{ buffer: Buffer; mimeType: string }>;
}

export interface LineMessagingClient {
  reply(replyToken: string, message: Record<string, unknown>): Promise<void>;
}

export interface LineWebhookConfig {
  channelSecret: string;
  content: LineContentClient;
  messaging: LineMessagingClient;
  liffUrl?: string;
}

interface ImageEvent {
  type: "message";
  webhookEventId?: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; id?: string };
}

export function verifyLineSignature(body: Buffer, signature: string | undefined, channelSecret: string) {
  if (!signature || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret).update(body).digest();
  const actual = Buffer.from(signature, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class LineContentApiClient implements LineContentClient {
  constructor(private readonly accessToken: string) {}

  async download(messageId: string) {
    const response = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) throw new Error("LINE Content API request failed");
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    return { buffer, mimeType };
  }
}

export class LineMessagingApiClient implements LineMessagingClient {
  constructor(private readonly accessToken: string) {}

  async reply(replyToken: string, message: Record<string, unknown>) {
    const response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ replyToken, messages: [message] }),
    });
    if (!response.ok) throw new Error("LINE reply request failed");
  }
}

export function createLineWebhookProcessor(
  config: LineWebhookConfig,
  dependencies: { storage: SlipStorage; pendingSlips: PendingSlipStore; events: WebhookEventStore; extractor: SlipExtractor },
) {
  return async function process(body: { events?: unknown[] }) {
    let processed = 0;
    for (const candidate of body.events ?? []) {
      const event = candidate as ImageEvent;
      if (event.type !== "message" || event.message?.type !== "image" || !event.source?.userId || !event.message.id) continue;
      if (event.webhookEventId && !(await dependencies.events.claim(event.webhookEventId, event.source.userId, event.message.id))) continue;
      try {
        const downloaded = await config.content.download(event.message.id);
        const valid = validateImageUpload(downloaded.mimeType, downloaded.buffer.byteLength);
        if (!valid.valid) throw new Error("Unsupported LINE image");
        const extraction = await extractSlip(dependencies.extractor, downloaded.buffer, downloaded.mimeType);
        if (!extraction.success) throw new Error("Slip extraction failed");
        const storageRef = await dependencies.storage.put(event.source.userId, downloaded.buffer, downloaded.mimeType);
        const contentHash = createHash("sha256").update(downloaded.buffer).digest("hex");
        const uploadId = await dependencies.pendingSlips.createPending(event.source.userId, storageRef, contentHash, {
          eventId: event.webhookEventId,
          messageId: event.message.id,
          extraction: extraction.data,
        });
        if (event.replyToken) await config.messaging.reply(event.replyToken, createPendingReply(extraction.data, uploadId, config.liffUrl));
        processed += 1;
      } catch {
        // Webhook responses never expose provider errors or credentials.
      }
    }
    return { accepted: true, processed };
  };
}

function createPendingReply(data: Record<string, unknown>, uploadId: string, liffUrl = "") {
  const url = liffUrl ? `${liffUrl}${liffUrl.includes("?") ? "&" : "?"}upload_id=${encodeURIComponent(uploadId)}` : uploadId;
  return {
    type: "flex",
    altText: `อ่านสลิปได้ ${String(data.amount)} บาท กรุณาตรวจสอบก่อนบันทึก`,
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", contents: [
        { type: "text", text: "อ่านสลิปสำเร็จ", weight: "bold", size: "lg" },
        { type: "text", text: `${String(data.payee_payer)} · ${String(data.amount)} บาท`, wrap: true },
      ] },
      footer: { type: "box", layout: "vertical", contents: [{ type: "button", action: { type: "uri", label: "ตรวจสอบรายการ", uri: url } }] },
    },
  };
}
