import express from "express";
import multer from "multer";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateForSave } from "./domain/slip.js";
import { createExtractor, extractSlip } from "./services/extraction.js";
import { DummyIdentityVerifier, LineApiIdentityVerifier, getLineUserId } from "./services/identity.js";
import { validateImageUpload } from "./services/upload.js";
import { aggregateDashboard, getBangkokDateRangeBounds, getBangkokMonthBounds } from "./services/dashboard.js";
import { createSupabasePersistence, DUPLICATE_SLIP_ERROR_CODE, DUPLICATE_SLIP_ERROR_MESSAGE, DummyPendingSlipStore, DummySlipStorage, DummyTransactionRepository, DummyWebhookEventStore, SignedPendingSlipStore, serializeSupabaseError, type PendingSlipDiagnostic, type PendingSlipLogger, type PendingSlipStore, type SlipStorage, type TransactionDiagnostic, type TransactionListOptions, type TransactionRepository, type TransactionRecord, type WebhookEventStore } from "./services/persistence.js";
import { createLineWebhookProcessor, LineContentApiClient, LineMessagingApiClient, verifyLineSignature, type LineContentClient, type LineMessagingClient, type LineWebhookLogger } from "./services/line-webhook.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export interface AppDependencies {
  transactionRepository?: TransactionRepository;
  storage?: SlipStorage;
  pendingSlips?: PendingSlipStore;
  events?: WebhookEventStore;
  extractor?: ReturnType<typeof createExtractor>;
  logger?: PendingSlipLogger;
  line?: { channelSecret: string; content: LineContentClient; messaging: LineMessagingClient; liffUrl?: string; logger?: LineWebhookLogger };
}

