import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { LineContentApiClient, LineMessagingApiClient, verifyLineSignature } from "../src/services/line-webhook.js";

const imageEvent = {
  type: "message",
  webhookEventId: "evt-1",
  replyToken: "reply-1",
  source: { type: "user", userId: "line-user-1" },
  message: { id: "message-1", type: "image" },
};

describe("LINE webhook", () => {
  it("returns 503 in production when durable storage is unavailable", async () => {
    const previousEnv = {
      NODE_ENV: process.env.NODE_ENV,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.NODE_ENV = "production";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const content = { download: vi.fn() };

    try {
      const response = await request(createApp({
        line: { channelSecret: "channel-secret", content, messaging: { reply: vi.fn() } },
      })).post("/api/line/webhook")
        .set("x-line-signature", signatureFor({ events: [imageEvent] }))
        .send({ events: [imageEvent] });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: "ระบบยังไม่ได้ตั้งค่า durable upload storage" });
      expect(content.download).not.toHaveBeenCalled();
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("downloads LINE content with the server-side access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bytes", {
      status: 200, headers: { "content-type": "image/png" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new LineContentApiClient("access-token").download("message/1")).resolves.toEqual({
      buffer: Buffer.from("bytes"), mimeType: "image/png",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api-data.line.me/v2/bot/message/message%2F1/content", {
      headers: { authorization: "Bearer access-token" },
    });
  });

  it("replies through LINE Messaging API without returning provider details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const message = { type: "text", text: "ok" };

    await new LineMessagingApiClient("access-token").reply("reply-token", message);

    expect(fetchMock).toHaveBeenCalledWith("https://api.line.me/v2/bot/message/reply", expect.objectContaining({
      headers: { authorization: "Bearer access-token", "content-type": "application/json" },
      body: JSON.stringify({ replyToken: "reply-token", messages: [message] }),
    }));
  });

  it("verifies the raw request body with the channel secret", () => {
    const body = Buffer.from(JSON.stringify({ destination: "bot", events: [] }));
    const signature = createHmac("sha256", "channel-secret").update(body).digest("base64");

    expect(verifyLineSignature(body, signature, "channel-secret")).toBe(true);
    expect(verifyLineSignature(body, `${signature.slice(0, -1)}x`, "channel-secret")).toBe(false);
  });

  it("rejects an invalid signature without processing events", async () => {
    const content = { download: vi.fn() };
    const response = await request(createApp({
      line: { channelSecret: "channel-secret", content, messaging: { reply: vi.fn() } },
    })).post("/api/line/webhook")
      .set("x-line-signature", "invalid")
      .send({ events: [imageEvent] });

    expect(response.status).toBe(401);
    expect(content.download).not.toHaveBeenCalled();
  });

  it("ignores non-image events while acknowledging the webhook", async () => {
    const content = { download: vi.fn() };
    const response = await request(createApp({
      line: { channelSecret: "channel-secret", content, messaging: { reply: vi.fn() } },
    })).post("/api/line/webhook")
      .set("x-line-signature", signatureFor({ events: [{ ...imageEvent, type: "follow" }] }))
      .send({ events: [{ ...imageEvent, type: "follow" }] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: true, processed: 0 });
    expect(content.download).not.toHaveBeenCalled();
  });

  it("downloads, stores, extracts, creates a pending slip, and replies for an image", async () => {
    const storage = { put: vi.fn().mockResolvedValue("line-user-1/slip-1") };
    const pendingSlips = { createPending: vi.fn().mockResolvedValue("pending-1"), getPending: vi.fn(), consume: vi.fn() };
    const content = { download: vi.fn().mockResolvedValue({ buffer: Buffer.from("image-bytes"), mimeType: "image/jpeg" }) };
    const messaging = { reply: vi.fn().mockResolvedValue(undefined) };
    const extractor = { extract: vi.fn().mockResolvedValue({
      type: "expense", amount: 125, payee_payer: "ร้านค้า", category: "อาหาร",
      transaction_datetime: "2026-09-05T10:30:00+07:00", bank: "Other Bank",
    }) };
    const response = await request(createApp({
      storage, pendingSlips, extractor,
      line: { channelSecret: "channel-secret", content, messaging },
    })).post("/api/line/webhook")
      .set("x-line-signature", signatureFor({ events: [imageEvent] }))
      .send({ events: [imageEvent] });

    expect(response.status).toBe(200);
    expect(content.download).toHaveBeenCalledWith("message-1");
    expect(storage.put).toHaveBeenCalledWith("line-user-1", Buffer.from("image-bytes"), "image/jpeg");
    expect(pendingSlips.createPending).toHaveBeenCalledWith(
      "line-user-1", "line-user-1/slip-1", expect.any(String),
      expect.objectContaining({
        eventId: "evt-1", messageId: "message-1",
        extraction: expect.objectContaining({ amount: 125, payee_payer: "ร้านค้า" }),
      }),
    );
    expect(messaging.reply).toHaveBeenCalledWith("reply-1", expect.objectContaining({ type: "flex" }));
  });

  it.each([
    ["download", { download: vi.fn().mockRejectedValue(new Error("download secret token")) }, undefined, undefined],
    ["extraction", { download: vi.fn().mockResolvedValue({ buffer: Buffer.from("image-bytes"), mimeType: "image/jpeg" }) }, { extract: vi.fn().mockRejectedValue(new Error("provider payload api-key=secret")) }, undefined],
    ["storage", { download: vi.fn().mockResolvedValue({ buffer: Buffer.from("image-bytes"), mimeType: "image/jpeg" }) }, { extract: vi.fn().mockResolvedValue({ type: "expense", amount: 125, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00", bank: "Other Bank" }) }, { put: vi.fn().mockRejectedValue(new Error("bucket secret")) }],
  ])("replies with a safe failure message and logs only diagnostics when %s fails", async (stage, content, extractor, storage) => {
    const logger = { error: vi.fn() };
    const messaging = { reply: vi.fn().mockResolvedValue(undefined) };
    const pendingSlips = { createPending: vi.fn(), getPending: vi.fn(), consume: vi.fn() };
    const response = await request(createApp({
      storage: storage ?? { put: vi.fn().mockResolvedValue("storage-ref") }, pendingSlips, extractor,
      line: { channelSecret: "channel-secret", content, messaging, logger },
    })).post("/api/line/webhook")
      .set("x-line-signature", signatureFor({ events: [imageEvent] }))
      .send({ events: [imageEvent] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: true, processed: 0 });
    expect(messaging.reply).toHaveBeenCalledWith("reply-1", {
      type: "text", text: "ไม่สามารถประมวลผลสลิปได้ กรุณาลองใหม่",
    });
    expect(logger.error).toHaveBeenCalledWith("LINE webhook processing failed", {
      stage, eventId: "evt-1", messageId: "message-1", userId: "line-user-1", errorClass: "Error",
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("payload");
  });

  it("logs pending persistence failures without leaking thrown error details", async () => {
    const logger = { error: vi.fn() };
    const pendingSlips = { createPending: vi.fn().mockRejectedValue(new Error("database password=secret")), getPending: vi.fn(), consume: vi.fn() };
    const messaging = { reply: vi.fn().mockResolvedValue(undefined) };
    const response = await request(createApp({
      storage: { put: vi.fn().mockResolvedValue("storage-ref") }, pendingSlips,
      extractor: { extract: vi.fn().mockResolvedValue({ type: "expense", amount: 125, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00", bank: "Other Bank" }) },
      line: { channelSecret: "channel-secret", content: { download: vi.fn().mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg" }) }, messaging, logger },
    })).post("/api/line/webhook")
      .set("x-line-signature", signatureFor({ events: [imageEvent] }))
      .send({ events: [imageEvent] });

    expect(response.body).toEqual({ accepted: true, processed: 0 });
    expect(logger.error).toHaveBeenCalledWith("LINE webhook processing failed", expect.objectContaining({ stage: "pending-persistence", errorClass: "Error" }));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("database password=secret");
  });

  it("logs fallback reply failures without exposing the reply token or error", async () => {
    const logger = { error: vi.fn() };
    const response = await request(createApp({
      storage: { put: vi.fn().mockResolvedValue("storage-ref") },
      pendingSlips: { createPending: vi.fn().mockRejectedValue(new Error("db secret")), getPending: vi.fn(), consume: vi.fn() },
      line: { channelSecret: "channel-secret", content: { download: vi.fn().mockRejectedValue(new Error("download secret")) }, messaging: { reply: vi.fn().mockRejectedValue(new Error("reply provider secret")) }, logger },
    })).post("/api/line/webhook")
      .set("x-line-signature", signatureFor({ events: [imageEvent] }))
      .send({ events: [imageEvent] });

    expect(response.body).toEqual({ accepted: true, processed: 0 });
    expect(logger.error).toHaveBeenCalledWith("LINE webhook processing failed", expect.objectContaining({ stage: "download" }));
    expect(logger.error).toHaveBeenCalledWith("LINE webhook failure reply failed", expect.objectContaining({ stage: "reply-fallback", errorClass: "Error" }));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("reply-1");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
  });

  it("does not leak internals when the successful Flex reply fails", async () => {
    const logger = { error: vi.fn() };
    const response = await request(createApp({
      storage: { put: vi.fn().mockResolvedValue("storage-ref") },
      pendingSlips: { createPending: vi.fn().mockResolvedValue("pending-1"), getPending: vi.fn(), consume: vi.fn() },
      extractor: { extract: vi.fn().mockResolvedValue({ type: "expense", amount: 125, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00", bank: "Other Bank" }) },
      line: { channelSecret: "channel-secret", content: { download: vi.fn().mockResolvedValue({ buffer: Buffer.from("image"), mimeType: "image/jpeg" }) }, messaging: { reply: vi.fn().mockRejectedValue(new Error("reply token secret")) }, logger },
    })).post("/api/line/webhook")
      .set("x-line-signature", signatureFor({ events: [imageEvent] }))
      .send({ events: [imageEvent] });

    expect(response.body).toEqual({ accepted: true, processed: 0 });
    expect(logger.error).toHaveBeenCalledWith("LINE webhook processing failed", expect.objectContaining({ stage: "reply", errorClass: "Error" }));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("reply token secret");
  });

  it("claims an event before downloading so webhook retries are idempotent", async () => {
    const content = { download: vi.fn() };
    const events = { claim: vi.fn().mockResolvedValue(false) };
    const response = await request(createApp({
      events,
      line: { channelSecret: "channel-secret", content, messaging: { reply: vi.fn() } },
    })).post("/api/line/webhook")
      .set("x-line-signature", signatureFor({ events: [imageEvent] }))
      .send({ events: [imageEvent] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: true, processed: 0 });
    expect(events.claim).toHaveBeenCalledWith("evt-1", "line-user-1", "message-1");
    expect(content.download).not.toHaveBeenCalled();
  });
});

function signatureFor(body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  return createHmac("sha256", "channel-secret").update(raw).digest("base64");
}
