import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import pendingHandler from "../api/slips/pending/[uploadId].js";
import { createVercelHandler } from "../src/vercel-handler.js";

describe("Vercel pending slip route", () => {
  it("routes the dynamic upload ID path through the authenticated API", async () => {
    const response = await request(pendingHandler)
      .get("/api/slips/pending/upload-123?source=line");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
  });

  it.each([
    ["full pathname", (uploadId: string) => `/api/slips/pending/${uploadId}`],
    ["function-relative pathname", (uploadId: string) => `/${uploadId}`],
  ])("forwards the real UUID from a %s", async (_shape, pathFor) => {
    const uploadId = "550e8400-e29b-41d4-a716-446655440000";
    const getPending = vi.fn().mockResolvedValue({
      storageRef: "dummy://slips/user-a/image",
      contentHash: "hash-a",
      extraction: { amount: 42 },
    });
    const handler = createVercelHandler("/api/slips/pending/:uploadId", {
      pendingSlips: { getPending, createPending: vi.fn(), consume: vi.fn() },
    } as never);

    const response = await request(handler)
      .get(`${pathFor(uploadId)}?source=line`)
      .set("x-line-user-id", "user-a");

    expect(response.status).toBe(200);
    expect(getPending).toHaveBeenCalledWith("user-a", uploadId);
    expect(getPending).not.toHaveBeenCalledWith("user-a", ":uploadId");
  });
});
