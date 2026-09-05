import { describe, expect, it } from "vitest";
import { createSupabasePersistence } from "../src/services/persistence.js";

describe("persistence wiring", () => {
  it("selects Supabase persistence only when both required env values exist", () => {
    expect(createSupabasePersistence({})).toBeNull();
    expect(createSupabasePersistence({
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-key",
    })).not.toBeNull();
  });
});
