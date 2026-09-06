import type { SlipExtraction } from "../domain/slip.js";
import { extractionSchema } from "../domain/slip.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

export const DUPLICATE_SLIP_ERROR_CODE = "23505";
export const DUPLICATE_SLIP_ERROR_MESSAGE = "สลิปภาพนี้ถูกบันทึกไปแล้ว ไม่สามารถบันทึกซ้ำได้";

export interface SlipStorage {
  put(userId: string, image: Buffer, contentType: string): Promise<string>;
}

export interface TransactionRepository {
  create(userId: string, data: SlipExtraction & { slip_image_url: string; slip_content_sha256: string }): Promise<{ id: string }>;
  listForDashboard(userId: string, start: Date, end: Date, previousStart: Date): Promise<DashboardTransaction[]>;
}

import type { DashboardTransaction } from "./dashboard.js";

export interface PendingSlip {
  storageRef: string;
  contentHash: string;
  extraction?: SlipExtraction;
  extractionStatus?: "valid" | "missing" | "invalid";
}

export type PendingSlipDiagnosticReason = "found" | "not-found" | "missing-extraction" | "schema-invalid" | "database-error";

export interface PendingSlipDiagnostic {
  stage: "pending-get";
  reason: PendingSlipDiagnosticReason;
  hasExtraction: boolean;
  errorClass?: string;
  supabaseCode?: string;
  httpStatus?: number;
  errorMessage?: string;
  userFingerprint?: string;
  uploadFingerprint?: string;
}

export interface PendingSlipLogger {
  error(message: string, diagnostic: PendingSlipDiagnostic | TransactionDiagnostic): void;
}

export interface TransactionDiagnostic {
  stage: "transaction-create" | "transaction-consume";
  reason: "database-error" | "duplicate" | "cleanup-not-found" | "cleanup-error";
  errorClass?: string;
  supabaseCode?: string;
  httpStatus?: number;
}

export class PendingSlipDatabaseError extends Error {
  constructor() {
    super("Pending slip database operation failed");
    this.name = "PendingSlipDatabaseError";
  }
}

export interface PendingSlipMetadata {
  eventId?: string;
  messageId?: string;
  extraction?: SlipExtraction;
}

export interface PendingSlipStore {
  createPending(userId: string, storageRef: string, contentHash: string, metadata?: PendingSlipMetadata): Promise<string>;
  getPending(userId: string, uploadId: string): Promise<PendingSlip | null>;
  consume(userId: string, uploadId: string): Promise<PendingSlip | null>;
}

export interface WebhookEventStore {
  claim(eventId: string, userId: string, messageId: string): Promise<boolean>;
}

export class DummySlipStorage implements SlipStorage {
  async put(userId: string, _image: Buffer, _contentType: string) {
    return `dummy://slips/${encodeURIComponent(userId)}/pending`;
  }
}

export class DummyTransactionRepository implements TransactionRepository {
  private readonly savedHashes = new Set<string>();

  async create(userId: string, data: SlipExtraction & { slip_image_url: string; slip_content_sha256: string }) {
    const key = `${userId}\u0000${data.slip_content_sha256}`;
    if (this.savedHashes.has(key)) {
      const error = new Error(DUPLICATE_SLIP_ERROR_MESSAGE) as Error & { code: string };
      error.code = DUPLICATE_SLIP_ERROR_CODE;
      throw error;
    }
    this.savedHashes.add(key);
    return { id: "00000000-0000-4000-8000-000000000001" };
  }

  async listForDashboard(_userId: string, _start: Date, _end: Date, _previousStart: Date) { return [] as DashboardTransaction[]; }
}

export class DummyPendingSlipStore implements PendingSlipStore {
  private readonly pending = new Map<string, { userId: string; storageRef: string; contentHash: string; extraction?: SlipExtraction; expiresAt: number }>();
  constructor(private readonly ttlMs = 15 * 60 * 1000) {}

  async createPending(userId: string, storageRef: string, contentHash: string, _metadata?: PendingSlipMetadata) {
    const uploadId = crypto.randomUUID();
    this.pending.set(uploadId, { userId, storageRef, contentHash, extraction: _metadata?.extraction, expiresAt: Date.now() + this.ttlMs });
    return uploadId;
  }

  async getPending(userId: string, uploadId: string): Promise<PendingSlip | null> {
    const item = this.pending.get(uploadId);
    if (!item || item.userId !== userId || item.expiresAt <= Date.now()) return null;
    return { storageRef: item.storageRef, contentHash: item.contentHash, extraction: item.extraction };
  }

