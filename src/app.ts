import express from "express";
import multer from "multer";
import path from "node:path";
import { validateForSave } from "./domain/slip.js";
import { createExtractor, extractSlip } from "./services/extraction.js";
import { DummyIdentityVerifier, LineApiIdentityVerifier, getLineUserId } from "./services/identity.js";
import { validateImageUpload } from "./services/upload.js";
import { createSupabasePersistence, DummyPendingSlipStore, DummySlipStorage, DummyTransactionRepository, SignedPendingSlipStore, type PendingSlipStore, type SlipStorage, type TransactionRepository } from "./services/persistence.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export interface AppDependencies {
  transactionRepository?: TransactionRepository;
  storage?: SlipStorage;
  pendingSlips?: PendingSlipStore;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const supabase = createSupabasePersistence();
  const storage = dependencies.storage ?? supabase ?? new DummySlipStorage();
  const pendingSlips = dependencies.pendingSlips ?? supabase ?? (process.env.UPLOAD_SIGNING_KEY
    ? new SignedPendingSlipStore(process.env.UPLOAD_SIGNING_KEY)
    : process.env.VERCEL === "1" ? null : new DummyPendingSlipStore());
  const transactionRepository = dependencies.transactionRepository ?? supabase ?? new DummyTransactionRepository();
  // Real LINE verification is the safe default. Dummy identity is available
  // only when explicitly requested for local development and tests.
  const identityVerifier = process.env.LINE_AUTH_MODE === "dummy"
    ? new DummyIdentityVerifier()
    : new LineApiIdentityVerifier();
  const extractor = createExtractor();
  app.use(express.json({ limit: "100kb" }));
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

  app.post("/api/slips/extract", upload.single("slip"), async (request, response) => {
    const userId = await getLineUserId(identityVerifier, {
      token: request.headers.authorization,
      dummyUserId: request.headers["x-line-user-id"] as string | undefined,
    });
    if (!userId) return response.status(401).json({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
    if (!request.file) return response.status(400).json({ error: "กรุณาเลือกภาพสลิป" });

    const fileCheck = validateImageUpload(request.file.mimetype, request.file.size);
    if (!fileCheck.valid) return response.status(415).json({ error: fileCheck.message });

    const result = await extractSlip(extractor, request.file.buffer);
    if (!result.success) return response.status(422).json({ error: result.message });
    if (!pendingSlips) return response.status(503).json({ error: "ระบบยังไม่ได้ตั้งค่า durable upload storage" });
    try {
      const storageRef = await storage.put(userId, request.file.buffer, request.file.mimetype);
      const uploadId = await pendingSlips.createPending(userId, storageRef);
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
    const storageRef = await pendingSlips.consume(userId, request.body.upload_id);
    if (!storageRef) return response.status(404).json({ error: "ไม่พบภาพสลิปหรือภาพนี้ไม่ใช่ของผู้ใช้" });
    try {
      const transaction = await transactionRepository.create(userId, {
        ...result.data,
        slip_image_url: storageRef,
      });
      return response.status(201).json({ saved: true, transaction });
    } catch {
      return response.status(503).json({ error: "ไม่สามารถบันทึกรายการได้ กรุณาลองใหม่" });
    }
  });

  return app;
}

// Vercel detects src/app.ts as an Express entrypoint. Keep the app as a
// default export so the same module works in Vercel's Node.js runtime.
export default createApp();