declare global {
  namespace Express {
    interface Request { rawBody?: Buffer }
  }
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const logger = dependencies.logger ?? console;
  const supabase = createSupabasePersistence(process.env, logger);
  const isProduction = process.env.NODE_ENV === "production";
  const storage = dependencies.storage ?? supabase ?? (isProduction ? null : new DummySlipStorage());
  const pendingSlips: PendingSlipStore | null = dependencies.pendingSlips ?? supabase ?? (isProduction ? null : process.env.UPLOAD_SIGNING_KEY
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
    if (!storage || !pendingSlips) return response.status(503).json({ error: "ระบบยังไม่ได้ตั้งค่า durable upload storage" });
    const processWebhook = createLineWebhookProcessor(lineConfig, { storage, pendingSlips, events, extractor });
    return response.json(await processWebhook(request.body as { events?: unknown[] }));
  });

  app.get("/api/dashboard", async (request, response) => {
    const userId = await getLineUserId(identityVerifier, {
      token: request.headers.authorization,
      dummyUserId: request.headers["x-line-user-id"] as string | undefined,
    });
    if (!userId) return response.status(401).json({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
    const now = new Date();
    const requestedBounds = getRequestedDashboardBounds(request.query, now);
    if (!requestedBounds) return response.status(400).json({ error: "ช่วงวันที่ไม่ถูกต้อง กรุณาเลือกวันที่ไม่เกิน 1 ปี" });
    const bounds = requestedBounds;
    try {
      const transactions = await transactionRepository.listForDashboard(userId, bounds.current.start, bounds.current.end, bounds.previous.start);
      return response.json({ state: "complete", data: aggregateDashboard(transactions, now, bounds) });
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
    if (!storage || !pendingSlips) return response.status(503).json({ error: "ระบบยังไม่ได้ตั้งค่า durable upload storage" });
    const contentHash = createHash("sha256").update(request.file.buffer).digest("hex");
    try {
      const storageRef = await storage.put(userId, request.file.buffer, request.file.mimetype);
      const uploadId = await pendingSlips.createPending(userId, storageRef, contentHash);
      return response.json({ user_id: userId, upload_id: uploadId, data: result.data });
    } catch {
      return response.status(503).json({ error: "ไม่สามารถเก็บภาพสลิปได้ กรุณาลองใหม่" });
    }
  });

  app.get("/api/slips/pending/:uploadId", async (request, response) => {
    const userId = await getLineUserId(identityVerifier, {
      token: request.headers.authorization,
      dummyUserId: request.headers["x-line-user-id"] as string | undefined,
    });
    if (!userId) return response.status(401).json({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
    if (!pendingSlips) return response.status(503).json({ error: "ระบบยังไม่ได้ตั้งค่า durable upload storage" });
    try {
      const pendingSlip = await pendingSlips.getPending(userId, request.params.uploadId);
      if (!pendingSlip) {
        logPendingDiagnostic(logger, {
          stage: "pending-get",
          reason: "not-found",
          hasExtraction: false,
          userFingerprint: fingerprint(userId),
          uploadFingerprint: fingerprint(request.params.uploadId),
        });
        return response.status(404).json({ error: "ไม่พบข้อมูลสลิป ลิงก์อาจหมดอายุหรือไม่ใช่ของผู้ใช้" });
      }
      if (!pendingSlip.extraction) {
        logPendingDiagnostic(logger, {
          stage: "pending-get",
          reason: pendingSlip.extractionStatus === "invalid" ? "schema-invalid" : "missing-extraction",
          hasExtraction: false,
        });
        return response.status(404).json({ error: "ไม่พบข้อมูลสลิป ลิงก์อาจหมดอายุหรือไม่ใช่ของผู้ใช้" });
      }
      logPendingDiagnostic(logger, { stage: "pending-get", reason: "found", hasExtraction: true });
      return response.json({ upload_id: request.params.uploadId, data: pendingSlip.extraction });
    } catch (error) {
      logPendingDiagnostic(logger, { stage: "pending-get", reason: "database-error", hasExtraction: false, errorClass: errorClass(error) });
      return response.status(503).json({ error: "ไม่สามารถโหลดข้อมูลสลิปได้ กรุณาลองใหม่" });
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

  app.get("/api/transactions", async (request, response) => {
    const userId = await getLineUserId(identityVerifier, {
      token: request.headers.authorization,
      dummyUserId: request.headers["x-line-user-id"] as string | undefined,
    });
    if (!userId) return response.status(401).json({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
    const options = parseTransactionListOptions(request.query);
    if (!options) return response.status(400).json({ error: "ตัวกรองประวัติรายการไม่ถูกต้อง" });
    if (!transactionRepository.listTransactions) return response.status(503).json({ error: "ระบบประวัติรายการยังไม่พร้อมใช้งาน" });
    try {
      const result = await transactionRepository.listTransactions(userId, options);
      return response.json({ total: result.total, page: options.page, page_size: options.pageSize, has_more: options.page * options.pageSize < result.total,
        items: result.items.map(publicTransaction) });
    } catch {
      return response.status(503).json({ error: "ไม่สามารถโหลดประวัติรายการได้ กรุณาลองใหม่" });
    }
  });

  app.get("/api/transactions/:transactionId", async (request, response) => {
    const userId = await getLineUserId(identityVerifier, {
      token: request.headers.authorization,
      dummyUserId: request.headers["x-line-user-id"] as string | undefined,
    });
    if (!userId) return response.status(401).json({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
    if (!transactionRepository.getTransaction) return response.status(503).json({ error: "ระบบรายละเอียดรายการยังไม่พร้อมใช้งาน" });
    try {
      const transaction = await transactionRepository.getTransaction(userId, request.params.transactionId);
      if (!transaction) return response.status(404).json({ error: "ไม่พบรายการหรือรายการนี้ไม่ใช่ของผู้ใช้" });
      if (!storage?.createSignedUrl) return response.status(503).json({ error: "ระบบภาพสลิปยังไม่พร้อมใช้งาน" });
      const slipImageUrl = await storage.createSignedUrl(transaction.slip_image_url, 300);
      return response.json({ data: { ...publicTransaction(transaction), slip_image_url: slipImageUrl } });
    } catch {
      return response.status(503).json({ error: "ไม่สามารถโหลดรายละเอียดรายการได้ กรุณาลองใหม่" });
    }
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
    const transactionContext = {
      userFingerprint: fingerprint(userId),
      uploadFingerprint: fingerprint(request.body.upload_id),
    };
    logTransactionDiagnostic(logger, { stage: "transaction-create", reason: "started", ...transactionContext });
    let pendingSlip;
    try {
      pendingSlip = await pendingSlips.getPending(userId, request.body.upload_id);
    } catch (error) {
      logTransactionDiagnostic(logger, { stage: "pending-lookup", reason: "database-error", ...transactionContext, ...safeDatabaseDiagnostic(error) });
      return response.status(503).json({ error: "ไม่สามารถตรวจสอบข้อมูลสลิปได้ กรุณาลองใหม่" });
    }
    if (!pendingSlip) {
      logTransactionDiagnostic(logger, { stage: "pending-lookup", reason: "not-found", ...transactionContext });
      return response.status(404).json({ error: "ไม่พบภาพสลิปหรือภาพนี้ไม่ใช่ของผู้ใช้" });
    }
    logTransactionDiagnostic(logger, { stage: "pending-lookup", reason: "found", ...transactionContext });
    let transaction: { id: string };
    try {
      transaction = await transactionRepository.create(userId, {
        ...result.data,
        slip_image_url: pendingSlip.storageRef,
        slip_content_sha256: pendingSlip.contentHash,
      });
    } catch (error) {
      if ((error as { code?: string }).code === DUPLICATE_SLIP_ERROR_CODE) {
        logTransactionDiagnostic(logger, { stage: "transaction-create", reason: "duplicate", ...transactionContext, ...safeDatabaseDiagnostic(error) });
        return response.status(409).json({ error: DUPLICATE_SLIP_ERROR_MESSAGE });
      }
      logTransactionDiagnostic(logger, { stage: "transaction-create", reason: "database-error", ...transactionContext, ...safeDatabaseDiagnostic(error) });
      return response.status(503).json({ error: "ไม่สามารถบันทึกรายการได้ กรุณาลองใหม่" });
    }
    const transactionContextWithId = { ...transactionContext, transactionFingerprint: fingerprint(transaction.id) };
    logTransactionDiagnostic(logger, { stage: "transaction-create", reason: "created", ...transactionContextWithId });
    try {
      const consumed = await pendingSlips.consume(userId, request.body.upload_id);
      if (!consumed) logTransactionDiagnostic(logger, { stage: "transaction-consume", reason: "cleanup-not-found", ...transactionContextWithId });
      else logTransactionDiagnostic(logger, { stage: "transaction-consume", reason: "consumed", ...transactionContextWithId });
    } catch (error) {
      // The transaction is already durable. Report success and let cleanup be retried/observed separately.
      logTransactionDiagnostic(logger, { stage: "transaction-consume", reason: "cleanup-error", ...transactionContextWithId, ...safeDatabaseDiagnostic(error) });
    }
    if (lineConfig?.messaging.push) {
      logTransactionDiagnostic(logger, { stage: "line-summary", reason: "started", ...transactionContextWithId });
      try {
        await lineConfig.messaging.push(userId, createTransactionSummary(result.data));
        logTransactionDiagnostic(logger, { stage: "line-summary", reason: "summary-sent", ...transactionContextWithId });
      } catch (error) {
        logTransactionDiagnostic(logger, { stage: "line-summary", reason: "line-send-failed", ...transactionContextWithId, ...safeDatabaseDiagnostic(error) });
      }
    }
    return response.status(201).json({ saved: true, transaction });
  });

  return app;
}

function logPendingDiagnostic(logger: PendingSlipLogger, diagnostic: PendingSlipDiagnostic) {
  try {
    if (diagnostic.reason === "found" || diagnostic.reason === "not-found") logger.info?.("Pending slip GET diagnostic", diagnostic);
    else logger.error("Pending slip GET diagnostic", diagnostic);
  } catch { /* diagnostics are best effort */ }
}

function logTransactionDiagnostic(logger: PendingSlipLogger, diagnostic: TransactionDiagnostic) {
  try {
    const failureReasons = new Set(["database-error", "duplicate", "cleanup-error", "line-send-failed"]);
    if (failureReasons.has(diagnostic.reason)) logger.error("Transaction persistence diagnostic", diagnostic);
    else logger.info?.("Transaction persistence diagnostic", diagnostic);
  } catch { /* diagnostics are best effort */ }
}

function getRequestedDashboardBounds(query: Record<string, unknown>, now: Date) {
  const start = queryString(query.start);
  const end = queryString(query.end);
  if (!start && !end) return getBangkokMonthBounds(now);
  if (!start || !end) return null;
  return getBangkokDateRangeBounds(start, end);
}

function parseTransactionListOptions(query: Record<string, unknown>): TransactionListOptions | null {
  const page = parsePositiveInteger(queryString(query.page) ?? "1");
  const pageSize = parsePositiveInteger(queryString(query.page_size) ?? "10");
  if (!page || !pageSize || pageSize > 50) return null;
  const type = queryString(query.type);
  if (type && type !== "income" && type !== "expense") return null;
  const search = queryString(query.q);
  const category = queryString(query.category);
  const start = queryString(query.start);
  const end = queryString(query.end);
  const sort = queryString(query.sort);
  if (sort && sort !== "newest" && sort !== "oldest") return null;
  const range = start || end ? start && end ? getBangkokDateRangeBounds(start, end) : null : null;
  if ((start || end) && !range) return null;
  return {
    page, pageSize, ...(search ? { search: search.slice(0, 100) } : {}),
    ...(type ? { type: type as "income" | "expense" } : {}), ...(category ? { category: category.slice(0, 100) } : {}),
    ...(range ? { start: range.current.start, end: range.current.end } : {}),
    ...(sort ? { sort: sort as "newest" | "oldest" } : {}),
  };
}

function parsePositiveInteger(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function queryString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function publicTransaction(transaction: TransactionRecord) {
  const { slip_image_url: _slipImageUrl, ...safe } = transaction;
  return safe;
}

function createTransactionSummary(data: { type: string; amount: number; payee_payer: string; category: string; transaction_datetime: string }) {
  return {
    type: "flex",
    altText: `บันทึกรายการ ${data.amount} บาทเรียบร้อย`,
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", contents: [
        { type: "text", text: "บันทึกรายการสำเร็จ", weight: "bold", size: "lg" },
        { type: "text", text: `${data.type === "income" ? "รายรับ" : "รายจ่าย"} ${data.amount} บาท`, wrap: true },
        { type: "text", text: `${data.payee_payer} · ${data.category}`, wrap: true },
      ] },
    },
  };
}

function safeDatabaseDiagnostic(error: unknown) {
  const serialized = serializeSupabaseError(error);
  return {
    errorClass: errorClass(error),
    ...(serialized.supabaseCode ? { supabaseCode: serialized.supabaseCode } : {}),
    ...(serialized.httpStatus ? { httpStatus: serialized.httpStatus } : {}),
  };
}

function errorClass(error: unknown) {
  const name = error instanceof Error ? error.constructor.name : typeof error;
  return name.replace(/[^a-zA-Z0-9_$]/g, "?").slice(0, 64) || "UnknownError";
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

// Vercel detects src/app.ts as an Express entrypoint. Keep the app as a
// default export so the same module works in Vercel's Node.js runtime.
export default createApp();
