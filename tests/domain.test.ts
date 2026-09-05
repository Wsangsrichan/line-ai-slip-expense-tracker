import { describe, expect, it } from "vitest";
import { extractionSchema, validateForSave } from "../src/domain/slip.js";

describe("slip domain", () => {
  it("accepts a valid extraction from a supported or unknown bank", () => {
    const result = extractionSchema.safeParse({
      type: "expense",
      amount: 250,
      payee_payer: "ร้านค้า",
      category: "อาหารและเครื่องดื่ม",
      transaction_datetime: "2026-09-05T10:30:00+07:00",
      bank: "Other Bank",
    });

    expect(result.success).toBe(true);
  });

  it("returns important field errors before save", () => {
    const result = validateForSave({
      type: "expense",
      amount: 0,
      payee_payer: "",
      category: "",
      transaction_datetime: "not-a-date",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "amount" }),
          expect.objectContaining({ field: "payee_payer" }),
          expect.objectContaining({ field: "category" }),
          expect.objectContaining({ field: "transaction_datetime" }),
        ]),
      );
    }
  });
});
