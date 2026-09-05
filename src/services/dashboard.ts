import { categories, normalizeCategory } from "../domain/slip.js";

export const DASHBOARD_TIMEZONE = "Asia/Bangkok";
const bangkokOffsetMs = 7 * 60 * 60 * 1000;

export interface DashboardTransaction {
  id: string;
  type: "income" | "expense" | "unknown" | string | null;
  direction?: "income" | "expense" | "unknown" | string | null;
  amount: number | string;
  category?: string | null;
  transaction_datetime: string;
}

export interface MonthBounds { start: Date; end: Date; label: string; }

function bangkokParts(date: Date) {
  const shifted = new Date(date.getTime() + bangkokOffsetMs);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

export function getBangkokMonthBounds(now: Date): { current: MonthBounds; previous: MonthBounds } {
  const { year, month } = bangkokParts(now);
  const currentStart = Date.UTC(year, month, 1) - bangkokOffsetMs;
  const previousStart = Date.UTC(year, month - 1, 1) - bangkokOffsetMs;
  const nextStart = Date.UTC(year, month + 1, 1) - bangkokOffsetMs;
  const label = `${year}-${String(month + 1).padStart(2, "0")}`;
  const previousLabel = month === 0 ? `${year - 1}-12` : `${year}-${String(month).padStart(2, "0")}`;
  return {
    current: { start: new Date(currentStart), end: new Date(nextStart), label },
    previous: { start: new Date(previousStart), end: new Date(currentStart), label: previousLabel },
  };
}

function directionOf(transaction: DashboardTransaction) {
  return transaction.direction ?? transaction.type;
}

function amountOf(transaction: DashboardTransaction) { return Number(transaction.amount); }

export function aggregateDashboard(transactions: DashboardTransaction[], now: Date) {
  const { current, previous } = getBangkokMonthBounds(now);
  const inPeriod = (transaction: DashboardTransaction, bounds: MonthBounds) => {
    const time = new Date(transaction.transaction_datetime).getTime();
    return time >= bounds.start.getTime() && time < bounds.end.getTime();
  };
  const isInDashboardRange = (transaction: DashboardTransaction) => {
    const time = new Date(transaction.transaction_datetime).getTime();
    // An invalid timestamp cannot prove that a row is outside the requested
    // range, so keep it visible as a partial-data warning.
    return Number.isNaN(time) || inPeriod(transaction, current) || inPeriod(transaction, previous);
  };
  const scopedTransactions = transactions.filter(isInDashboardRange);
  const valid = scopedTransactions.filter((transaction) => transaction.id && Number.isFinite(amountOf(transaction)) && amountOf(transaction) >= 0 && !Number.isNaN(new Date(transaction.transaction_datetime).getTime()));
  const partial = valid.length !== scopedTransactions.length;
  const rows = valid.filter((transaction) => inPeriod(transaction, current));
  const previousRows = valid.filter((transaction) => inPeriod(transaction, previous));
  const summarize = (items: DashboardTransaction[]) => {
    const summary = { income: 0, expense: 0, count: items.length };
    for (const item of items) {
      const amount = amountOf(item);
      if (directionOf(item) === "income") summary.income += amount;
      if (directionOf(item) === "expense") summary.expense += amount;
    }
    return { ...summary, net: summary.income - summary.expense };
  };
  const summary = summarize(rows);
  const previousSummary = summarize(previousRows);
  const daily = new Map<string, { income: number; expense: number }>();
  const byCategory = new Map<string, number>();
  for (const item of rows) {
    const direction = directionOf(item);
    const amount = amountOf(item);
    const shifted = new Date(new Date(item.transaction_datetime).getTime() + bangkokOffsetMs);
    const day = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
    const entry = daily.get(day) ?? { income: 0, expense: 0 };
    if (direction === "income") entry.income += amount;
    if (direction === "expense") {
      entry.expense += amount;
      const category = normalizeCategory(item.category ?? "อื่น ๆ");
      byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
    }
    daily.set(day, entry);
  }
  const changes = Object.fromEntries(["income", "expense", "net", "count"].map((key) => {
    const currentValue = summary[key as keyof typeof summary] as number;
    const previousValue = previousRows.length === 0 ? null : previousSummary[key as keyof typeof previousSummary] as number;
    return [key, { absolute: previousValue === null ? null : currentValue - previousValue, percentage: previousValue === null || previousValue === 0 ? null : ((currentValue - previousValue) / previousValue) * 100 }];
  }));
  return {
    period: { start: current.start.toISOString(), end: current.end.toISOString(), label: current.label },
    summary, comparison: { available: previousRows.length > 0, values: changes },
    daily: Array.from(daily, ([date, values]) => ({ date, ...values })).sort((a, b) => a.date.localeCompare(b.date)),
    categories: categories.map((category) => ({ category, amount: byCategory.get(category) ?? 0 })).filter((item) => item.amount > 0),
    isEmpty: rows.length === 0, partial,
  };
}
