import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabasePersistence } from "../src/services/persistence.js";

describe("persistence wiring", () => {
  it("selects Supabase persistence only when both required env values exist", () => {
    expect(createSupabasePersistence({})).toBeNull();
    expect(createSupabasePersistence({
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-key",
    })).not.toBeNull();
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
      direction: "expense",
    });
  });

  it("stores pending slip metadata and claims webhook events durably", async () => {
    const pendingSingle = vi.fn().mockResolvedValue({ data: { id: "pending-id" }, error: null });
    const eventSingle = vi.fn().mockResolvedValue({ data: { event_id: "event-id" }, error: null });
    const client = {
      from: vi.fn((table: string) => table === "pending_slips"
        ? { insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: pendingSingle }) }) }
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
  });
});
