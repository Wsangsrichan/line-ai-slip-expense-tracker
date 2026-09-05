import type { SlipExtraction } from "../domain/slip.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SlipStorage {
  put(userId: string, image: Buffer, contentType: string): Promise<string>;
}

export interface TransactionRepository {
  create(userId: string, data: SlipExtraction & { slip_image_url: string }): Promise<{ id: string }>;
}

export interface PendingSlipStore {
  createPending(userId: string, storageRef: string): Promise<string>;
  consume(userId: string, uploadId: string): Promise<string | null>;
}

export class DummySlipStorage implements SlipStorage {
  async put(userId: string, _image: Buffer, _contentType: string) {
    return `dummy://slips/${encodeURIComponent(userId)}/pending`;
  }
}

export class DummyTransactionRepository implements TransactionRepository {
  async create(_userId: string, _data: SlipExtraction & { slip_image_url: string }) {
    return { id: "00000000-0000-4000-8000-000000000001" };
  }
}

export class DummyPendingSlipStore implements PendingSlipStore {
  private readonly pending = new Map<string, { userId: string; storageRef: string }>();

  async createPending(userId: string, storageRef: string) {
    const uploadId = crypto.randomUUID();
    this.pending.set(uploadId, { userId, storageRef });
    return uploadId;
  }

  async consume(userId: string, uploadId: string) {
    const item = this.pending.get(uploadId);
    if (!item || item.userId !== userId) return null;
    this.pending.delete(uploadId);
    return item.storageRef;
  }
}

export class SignedPendingSlipStore implements PendingSlipStore {
  constructor(private readonly signingKey: string, private readonly ttlMs = 15 * 60 * 1000) {}

  async createPending(userId: string, storageRef: string) {
    const payload = Buffer.from(JSON.stringify({
      userId,
      storageRef,
      expiresAt: Date.now() + this.ttlMs,
    })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  async consume(userId: string, uploadId: string) {
    const [payload, signature] = uploadId.split(".");
    if (!payload || !signature || !this.isValidSignature(payload, signature)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        userId?: string; storageRef?: string; expiresAt?: number;
      };
      if (data.userId !== userId || !data.storageRef || !data.expiresAt || data.expiresAt < Date.now()) return null;
      return data.storageRef;
    } catch {
      return null;
    }
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
  constructor(private readonly client: SupabaseClient) {}

  async put(userId: string, image: Buffer, contentType: string) {
    const path = `${userId}/${crypto.randomUUID()}`;
    const result = await this.client.storage.from("slips").upload(path, image, { contentType });
    if (result.error) throw result.error;
    return path;
  }

  async create(userId: string, data: SlipExtraction & { slip_image_url: string }) {
    const result = await this.client.from("transactions").insert({
      line_user_id: userId,
      type: data.type,
      amount: data.amount,
      payee_payer: data.payee_payer,
      category: data.category,
      transaction_datetime: data.transaction_datetime,
      slip_image_url: data.slip_image_url,
    }).select("id").single();
    if (result.error) throw result.error;
    return result.data as { id: string };
  }

  async createPending(userId: string, storageRef: string) {
    const result = await this.client.from("pending_slips").insert({
      line_user_id: userId,
      storage_ref: storageRef,
    }).select("id").single();
    if (result.error) throw result.error;
    return result.data.id as string;
  }

  async consume(userId: string, uploadId: string) {
    const result = await this.client.from("pending_slips").delete()
      .eq("id", uploadId).eq("line_user_id", userId).select("storage_ref").single();
    if (result.error) return null;
    return result.data.storage_ref as string;
  }
}

export function createSupabasePersistence(env: NodeJS.ProcessEnv = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return new SupabasePersistence(createClient(url, key));
}
