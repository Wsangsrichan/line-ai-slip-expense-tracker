import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let webhookHandler: typeof import("../api/line/webhook.js").default;

const previousEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeAll(async () => {
  process.env.NODE_ENV = "production";
  process.env.LINE_CHANNEL_SECRET = "channel-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "access-token";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  webhookHandler = (await import("../api/line/webhook.js")).default;
});

afterAll(() => {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Vercel LINE webhook route", () => {
  it("routes signed POST requests to the existing webhook handler", async () => {
    const body = { destination: "bot", events: [] };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac("sha256", "channel-secret").update(rawBody).digest("base64");

    const response = await request(webhookHandler)
      .post("/api/line/webhook")
      .set("x-line-signature", signature)
      .set("content-type", "application/json")
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "ระบบยังไม่ได้ตั้งค่า durable upload storage" });
  });
});
