import { describe, expect, it } from "vitest";
import { parseExportOptions, serializeTransactionsCsv, serializeTransactionsXlsx } from "../src/services/export.js";

const rows = [{
  id: "transaction-1",
  type: "expense" as const,
  amount: 1250.5,
  payee_payer: "ร้านค้า, สาขา 1",
  category: "อาหาร",
  transaction_datetime: "2026-09-05T10:30:00+07:00",
  slip_image_url: "user-a/private/slip.png",
  created_at: "2026-09-05T10:31:00+07:00",
}];

describe("transaction export", () => {
  it("normalizes the same filters as history and bounds export pages", () => {
    const options = parseExportOptions({
      format: "csv", q: "ร้านค้า", type: "expense", category: "อาหาร",
      start: "2026-09-01", end: "2026-09-30", sort: "oldest",
    });

    expect(options).toMatchObject({ format: "csv", options: {
      page: 1, pageSize: 10_000, search: "ร้านค้า", type: "expense", category: "อาหาร", sort: "oldest",
    } });
    expect(options?.options.start?.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(options?.options.end?.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(parseExportOptions({ format: "pdf" })).toBeNull();
    expect(parseExportOptions({ format: "csv", start: "2026-09-30" })).toBeNull();
  });

  it("serializes CSV as UTF-8 BOM with escaped cells and no private fields", () => {
    const csv = serializeTransactionsCsv(rows);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"ร้านค้า, สาขา 1"');
    expect(csv).toContain("1250.5");
    expect(csv).not.toContain("transaction-1");
    expect(csv).not.toContain("private/slip.png");
  });

  it("creates a real XLSX zip payload with the public export columns", async () => {
    const xlsx = await serializeTransactionsXlsx(rows);

    expect(Buffer.isBuffer(xlsx)).toBe(true);
    expect(xlsx.subarray(0, 4).toString()).toBe("PK\x03\x04");
    expect(xlsx.toString("utf8")).not.toContain("private/slip.png");
  });
});
