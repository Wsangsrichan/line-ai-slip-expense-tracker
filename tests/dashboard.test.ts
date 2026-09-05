import { describe, expect, it } from "vitest";
import { aggregateDashboard, getBangkokMonthBounds } from "../src/services/dashboard.js";

const row = (id: string, type: string, amount: number, at: string, category = "อาหาร") => ({ id, type, amount, category, transaction_datetime: at });

describe("dashboard aggregation", () => {
  it("uses Bangkok local month boundaries and separates unknown direction", () => {
    const now = new Date("2026-09-01T00:00:00+07:00");
    const result = aggregateDashboard([
      row("before", "expense", 99, "2026-08-31T16:59:59Z"),
      row("start", "income", 100, "2026-08-31T17:00:00Z"),
      row("unknown", "unknown", 50, "2026-09-15T00:00:00+07:00"),
      row("end", "expense", 40, "2026-09-30T16:59:59Z"),
    ], now);
    expect(result.summary).toEqual({ income: 100, expense: 40, net: 60, count: 3 });
    expect(result.partial).toBe(false);
    expect(result.daily).toEqual([{ date: "2026-09-01", income: 100, expense: 0 }, { date: "2026-09-15", income: 0, expense: 0 }, { date: "2026-09-30", income: 0, expense: 40 }]);
    expect(getBangkokMonthBounds(now).current.end.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("normalizes fallback categories and retains user category values", () => {
    const result = aggregateDashboard([
      row("a", "expense", 20, "2026-09-05T01:00:00Z", "อาหารและเครื่องดื่ม"),
      row("b", "expense", 30, "2026-09-05T02:00:00Z", "สุขภาพ"),
      row("c", "expense", 40, "2026-09-05T03:00:00Z", "ร้านเฉพาะทาง"),
    ], new Date("2026-09-10T00:00:00+07:00"));
    expect(result.categories).toEqual(expect.arrayContaining([
      { category: "อาหาร", amount: 20 }, { category: "สุขภาพ", amount: 30 }, { category: "อื่น ๆ", amount: 40 },
    ]));
  });

  it("does not invent comparison percentages", () => {
    const noPrevious = aggregateDashboard([row("a", "income", 10, "2026-09-05T00:00:00+07:00")], new Date("2026-09-10T00:00:00+07:00"));
    expect(noPrevious.comparison.values.income).toEqual({ absolute: null, percentage: null });
    const zeroPrevious = aggregateDashboard([row("p", "expense", 10, "2026-08-05T00:00:00+07:00"), row("a", "income", 10, "2026-09-05T00:00:00+07:00")], new Date("2026-09-10T00:00:00+07:00"));
    expect(zeroPrevious.comparison.values.income).toEqual({ absolute: 10, percentage: null });
  });

  it("marks malformed rows partial instead of producing totals", () => {
    const result = aggregateDashboard([row("ok", "expense", 10, "2026-09-05T00:00:00+07:00"), { ...row("bad", "expense", 20, "bad"), id: "bad" }], new Date("2026-09-10T00:00:00+07:00"));
    expect(result.partial).toBe(true);
    expect(result.summary.expense).toBe(10);
  });
});
