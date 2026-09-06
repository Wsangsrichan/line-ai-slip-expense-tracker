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
  it.each([
    ["missing extraction", null, "missing-extraction"],
    ["schema-invalid extraction", undefined, "schema-invalid"],
  ])("diagnoses pending %s while preserving the generic not-found response", async (_name, extraction, reason) => {
    const logger = { error: vi.fn() };
    const pendingSlips = {
      getPending: vi.fn().mockResolvedValue({ storageRef: "slip", contentHash: "hash", extraction, extractionStatus: reason === "schema-invalid" ? "invalid" : "missing" }),
      createPending: vi.fn(), consume: vi.fn(),
    } as never;
    const response = await request(createApp({ pendingSlips, logger })).get("/api/slips/pending/pending-id").set("x-line-user-id", "owner");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "ไม่พบข้อมูลสลิป ลิงก์อาจหมดอายุหรือไม่ใช่ของผู้ใช้" });
    expect(logger.error).toHaveBeenCalledWith("Pending slip GET diagnostic", {
      stage: "pending-get", reason, hasExtraction: false,
    });
  });

  it("logs pending database errors safely and returns a generic service error", async () => {
    const logger = { error: vi.fn() };
    const pendingSlips = { getPending: vi.fn().mockRejectedValue(new Error("database password=secret")), createPending: vi.fn(), consume: vi.fn() } as never;
    const response = await request(createApp({ pendingSlips, logger })).get("/api/slips/pending/pending-id").set("x-line-user-id", "owner");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "ไม่สามารถโหลดข้อมูลสลิปได้ กรุณาลองใหม่" });
    expect(logger.error).toHaveBeenCalledWith("Pending slip GET diagnostic", {
      stage: "pending-get", reason: "database-error", hasExtraction: false, errorClass: "Error",
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
  });

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

  it("diagnoses transaction create failures without logging request identity or provider details", async () => {
    const logger = { error: vi.fn() };
    const pendingSlips = new DummyPendingSlipStore();
    const transactionRepository = {
      create: vi.fn().mockRejectedValue(Object.assign(new Error("relation missing user-id secret"), { code: "42703", status: 500 })),
      listForDashboard: vi.fn().mockResolvedValue([]),
    };
    const uploadId = await pendingSlips.createPending("diagnostic-user", "slip", "hash", {
      extraction: { type: "expense", amount: 10, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00" },
    });
    const app = createApp({ pendingSlips, transactionRepository, logger });
    const body = { type: "expense", amount: 10, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00", upload_id: uploadId };

    const response = await request(app).post("/api/transactions").set("x-line-user-id", "diagnostic-user").send(body);

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith("Transaction persistence diagnostic", {
      stage: "transaction-create", reason: "database-error", errorClass: "Error", supabaseCode: "42703", httpStatus: 500,
    });
    const diagnostics = JSON.stringify(logger.error.mock.calls);
    expect(diagnostics).not.toContain("diagnostic-user");
    expect(diagnostics).not.toContain(uploadId);
    expect(diagnostics).not.toContain("secret");
    expect((await request(app).get(`/api/slips/pending/${uploadId}`).set("x-line-user-id", "diagnostic-user")).status).toBe(200);
  });

  it("returns success after durable create when pending cleanup fails and diagnoses the cleanup stage", async () => {
    const logger = { error: vi.fn() };
    const pendingSlips = {
      getPending: vi.fn().mockResolvedValue({
        storageRef: "slip", contentHash: "hash",
        extraction: { type: "expense", amount: 10, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00" },
      }),
      createPending: vi.fn(),
      consume: vi.fn().mockRejectedValue(Object.assign(new Error("cleanup secret"), { code: "XX000", status: 503 })),
    } as never;
    const transactionRepository = {
      create: vi.fn().mockResolvedValue({ id: "transaction-id" }),
      listForDashboard: vi.fn().mockResolvedValue([]),
    };
    const app = createApp({ pendingSlips, transactionRepository, logger });

    const response = await request(app).post("/api/transactions").set("x-line-user-id", "cleanup-user").send({
      type: "expense", amount: 10, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00", upload_id: "upload-id",
    });

    expect(response.status).toBe(201);
    expect(logger.error).toHaveBeenCalledWith("Transaction persistence diagnostic", {
      stage: "transaction-consume", reason: "cleanup-error", errorClass: "Error", supabaseCode: "XX000", httpStatus: 503,
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("cleanup-user");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("cleanup secret");
  });

  it("lists only the authenticated user's transaction history with validated filters", async () => {
    const transactionRepository = {
      create: vi.fn(), listForDashboard: vi.fn().mockResolvedValue([]),
      listTransactions: vi.fn().mockResolvedValue({ total: 1, internalCursor: "must-not-leak", items: [{
        id: "transaction-1", type: "expense", amount: "125.00", payee_payer: "ร้านค้า", category: "อาหาร",
        transaction_datetime: "2026-09-05T10:30:00+07:00", slip_image_url: "private/user-a/slip-1",
      }] }),
    };
    const response = await request(createApp({ transactionRepository })).get("/api/transactions?page=2&page_size=5&q=%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2&type=expense&start=2026-09-01&end=2026-09-30")
      .set("x-line-user-id", "history-user");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 2, page_size: 5, total: 1, has_more: false });
    expect(response.body).not.toHaveProperty("internalCursor");
    expect(response.body.items[0]).not.toHaveProperty("slip_image_url");
    expect(transactionRepository.listTransactions).toHaveBeenCalledWith("history-user", expect.objectContaining({ page: 2, pageSize: 5, type: "expense", search: "ร้านค้า" }));
  });

  it("returns a short-lived signed slip URL only after an ownership-scoped detail lookup", async () => {
    const transactionRepository = {
      create: vi.fn(), listForDashboard: vi.fn().mockResolvedValue([]), listTransactions: vi.fn(),
      getTransaction: vi.fn().mockResolvedValue({ id: "transaction-1", type: "expense", amount: 125, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00", slip_image_url: "private/user-a/slip-1" }),
    };
    const storage = { put: vi.fn(), createSignedUrl: vi.fn().mockResolvedValue("https://signed.example/slip?expires=300") };
    const response = await request(createApp({ transactionRepository, storage })).get("/api/transactions/transaction-1").set("x-line-user-id", "history-user");

    expect(response.status).toBe(200);
    expect(response.body.data.slip_image_url).toBe("https://signed.example/slip?expires=300");
    expect(response.body.data).not.toHaveProperty("slip_content_sha256");
    expect(transactionRepository.getTransaction).toHaveBeenCalledWith("history-user", "transaction-1");
    expect(storage.createSignedUrl).toHaveBeenCalledWith("private/user-a/slip-1", 300);
  });

  it("uses the requested Bangkok date range for dashboard and recent items", async () => {
    const transactionRepository = { create: vi.fn(), listForDashboard: vi.fn().mockResolvedValue([]) };
    const response = await request(createApp({ transactionRepository })).get("/api/dashboard?start=2026-09-01&end=2026-09-07").set("x-line-user-id", "range-user");

    expect(response.status).toBe(200);
    expect(transactionRepository.listForDashboard).toHaveBeenCalledWith("range-user", new Date("2026-08-31T17:00:00.000Z"), new Date("2026-09-07T17:00:00.000Z"), new Date("2026-08-24T17:00:00.000Z"));
    expect(response.body.data.period.label).toBe("2026-09-01 ถึง 2026-09-07");
    expect(response.body.data.recent).toEqual([]);
  });

  it("attempts a post-save LINE Flex summary without rolling back a durable transaction", async () => {
    const logger = { error: vi.fn() };
    const pendingSlips = new DummyPendingSlipStore();
    const uploadId = await pendingSlips.createPending("summary-user", "slip", "hash", { extraction: { type: "expense", amount: 10, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00" } });
    const transactionRepository = { create: vi.fn().mockResolvedValue({ id: "transaction-1" }), listForDashboard: vi.fn().mockResolvedValue([]) };
    const push = vi.fn().mockRejectedValue(new Error("LINE provider secret"));
    const response = await request(createApp({ pendingSlips, transactionRepository, logger, line: { channelSecret: "channel-secret", content: { download: vi.fn() }, messaging: { reply: vi.fn(), push } } })).post("/api/transactions")
      .set("x-line-user-id", "summary-user").send({ type: "expense", amount: 10, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00", upload_id: uploadId });

    expect(response.status).toBe(201);
    expect(push).toHaveBeenCalledWith("summary-user", expect.objectContaining({ type: "flex" }));
    expect(logger.error).toHaveBeenCalledWith("Transaction persistence diagnostic", expect.objectContaining({ stage: "line-summary", reason: "line-send-failed", errorClass: "Error" }));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("summary-user");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("LINE provider secret");
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
