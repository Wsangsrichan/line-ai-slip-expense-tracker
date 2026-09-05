import { describe, expect, it } from "vitest";
import { DummyExtractor, extractSlip } from "../src/services/extraction.js";

describe("slip extraction", () => {
  it("normalizes a dummy AI response into the save schema", async () => {
    const result = await extractSlip(new DummyExtractor(), Buffer.from("image"));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(250);
      expect(result.data.type).toBe("expense");
    }
  });

  it("does not expose provider errors as secrets", async () => {
    const result = await extractSlip(
      { extract: async () => ({ type: "expense", amount: -1 }) },
      Buffer.from("image"),
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toContain("ตรวจสอบ");
  });
});
