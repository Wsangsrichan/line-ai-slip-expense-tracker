import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

describe("upload status UI contract", () => {
  it("declares every user-visible upload and save state", () => {
    for (const state of ["idle", "uploading", "processing", "success", "error"]) {
      expect(page).toContain(`data-state=\"${state}\"`);
    }
    expect(page).toContain("กำลังอัปโหลดภาพสลิป");
    expect(page).toContain("กำลังอ่านข้อมูลด้วย AI");
    expect(page).toContain("บันทึกข้อมูลสำเร็จ");
    expect(page).toContain("ลองใหม่");
  });

  it("guards requests against double submit and recovers in finally", () => {
    expect(page).toContain("uploadInFlight");
    expect(page).toContain("saveInFlight");
    expect(page).toContain("finally");
    expect(page).toContain("เครือข่าย");
    expect(page).toContain("response.ok");
  });

  it("waits for LIFF auth before upload or save requests", () => {
    expect(page).toContain('type="file" accept="image/jpeg,image/png,image/webp" disabled');
    expect(page).toContain("const authReady = new Promise");
    expect(page).toContain("await requireAuth()");
    expect(page).toContain("finishAuth('authenticated')");
    expect(page).toContain("window.liff.login()");
    expect(page).not.toContain("x-line-user-id");

    const uploadGuard = page.indexOf("const token = await requireAuth();");
    const uploadRequest = page.indexOf("fetch('/api/slips/extract'");
    expect(uploadGuard).toBeGreaterThanOrEqual(0);
    expect(uploadGuard).toBeLessThan(uploadRequest);
  });

  it("refreshes login state and access token immediately before API calls", () => {
    expect(page).toContain("const getFreshAccessToken = async () =>");
    expect(page).toContain("if (!window.liff || !window.liff.isLoggedIn()) return null");
    expect(page).toContain("const token = window.liff.getAccessToken();");
    expect(page).toContain("authorization: `Bearer ${token}`");
    expect(page).toContain("await getFreshAccessToken()");
    expect(page).toContain("response.status === 401");
    expect(page).toContain("เซสชัน LINE หมดอายุ");
    expect(page).not.toContain("authorization: `Bearer ${lineAccessToken}`");
  });
});