  async consume(userId: string, uploadId: string): Promise<PendingSlip | null> {
    const item = this.pending.get(uploadId);
    if (!item || item.userId !== userId || item.expiresAt <= Date.now()) return null;
    this.pending.delete(uploadId);
    return { storageRef: item.storageRef, contentHash: item.contentHash, extraction: item.extraction };
  }
}

export class DummyWebhookEventStore implements WebhookEventStore {
  private readonly eventIds = new Set<string>();
  async claim(eventId: string) {
    if (this.eventIds.has(eventId)) return false;
    this.eventIds.add(eventId);
    return true;
  }
}

export class SignedPendingSlipStore implements PendingSlipStore {
  private readonly consumed = new Set<string>();
  constructor(private readonly signingKey: string, private readonly ttlMs = 15 * 60 * 1000) {}

  async createPending(userId: string, storageRef: string, contentHash: string, metadata?: PendingSlipMetadata) {
    const payload = Buffer.from(JSON.stringify({
      userId,
      storageRef,
      contentHash,
      extraction: metadata?.extraction,
      expiresAt: Date.now() + this.ttlMs,
    })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  async getPending(userId: string, uploadId: string) {
    const data = this.parse(userId, uploadId);
    return data ? { storageRef: data.storageRef, contentHash: data.contentHash, extraction: data.extraction } : null;
  }

  async consume(userId: string, uploadId: string) {
    if (this.consumed.has(uploadId)) return null;
    const data = this.parse(userId, uploadId);
    if (!data) return null;
    this.consumed.add(uploadId);
    return { storageRef: data.storageRef, contentHash: data.contentHash, extraction: data.extraction };
  }

  private parse(userId: string, uploadId: string) {
    const [payload, signature] = uploadId.split(".");
    if (!payload || !signature || !this.isValidSignature(payload, signature)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        userId?: string; storageRef?: string; contentHash?: string; expiresAt?: number; extraction?: unknown;
      };
      const extraction = extractionSchema.safeParse(data.extraction);
      if (data.userId !== userId || !data.storageRef || !data.contentHash || !data.expiresAt || data.expiresAt <= Date.now()) return null;
      return { storageRef: data.storageRef, contentHash: data.contentHash, extraction: extraction.success ? extraction.data : undefined };
    } catch { return null; }
  }

  private sign(payload: string) {
    return createHmac("sha256", this.signingKey).update(payload).digest("base64url");
  }

  private isValidSignature(payload: string, signature: string) {
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

export class SupabasePersistence implements SlipStorage, TransactionRepository, PendingSlipStore {
  constructor(private readonly client: SupabaseClient, private readonly logger?: PendingSlipLogger) {}

  async put(userId: string, image: Buffer, contentType: string) {
    const path = `${userId}/${crypto.randomUUID()}`;
    const result = await this.client.storage.from("slips").upload(path, image, { contentType });
    if (result.error) throw result.error;
    return path;
  }

  async create(userId: string, data: SlipExtraction & { slip_image_url: string; slip_content_sha256: string }) {
    const result = await this.client.from("transactions").insert({
      line_user_id: userId,
      type: data.type,
      amount: data.amount,
      payee_payer: data.payee_payer,
      category: data.category,
      transaction_datetime: data.transaction_datetime,
      slip_image_url: data.slip_image_url,
      slip_content_sha256: data.slip_content_sha256,
    }).select("id").single();
    if (result.error) throw result.error;
    return result.data as { id: string };
  }

  async listForDashboard(userId: string, _start: Date, _end: Date, previousStart: Date) {
    const result = await this.client.from("transactions").select("id,type,amount,category,transaction_datetime")
      .eq("line_user_id", userId).gte("transaction_datetime", previousStart.toISOString()).lt("transaction_datetime", _end.toISOString());
    if (result.error) throw result.error;
    return (result.data ?? []) as DashboardTransaction[];
  }

  async createPending(userId: string, storageRef: string, contentHash: string, metadata?: PendingSlipMetadata) {
    const result = await this.client.from("pending_slips").insert({
      line_user_id: userId,
      storage_ref: storageRef,
      content_hash: contentHash,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      line_event_id: metadata?.eventId ?? null,
      line_message_id: metadata?.messageId ?? null,
      extraction: metadata?.extraction ?? null,
    }).select("id").single();
    if (result.error || !result.data || typeof result.data.id !== "string") throw new PendingSlipDatabaseError();
    return result.data.id;
  }

  async getPending(userId: string, uploadId: string) {
    const result = await this.client.from("pending_slips").select("storage_ref,content_hash,extraction")
      .eq("id", uploadId).eq("line_user_id", userId).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (result.error) {
      this.logPending({
        stage: "pending-get",
        reason: "database-error",
        hasExtraction: false,
        errorClass: errorClass(result.error),
        ...serializeSupabaseError(result.error),
      });
      throw new PendingSlipDatabaseError();
    }
    if (!result.data) {
      this.logPending({ stage: "pending-get", reason: "not-found", hasExtraction: false });
      return null;
    }
    const parsed = parseStoredExtraction(result.data.extraction);
    this.logPending({
      stage: "pending-get",
      reason: parsed.status === "valid" ? "found" : parsed.status === "missing" ? "missing-extraction" : "schema-invalid",
      hasExtraction: parsed.status === "valid",
    });
    return {
      storageRef: result.data.storage_ref as string,
      contentHash: result.data.content_hash as string,
      extraction: parsed.extraction,
      extractionStatus: parsed.status,
    };
  }

  async claim(eventId: string, userId: string, messageId: string) {
    const result = await this.client.from("webhook_events").insert({
      event_id: eventId, line_user_id: userId, line_message_id: messageId,
    }).select("event_id").single();
    if (!result.error) return true;
    if ((result.error as { code?: string }).code === DUPLICATE_SLIP_ERROR_CODE) return false;
    throw result.error;
  }

  async consume(userId: string, uploadId: string) {
    const result = await this.client.from("pending_slips").delete()
      .eq("id", uploadId).eq("line_user_id", userId).gt("expires_at", new Date().toISOString()).select("storage_ref,content_hash,extraction").single();
    if (result.error) {
      if ((result.error as { code?: string }).code === "PGRST116") return null;
      throw result.error;
    }
    if (!result.data) return null;
    const parsed = parseStoredExtraction(result.data.extraction);
    return {
      storageRef: result.data.storage_ref as string,
      contentHash: result.data.content_hash as string,
      extraction: parsed.extraction,
      extractionStatus: parsed.status,
    };
  }

  private logPending(diagnostic: PendingSlipDiagnostic) {
    try { this.logger?.error("Pending slip persistence diagnostic", diagnostic); } catch { /* diagnostics are best effort */ }
  }
}

function parseStoredExtraction(value: unknown): { extraction?: SlipExtraction; status: "valid" | "missing" | "invalid" } {
  if (value === null || value === undefined || value === "") return { status: "missing" };
  let candidate = value;
  if (typeof value === "string") {
    try { candidate = JSON.parse(value); } catch { return { status: "invalid" }; }
  }
  const parsed = extractionSchema.safeParse(candidate);
  return parsed.success ? { extraction: parsed.data, status: "valid" } : { status: "invalid" };
}

function errorClass(error: unknown) {
  const name = error instanceof Error ? error.constructor.name : typeof error;
  return name.replace(/[^a-zA-Z0-9_$]/g, "?").slice(0, 64) || "UnknownError";
}

export function serializeSupabaseError(error: unknown): {
  supabaseCode?: string;
  httpStatus?: number;
  errorMessage: string;
} {
  const candidate = isRecord(error) ? error : undefined;
  const code = candidate?.code;
  const status = candidate?.status ?? candidate?.statusCode ?? candidate?.status_code;
  const message = candidate?.message ?? (error instanceof Error ? error.message : undefined);
  const serialized: { supabaseCode?: string; httpStatus?: number; errorMessage: string } = {
    errorMessage: sanitizeErrorMessage(typeof message === "string" ? message : "Unknown database error"),
  };
  if (typeof code === "string" && code.trim()) serialized.supabaseCode = code.trim().slice(0, 64);
  const numericStatus = typeof status === "number" ? status : typeof status === "string" && /^\d{3}$/.test(status) ? Number(status) : undefined;
  if (numericStatus !== undefined) serialized.httpStatus = numericStatus;
  return serialized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeErrorMessage(message: string) {
  return message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[^\s"']+/gi, "[redacted-image-data]")
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, "[redacted-authorization]")
    .replace(/\b(password|passwd|token|secret|api[_-]?key|apikey|authorization|credential|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, "[redacted-data]")
    .trim()
    .slice(0, 256);
}

export function createSupabasePersistence(env: NodeJS.ProcessEnv = process.env, logger?: PendingSlipLogger) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return new SupabasePersistence(createClient(url, key), logger);
}
