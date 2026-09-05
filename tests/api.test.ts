import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

afterEach(() => {
  delete process.env.LINE_AUTH_MODE;
  delete process.env.VERCEL;
});

describe("Capture-to-Verify API", () => {
  it("serves the LIFF app at the root path", async () => {
    const response = await request(createApp()).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("ตรวจสอบข้อมูลสลิป");
  });

  it("accepts the path shape used by a Vercel catch-all function", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("returns validated extraction for an authenticated image upload", async () => {
    const response = await request(createApp()).post("/api/slips/extract")
      .set("x-line-user-id", "dummy-user")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");

    expect(response.status).toBe(200);
    expect(response.body.data.amount).toBe(250);
    expect(response.body.data.bank).toBe("Other Bank");
    expect(response.body.upload_id).toEqual(expect.any(String));
  });

  it("rejects an upload without LINE identity", async () => {
    const response = await request(createApp()).post("/api/slips/extract")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");

    expect(response.status).toBe(401);
  });

  it("does not allow the demo identity header to bypass real LINE mode", async () => {
    process.env.LINE_AUTH_MODE = "real";
    const response = await request(createApp()).get("/api/health")
      .set("x-line-user-id", "replace-with-local-dummy-user-id");

    expect(response.status).toBe(200);
    const protectedResponse = await request(createApp()).post("/api/slips/extract")
      .set("x-line-user-id", "replace-with-local-dummy-user-id")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");
    expect(protectedResponse.status).toBe(401);
  });

  it("fails closed in Vercel when no durable receipt configuration exists", async () => {
    process.env.VERCEL = "1";
    const response = await request(createApp()).post("/api/slips/extract")
      .set("x-line-user-id", "dummy-user")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");

    expect(response.status).toBe(503);
    delete process.env.VERCEL;
  });

  it("blocks save when required fields are missing", async () => {
    const response = await request(createApp()).post("/api/transactions/validate")
      .set("x-line-user-id", "dummy-user")
      .send({ amount: 0, type: "expense", payee_payer: "", category: "" });

    expect(response.status).toBe(422);
    expect(response.body.errors.map((error: { field: string }) => error.field)).toEqual(
      expect.arrayContaining(["amount", "payee_payer", "category", "transaction_datetime"]),
    );
  });

  it("saves only an upload stored by the server, never an arbitrary image URL", async () => {
    const app = createApp();
    const upload = await request(app).post("/api/slips/extract")
      .set("x-line-user-id", "dummy-user")
      .attach("slip", Buffer.from("fake image"), "slip.jpg");
    const data = { ...upload.body.data, upload_id: upload.body.upload_id };
    const saved = await request(app).post("/api/transactions")
      .set("x-line-user-id", "dummy-user").send(data);
    expect(saved.status).toBe(201);

    const arbitrary = await request(createApp()).post("/api/transactions")
      .set("x-line-user-id", "dummy-user")
      .send({ ...data, upload_id: undefined, slip_image_url: "https://attacker.example/slip.jpg" });
    expect(arbitrary.status).toBe(422);

    const foreignUpload = await request(createApp()).post("/api/transactions")
      .set("x-line-user-id", "dummy-user").send(data);
    expect(foreignUpload.status).toBe(404);
  });
});
