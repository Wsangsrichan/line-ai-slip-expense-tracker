import express from "express";
import multer from "multer";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateForSave } from "./domain/slip.js";
import { createExtractor, extractSlip } from "./services/extraction.js";
import { DummyIdentityVerifier, LineApiIdentityVerifier, getLineUserId } from "./services/identity.js";
import { validateImageUpload } from "./services/upload.js";
import { aggregateDashboard, getBangkokMonthBounds } from "./services/dashboard.js";
import { createSupabasePersistence, DUPLICATE_SLIP_ERROR_CODE, DUPLICATE_SLIP_ERROR_MESSAGE, DummyPendingSlipStore, DummySlipStorage, DummyTransactionRepository, DummyWebhookEventStore, SignedPendingSlipStore, type PendingSlipStore, type SlipStorage, type TransactionRepository, type WebhookEventStore } from "./services/persistence.js";
import { createLineWebhookProcessor, LineContentApiClient, LineMessagingApiClient, verifyLineSignature, type LineContentClient, type LineMessagingClient } from "./services/line-webhook.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export interface AppDependencies {
  transactionRepository?: TransactionRepository;
  storage?: SlipStorage;
  pendingSlips?: PendingSlipStore;
  events?: WebhookEventStore;
  extractor?: ReturnType<typeof createExtractor>;
  line?: { channelSecret: string; content: LineContentClient; messaging: LineMessagingClient; liffUrl?: string };
}

