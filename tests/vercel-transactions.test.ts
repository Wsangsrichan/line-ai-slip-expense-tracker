import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import transactionHandler from "../api/transactions/[id].js";
import { createVercelHandler } from "../src/vercel-handler.js";

afterEach(() => {
  process.env.LINE_AUTH_MODE = "dummy";
});

describe("Vercel transaction detail route", () => {
  it("exposes the deployed dynamic handler", async () => {
    const response = await request(transactionHandler).get("/api/transactions/transaction-123");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
  });

  it.each([
    ["full pathname", (id: string) => `/api/transactions/${id}`],
    ["function-relative pathname", (id: string) => `/${id}`],
  ])("forwards the transaction ID from a %s", async (_shape, pathFor) => {
    const transactionId = "transaction-123";
    const getTransaction = vi.fn().mockResolvedValue({
      id: transactionId, type: "expense", amount: 42, payee_payer: "ร้านค้า", category: "อาหาร",
      transaction_datetime: "2026-09-05T10:30:00+07:00", slip_image_url: "private/user-a/slip",
    });
    const handler = createVercelHandler("/api/transactions/:id", {
      transactionRepository: { create: vi.fn(), listForDashboard: vi.fn(), getTransaction },
      storage: { put: vi.fn(), createSignedUrl: vi.fn().mockResolvedValue("https://signed.example/slip") },
    } as never);

    const response = await request(handler)
      .get(pathFor(transactionId))
      .set("x-line-user-id", "user-a");

    expect(response.status).toBe(200);
    expect(getTransaction).toHaveBeenCalledWith("user-a", transactionId);
    expect(getTransaction).not.toHaveBeenCalledWith("user-a", ":id");
  });
});
