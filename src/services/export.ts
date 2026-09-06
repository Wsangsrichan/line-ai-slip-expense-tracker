import * as XLSX from "xlsx";
import { getBangkokDateRangeBounds } from "./dashboard.js";
import type { TransactionListOptions, TransactionRecord } from "./persistence.js";

export const EXPORT_ROW_LIMIT = 10_000;

export type ExportFormat = "csv" | "xlsx";

export interface ExportOptions {
  format: ExportFormat;
  options: TransactionListOptions;
}

export type ExportRow = Pick<TransactionRecord, "type" | "amount" | "payee_payer" | "category" | "transaction_datetime">;

export function parseTransactionListOptions(query: Record<string, unknown>): TransactionListOptions | null {
  const page = parsePositiveInteger(queryString(query.page) ?? "1");
  const pageSize = parsePositiveInteger(queryString(query.page_size) ?? "10");
  if (!page || !pageSize || pageSize > 50) return null;
  const filters = parseTransactionFilters(query);
  return filters ? { page, pageSize, ...filters } : null;
}

export function parseExportOptions(query: Record<string, unknown>): ExportOptions | null {
  const format = queryString(query.format);
  if (format !== "csv" && format !== "xlsx") return null;
  const filters = parseTransactionFilters(query);
  if (!filters) return null;
  return { format, options: { page: 1, pageSize: EXPORT_ROW_LIMIT, ...filters } };
}

export function serializeTransactionsCsv(records: TransactionRecord[]): string {
  const rows = records.map(toExportRow);
  const lines = [
    ["วันที่", "ประเภท", "จำนวนเงิน", "ผู้รับ/ผู้โอน", "หมวดหมู่"],
    ...rows.map((row) => [
      row.transaction_datetime,
      row.type === "income" ? "รายรับ" : "รายจ่าย",
      String(row.amount),
      row.payee_payer,
      row.category,
    ]),
  ].map((row) => row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function serializeTransactionsXlsx(records: TransactionRecord[]): Promise<Buffer> {
  const rows = records.map(toExportRow);
  const data = [
    ["วันที่", "ประเภท", "จำนวนเงิน", "ผู้รับ/ผู้โอน", "หมวดหมู่"],
    ...rows.map((row) => [
      row.transaction_datetime,
      row.type === "income" ? "รายรับ" : "รายจ่าย",
      row.amount,
      row.payee_payer,
      row.category,
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "รายการ");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function parseTransactionFilters(query: Record<string, unknown>): Omit<TransactionListOptions, "page" | "pageSize"> | null {
  const type = queryString(query.type);
  if (type && type !== "income" && type !== "expense") return null;
  const search = queryString(query.q);
  const category = queryString(query.category);
  const start = queryString(query.start);
  const end = queryString(query.end);
  const sort = queryString(query.sort);
  if (sort && sort !== "newest" && sort !== "oldest") return null;
  const range = start || end ? start && end ? getBangkokDateRangeBounds(start, end) : null : null;
  if ((start || end) && !range) return null;
  return {
    ...(search ? { search: search.slice(0, 100) } : {}),
    ...(type ? { type: type as "income" | "expense" } : {}),
    ...(category ? { category: category.slice(0, 100) } : {}),
    ...(range ? { start: range.current.start, end: range.current.end } : {}),
    ...(sort ? { sort: sort as "newest" | "oldest" } : {}),
  };
}

function toExportRow(record: TransactionRecord): ExportRow {
  return {
    type: record.type,
    amount: record.amount,
    payee_payer: record.payee_payer,
    category: record.category,
    transaction_datetime: record.transaction_datetime,
  };
}

function csvCell(value: string | null | undefined) {
  value = value ?? "";
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function queryString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function parsePositiveInteger(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
