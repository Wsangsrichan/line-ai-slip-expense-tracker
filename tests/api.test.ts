import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { DummyPendingSlipStore } from "../src/services/persistence.js";

afterEach(() => {
  process.env.LINE_AUTH_MODE = "dummy";
  delete process.env.GEMINI_API_KEY;
  delete process.env.VERCEL;
  vi.unstubAllGlobals();
});

describe("Capture-to-Verify API", () => {
  it("previews an owned pending slip without consuming it", async () => {
    const pendingSlips = new DummyPendingSlipStore();
    const uploadId = await pendingSlips.createPending("preview-user", "preview/slip", "hash", {
      extraction: { type: "expense", amount: 99, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00" },
    });
    const app = createApp({ pendingSlips });

    const preview = await request(app).get(`/api/slips/pending/${uploadId}`).set("x-line-user-id", "preview-user");
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({ upload_id: uploadId, data: expect.objectContaining({ amount: 99 }) });
    expect((await request(app).get(`/api/slips/pending/${uploadId}`).set("x-line-user-id", "preview-user")).status).toBe(200);
  });

  it("does not reveal pending slips for another user, missing IDs, or expired IDs", async () => {
    const pendingSlips = new DummyPendingSlipStore();
    const uploadId = await pendingSlips.createPending("owner", "slip", "hash");
    const app = createApp({ pendingSlips });
    expect((await request(app).get(`/api/slips/pending/${uploadId}`).set("x-line-user-id", "intruder")).status).toBe(404);
    expect((await request(app).get("/api/slips/pending/not-a-real-id").set("x-line-user-id", "owner")).status).toBe(404);
    expect((await request(app).get("/api/slips/pending/").set("x-line-user-id", "owner")).status).toBe(404);
    const expired = new DummyPendingSlipStore(0);
    const expiredId = await expired.createPending("owner", "slip", "hash", {
      extraction: { type: "expense", amount: 1, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00" },
    });
    expect((await request(createApp({ pendingSlips: expired })).get(`/api/slips/pending/${expiredId}`).set("x-line-user-id", "owner")).status).toBe(404);
  });

  it("serves the LIFF app at the root path", async () => {
    const response = await request(createApp()).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("บันทึกรายการจากสลิป");
  });

  it("accepts the path shape used by a Vercel catch-all function", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("returns validated extraction for an authenticated image upload", async () => {
    const response = await request(createApp()).post("/api/slips/extract")
      .set("x-line-user-id", "dummy-user")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");

    expect(response.status).toBe(200);
    expect(response.body.data.amount).toBe(250);
    expect(response.body.data.bank).toBe("Other Bank");
    expect(response.body.upload_id).toEqual(expect.any(String));
  });

  it("passes the uploaded PNG MIME type through to Gemini extraction", async () => {
    process.env.GEMINI_API_KEY = "placeholder-api-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        type: "expense", amount: 250, payee_payer: "ร้านค้าตัวอย่าง", category: "อาหาร",
        transaction_datetime: "2026-09-05T10:30:00+07:00",
      }) }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(createApp()).post("/api/slips/extract")
      .set("x-line-user-id", "dummy-user")
      .attach("slip", Buffer.from("png image bytes"), { filename: "slip.png", contentType: "image/png" });

    expect(response.status).toBe(200);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.contents[0].parts.find((part: { inline_data?: unknown }) => part.inline_data)?.inline_data.mime_type).toBe("image/png");
  });

  it("rejects an upload without LINE identity", async () => {
    const response = await request(createApp()).post("/api/slips/extract")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");

    expect(response.status).toBe(401);
  });

  it("does not allow the demo identity header to bypass real LINE mode", async () => {
    process.env.LINE_AUTH_MODE = "real";
    const response = await request(createApp()).get("/api/health")
      .set("x-line-user-id", "replace-with-local-dummy-user-id");

    expect(response.status).toBe(200);
    const protectedResponse = await request(createApp()).post("/api/slips/extract")
      .set("x-line-user-id", "replace-with-local-dummy-user-id")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");
    expect(protectedResponse.status).toBe(401);
  });

  it("uses real LINE verification when auth mode is not explicitly dummy", async () => {
    delete process.env.LINE_AUTH_MODE;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ client_id: "liff-client" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ userId: "line-user" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(createApp()).post("/api/slips/extract")
      .set("authorization", "Bearer liff-access-token")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");

    expect(response.status).toBe(200);
    expect(response.body.user_id).toBe("line-user");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed in Vercel when no durable receipt configuration exists", async () => {
    process.env.VERCEL = "1";
    const response = await request(createApp()).post("/api/slips/extract")
      .set("x-line-user-id", "dummy-user")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");

    expect(response.status).toBe(503);
    delete process.env.VERCEL;
  });

  it("blocks save when required fields are missing", async () => {
    const response = await request(createApp()).post("/api/transactions/validate")
      .set("x-line-user-id", "dummy-user")
      .send({ amount: 0, type: "expense", payee_payer: "", category: "" });

    expect(response.status).toBe(422);
    expect(response.body.errors.map((error: { field: string }) => error.field)).toEqual(
      expect.arrayContaining(["amount", "payee_payer", "category", "transaction_datetime"]),
    );
  });

  it("saves only an upload stored by the server, never an arbitrary image URL", async () => {
    const app = createApp();
    const upload = await request(app).post("/api/slips/extract")
      .set("x-line-user-id", "dummy-user")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");
    const data = { ...upload.body.data, upload_id: upload.body.upload_id };
    const saved = await request(app).post("/api/transactions")
      .set("x-line-user-id", "dummy-user").send(data);
    expect(saved.status).toBe(201);

    const arbitrary = await request(createApp()).post("/api/transactions")
      .set("x-line-user-id", "dummy-user")
      .send({ ...data, upload_id: undefined, slip_image_url: "https://attacker.example/slip.jpg" });
    expect(arbitrary.status).toBe(422);

    const foreignUpload = await request(createApp()).post("/api/transactions")
      .set("x-line-user-id", "dummy-user").send(data);
    expect(foreignUpload.status).toBe(404);
  });

  it("keeps a pending slip when transaction persistence fails", async () => {
    const pendingSlips = new DummyPendingSlipStore();
    const transactionRepository = { create: vi.fn().mockRejectedValue(new Error("temporary")), listForDashboard: vi.fn().mockResolvedValue([]) };
    const uploadId = await pendingSlips.createPending("retry-user", "slip", "hash", {
      extraction: { type: "expense", amount: 10, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00" },
    });
    const app = createApp({ pendingSlips, transactionRepository });
    const body = { type: "expense", amount: 10, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00", upload_id: uploadId };
    expect((await request(app).post("/api/transactions").set("x-line-user-id", "retry-user").send(body)).status).toBe(503);
    expect((await request(app).get(`/api/slips/pending/${uploadId}`).set("x-line-user-id", "retry-user")).status).toBe(200);
  });

  it("rejects the same image bytes for the same LINE user", async () => {
    const app = createApp();
    const image = Buffer.from("same-slip-bytes");
    const upload = await request(app).post("/api/slips/extract").set("x-line-user-id", "same-user")
      .attach("slip", image, "slip.jpg");
    const data = { ...upload.body.data, upload_id: upload.body.upload_id };
    expect((await request(app).post("/api/transactions").set("x-line-user-id", "same-user").send(data)).status).toBe(201);

    const retryUpload = await request(app).post("/api/slips/extract").set("x-line-user-id", "same-user")
      .attach("slip", image, "renamed.jpg");
    const retry = await request(app).post("/api/transactions").set("x-line-user-id", "same-user")
      .send({ ...retryUpload.body.data, upload_id: retryUpload.body.upload_id });
    expect(retry.status).toBe(409);
    expect(retry.body.error).toBe("สลิปภาพนี้ถูกบันทึกไปแล้ว ไม่สามารถบันทึกซ้ำได้");
  });

  it("allows the same image bytes for a different LINE user", async () => {
    const app = createApp();
    const image = Buffer.from("shared-slip-bytes");
    const uploads = await Promise.all(["user-a", "user-b"].map((userId) => request(app).post("/api/slips/extract")
      .set("x-line-user-id", userId).attach("slip", image, "slip.jpg")));
    const responses = await Promise.all(uploads.map((upload, index) => request(app).post("/api/transactions")
      .set("x-line-user-id", index === 0 ? "user-a" : "user-b")
      .send({ ...upload.body.data, upload_id: upload.body.upload_id })));
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
  });

  it("allows only one concurrent save for two uploads of the same image", async () => {
    const app = createApp();
    const image = Buffer.from("concurrent-slip-bytes");
    const uploads = await Promise.all(["a.jpg", "b.jpg"].map((filename) => request(app).post("/api/slips/extract")
      .set("x-line-user-id", "race-user").attach("slip", image, filename)));
    const responses = await Promise.all(uploads.map((upload) => request(app).post("/api/transactions")
      .set("x-line-user-id", "race-user")
      .send({ ...upload.body.data, upload_id: upload.body.upload_id })));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  });
});
