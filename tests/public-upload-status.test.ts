import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

describe("upload status UI contract", () => {
  it("declares every user-visible upload and save state", () => {
    for (const state of ["idle", "uploading", "processing", "success", "error"]) {
      expect(page).toContain(`data-state=\"${state}\"`);
    }
    expect(page).toContain("กำลังอัปโหลดสลิป");
    expect(page).toContain("กำลังอ่านข้อมูลสลิป");
    expect(page).toContain("บันทึกเรียบร้อย");
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

  it("refreshes the dashboard after saving a transaction", () => {
    const saveSuccess = page.indexOf("setStatus('success', 'บันทึกเรียบร้อย'");
    const dashboardRefresh = page.indexOf("await loadDashboard();", saveSuccess);

    expect(saveSuccess).toBeGreaterThanOrEqual(0);
    expect(dashboardRefresh).toBeGreaterThan(saveSuccess);
  });

  it("makes the first-time workflow and dashboard boundaries explicit", () => {
    expect(page).toContain('aria-label="ขั้นตอนการบันทึกรายการ"');
    expect(page).toContain("เลือกรูปสลิปเพื่อเริ่มต้น");
    expect(page).toContain("รองรับไฟล์ JPG, PNG และ WEBP");
    expect(page).toContain('aria-labelledby="workflow-title"');
    expect(page).toContain('aria-labelledby="dashboard-title"');
    expect(page).toContain("Dashboard ประจำเดือน");
    expect(page).toContain("@media (max-width: 480px)");
    expect(page).toContain("เริ่มรายการใหม่");
  });

  it("shows the dashboard warning only for an explicit partial-data flag", () => {
    expect(page).toContain("$('dashboard-warning').hidden = data.partial !== true;");
  });

  it("keeps native hidden elements hidden over component display rules", () => {
    expect(page).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
    expect(page).toContain('id="dashboard-loading" class="loading-skeletons"');
    expect(page).toContain('id="dashboard-warning" class="status warning" role="alert" hidden');
  });
});