declare global {
  namespace Express {
    interface Request { rawBody?: Buffer }
  }
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const supabase = createSupabasePersistence();
  const storage = dependencies.storage ?? supabase ?? new DummySlipStorage();
  const pendingSlips = dependencies.pendingSlips ?? supabase ?? (process.env.UPLOAD_SIGNING_KEY
    ? new SignedPendingSlipStore(process.env.UPLOAD_SIGNING_KEY)
    : process.env.VERCEL === "1" ? null : new DummyPendingSlipStore());
  const transactionRepository = dependencies.transactionRepository ?? supabase ?? new DummyTransactionRepository();
  const events = dependencies.events ?? supabase ?? new DummyWebhookEventStore();
  // Real LINE verification is the safe default. Dummy identity is available
  // only when explicitly requested for local development and tests.
  const identityVerifier = process.env.LINE_AUTH_MODE === "dummy"
    ? new DummyIdentityVerifier()
    : new LineApiIdentityVerifier();
  const extractor = dependencies.extractor ?? createExtractor();
  app.use(express.json({ limit: "100kb", verify: (request, _response, buffer) => {
    (request as typeof request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  } }));
  app.get("/", (_request, response) => response.sendFile("index.html", {
    root: path.join(process.cwd(), "public"),
  }));
  // Vercel catch-all functions may invoke Express with the /api prefix removed.
  // Normalize only non-root paths so both local and Vercel routing work.
  app.use((request, _response, next) => {
    if (request.url !== "/" && !request.url.startsWith("/api/")) {
      request.url = `/api${request.url}`;
    }
    next();
  });
  app.get("/api/health", (_request, response) => response.json({ ok: true }));

  const lineConfig = dependencies.line ?? (process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN
    ? {
      channelSecret: process.env.LINE_CHANNEL_SECRET,
      content: new LineContentApiClient(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      messaging: new LineMessagingApiClient(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      liffUrl: process.env.LIFF_URL,
    }
    : undefined);
  app.post("/api/line/webhook", async (request, response) => {
    if (!lineConfig || !request.rawBody || !verifyLineSignature(request.rawBody, request.header("x-line-signature"), lineConfig.channelSecret)) {
      return response.status(lineConfig ? 401 : 503).json({ error: lineConfig ? "invalid signature" : "LINE webhook is not configured" });
    }
    const processWebhook = createLineWebhookProcessor(lineConfig, { storage, pendingSlips: pendingSlips ?? new DummyPendingSlipStore(), events, extractor });
    return response.json(await processWebhook(request.body as { events?: unknown[] }));
  });

  app.get("/api/dashboard", async (request, response) => {
    const userId = await getLineUserId(identityVerifier, {
      token: request.headers.authorization,
      dummyUserId: request.headers["x-line-user-id"] as string | undefined,
    });
    if (!userId) return response.status(401).json({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
    const now = new Date();
    const bounds = getBangkokMonthBounds(now);
    try {
      const transactions = await transactionRepository.listForDashboard(userId, bounds.current.start, bounds.current.end, bounds.previous.start);
      return response.json({ state: "complete", data: aggregateDashboard(transactions, now) });
    } catch {
      return response.status(503).json({ state: "recoverable-error", error: "ไม่สามารถโหลดข้อมูล Dashboard ได้ กรุณาลองใหม่" });
    }
  });

  app.post("/api/slips/extract", upload.single("slip"), async (request, response) => {
    const userId = await getLineUserId(identityVerifier, {
      token: request.headers.authorization,
      dummyUserId: request.headers["x-line-user-id"] as string | undefined,
    });
    if (!userId) return response.status(401).json({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
    if (!request.file) return response.status(400).json({ error: "กรุณาเลือกภาพสลิป" });

    const fileCheck = validateImageUpload(request.file.mimetype, request.file.size);
    if (!fileCheck.valid) return response.status(415).json({ error: fileCheck.message });

    const result = await extractSlip(extractor, request.file.buffer, request.file.mimetype);
    if (!result.success) return response.status(422).json({ error: result.message });
    if (!pendingSlips) return response.status(503).json({ error: "ระบบยังไม่ได้ตั้งค่า durable upload storage" });
    const contentHash = createHash("sha256").update(request.file.buffer).digest("hex");
    try {
      const storageRef = await storage.put(userId, request.file.buffer, request.file.mimetype);
      const uploadId = await pendingSlips.createPending(userId, storageRef, contentHash);
      return response.json({ user_id: userId, upload_id: uploadId, data: result.data });
    } catch {
      return response.status(503).json({ error: "ไม่สามารถเก็บภาพสลิปได้ กรุณาลองใหม่" });
    }
  });

  app.post("/api/transactions/validate", async (request, response) => {
    const userId = await getLineUserId(identityVerifier, {
      token: request.headers.authorization,
      dummyUserId: request.headers["x-line-user-id"] as string | undefined,
    });
    if (!userId) return response.status(401).json({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });

    const result = validateForSave(request.body);
    if (!result.success) return response.status(422).json({ errors: result.errors });
    return response.json({ valid: true, user_id: userId, data: result.data });
  });

  app.post("/api/transactions", async (request, response) => {
    const userId = await getLineUserId(identityVerifier, {
      token: request.headers.authorization,
      dummyUserId: request.headers["x-line-user-id"] as string | undefined,
    });
    if (!userId) return response.status(401).json({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
    const result = validateForSave(request.body);
    if (!result.success) return response.status(422).json({ errors: result.errors });
    if (typeof request.body.upload_id !== "string" || !request.body.upload_id) {
      return response.status(422).json({ error: "กรุณาอัปโหลดภาพสลิปก่อนบันทึก" });
    }
    if (!pendingSlips) return response.status(503).json({ error: "ระบบยังไม่ได้ตั้งค่า durable upload storage" });
    const pendingSlip = await pendingSlips.consume(userId, request.body.upload_id);
    if (!pendingSlip) return response.status(404).json({ error: "ไม่พบภาพสลิปหรือภาพนี้ไม่ใช่ของผู้ใช้" });
    try {
      const transaction = await transactionRepository.create(userId, {
        ...result.data,
        slip_image_url: pendingSlip.storageRef,
        slip_content_sha256: pendingSlip.contentHash,
      });
      return response.status(201).json({ saved: true, transaction });
    } catch (error) {
      if ((error as { code?: string }).code === DUPLICATE_SLIP_ERROR_CODE) {
        return response.status(409).json({ error: DUPLICATE_SLIP_ERROR_MESSAGE });
      }
      return response.status(503).json({ error: "ไม่สามารถบันทึกรายการได้ กรุณาลองใหม่" });
    }
  });

  return app;
}

// Vercel detects src/app.ts as an Express entrypoint. Keep the app as a
// default export so the same module works in Vercel's Node.js runtime.
export default createApp();
