import request from "supertest";
import { describe, expect, it } from "vitest";
import pendingHandler from "../api/slips/pending/[uploadId].js";

describe("Vercel pending slip route", () => {
  it("routes the dynamic upload ID path through the authenticated API", async () => {
    const response = await request(pendingHandler)
      .get("/api/slips/pending/upload-123?source=line");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "ต้องเข้าสู่ระบบ LINE ก่อนใช้งาน" });
  });
});
