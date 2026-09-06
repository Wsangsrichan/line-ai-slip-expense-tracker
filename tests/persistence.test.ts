import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabasePersistence, DummyPendingSlipStore, serializeSupabaseError, SignedPendingSlipStore } from "../src/services/persistence.js";

describe("persistence wiring", () => {
  it("previews pending extraction without consuming and consumes only once", async () => {
    const store = new DummyPendingSlipStore();
    const id = await store.createPending("user-a", "slip", "hash", { extraction: { type: "expense", amount: 1, payee_payer: "ร้านค้า", category: "อาหาร", transaction_datetime: "2026-09-05T10:30:00+07:00" } });
    expect((await store.getPending("user-a", id))?.extraction?.amount).toBe(1);
    expect(await store.consume("user-a", id)).toEqual(expect.objectContaining({ storageRef: "slip", contentHash: "hash", extraction: expect.objectContaining({ amount: 1 }) }));
    expect(await store.consume("user-a", id)).toBeNull();
  });

  it("rejects tampered signed IDs and consumes valid IDs once", async () => {
    const store = new SignedPendingSlipStore("test-key");
    const id = await store.createPending("user-a", "slip", "hash");
    expect(await store.getPending("user-a", `${id}tampered`)).toBeNull();
    expect(await store.consume("user-a", id)).toEqual({ storageRef: "slip", contentHash: "hash" });
    expect(await store.consume("user-a", id)).toBeNull();
  });
  it("selects Supabase persistence only when both required env values exist", () => {
    expect(createSupabasePersistence({})).toBeNull();
    expect(createSupabasePersistence({
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-key",
    })).not.toBeNull();
  });

  it("returns extraction when Supabase returns JSON text for a jsonb column", async () => {
    const pendingSingle = vi.fn().mockResolvedValue({
      data: {
        storage_ref: "user-a/slip",
        content_hash: "hash",
        extraction: JSON.stringify({
          type: "expense", amount: 12.5, payee_payer: "ร้านค้า", category: "อาหาร",
          transaction_datetime: "2026-09-05T10:30:00+07:00",
        }),
      },
      error: null,
    });
    const client = { from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnValue({ maybeSingle: pendingSingle }),
      }),
    }) } as unknown as SupabaseClient;
    const { SupabasePersistence } = await import("../src/services/persistence.js");

    await expect(new SupabasePersistence(client).getPending("user-a", "pending-id")).resolves.toMatchObject({
      storageRef: "user-a/slip",
      contentHash: "hash",
      extraction: expect.objectContaining({ amount: 12.5 }),
    });
  });

  it("marks absent and invalid stored extraction separately", async () => {
    const logger = { error: vi.fn() };
    const responses = [
      { data: { storage_ref: "slip", content_hash: "hash", extraction: null }, error: null },
      { data: { storage_ref: "slip", content_hash: "hash", extraction: { amount: "invalid" } }, error: null },
    ];
    const client = { from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(responses.shift())) }),
      }),
    }) } as unknown as SupabaseClient;
    const { SupabasePersistence } = await import("../src/services/persistence.js");
    const store = new SupabasePersistence(client, logger);

    expect((await store.getPending("user-a", "pending-id"))?.extractionStatus).toBe("missing");
    expect((await store.getPending("user-a", "pending-id"))?.extractionStatus).toBe("invalid");
    expect(logger.error).toHaveBeenNthCalledWith(1, "Pending slip persistence diagnostic", { stage: "pending-get", reason: "missing-extraction", hasExtraction: false });
    expect(logger.error).toHaveBeenNthCalledWith(2, "Pending slip persistence diagnostic", { stage: "pending-get", reason: "schema-invalid", hasExtraction: false });
  });

  it("converts Supabase query errors into a safe database error", async () => {
    const logger = { error: vi.fn() };
    const client = { from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: {
          code: "42P01",
          status: 500,
          message: "relation missing password=secret https://project.supabase.co/rest/v1/pending_slips?apikey=service-secret data:image/png;base64,iVBORw0KGgo=",
        } }) }),
      }),
    }) } as unknown as SupabaseClient;
    const { SupabasePersistence, PendingSlipDatabaseError } = await import("../src/services/persistence.js");

    await expect(new SupabasePersistence(client, logger).getPending("user-a", "pending-id")).rejects.toBeInstanceOf(PendingSlipDatabaseError);
    expect(logger.error).toHaveBeenCalledWith("Pending slip persistence diagnostic", {
      stage: "pending-get", reason: "database-error", hasExtraction: false,
      errorClass: "object", supabaseCode: "42P01", httpStatus: 500,
      errorMessage: expect.stringContaining("relation missing"),
    });
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain("password=secret");
    expect(logged).not.toContain("https://project.supabase.co");
    expect(logged).not.toContain("service-secret");
    expect(logged).not.toContain("iVBORw0KGgo=");
  });

  it("serializes status variants and bounds diagnostic messages", () => {
    const serialized = serializeSupabaseError({
      code: "PGRST116",
      statusCode: "502",
      message: `Bearer very-secret-token password=super-secret https://example.test/${"a".repeat(400)}`,
    });

    expect(serialized.supabaseCode).toBe("PGRST116");
    expect(serialized.httpStatus).toBe(502);
    expect(serialized.errorMessage).toContain("[redacted-authorization]");
    expect(serialized.errorMessage).toContain("password=[redacted]");
    expect(serialized.errorMessage).not.toContain("very-secret-token");
    expect(serialized.errorMessage).not.toContain("https://example.test");
    expect(serialized.errorMessage.length).toBeLessThanOrEqual(256);
  });

  it("maps only transaction table columns and ignores extraction metadata such as bank", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "transaction-id" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const client = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient;
    const persistence = createSupabasePersistence({
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-key",
    });

    // Use the same public persistence mapping with a mocked Supabase client.
    const { SupabasePersistence } = await import("../src/services/persistence.js");
    await new SupabasePersistence(client).create("user-a", {
      type: "expense",
      amount: 250,
      payee_payer: "ร้านค้าตัวอย่าง",
      category: "อาหาร",
      transaction_datetime: "2026-09-05T10:30:00+07:00",
      slip_image_url: "user-a/slip-id",
      slip_content_sha256: "hash-a",
      bank: "SCB",
    });

    expect(persistence).not.toBeNull();
    expect(insert).toHaveBeenCalledWith({
      line_user_id: "user-a",
      type: "expense",
      amount: 250,
      payee_payer: "ร้านค้าตัวอย่าง",
      category: "อาหาร",
      transaction_datetime: "2026-09-05T10:30:00+07:00",
      slip_image_url: "user-a/slip-id",
      slip_content_sha256: "hash-a",
    });
  });

  it("does not select the optional direction column for dashboard reads", async () => {
    const query = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const select = vi.fn().mockReturnValue(query);
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient;
    const { SupabasePersistence } = await import("../src/services/persistence.js");

    await new SupabasePersistence(client).listForDashboard(
      "user-a",
      new Date("2026-09-01T00:00:00+07:00"),
      new Date("2026-10-01T00:00:00+07:00"),
      new Date("2026-08-01T00:00:00+07:00"),
    );

    expect(select).toHaveBeenCalledWith("id,type,amount,category,transaction_datetime");
  });

  it("stores pending slip metadata and claims webhook events durably", async () => {
    const pendingSingle = vi.fn().mockResolvedValue({ data: { id: "pending-id" }, error: null });
    const eventSingle = vi.fn().mockResolvedValue({ data: { event_id: "event-id" }, error: null });
    const pendingInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: pendingSingle }) });
    const client = {
      from: vi.fn((table: string) => table === "pending_slips"
        ? { insert: pendingInsert }
        : { insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: eventSingle }) }) }),
    } as unknown as SupabaseClient;
    const { SupabasePersistence } = await import("../src/services/persistence.js");
    const persistence = new SupabasePersistence(client);

    await persistence.createPending("user-a", "user-a/slip", "hash", {
      eventId: "event-id", messageId: "message-id", extraction: {
        type: "expense", amount: 100, payee_payer: "ร้านค้า", category: "อาหาร",
        transaction_datetime: "2026-09-05T10:30:00+07:00", bank: "Other Bank",
      },
    });
    await persistence.claim("event-id", "user-a", "message-id");

    expect(client.from).toHaveBeenCalledWith("pending_slips");
    expect(client.from).toHaveBeenCalledWith("webhook_events");
    expect(pendingInsert).toHaveBeenCalledWith(expect.objectContaining({
      line_user_id: "user-a", storage_ref: "user-a/slip", content_hash: "hash",
      extraction: expect.objectContaining({ amount: 100, payee_payer: "ร้านค้า" }),
    }));
  });
});
