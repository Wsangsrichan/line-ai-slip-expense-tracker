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
    expect(page).toContain("บันทึกรายการสำเร็จ");
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

  it("shows and enables Save after a pending response contains validated data", () => {
    const pendingLoad = page.indexOf("const populatePendingSlip");
    const dataLoad = page.indexOf("const data = payload.data", pendingLoad);
    const revealForm = page.indexOf("$('verify').hidden = false", dataLoad);
    const syncSave = page.indexOf("syncSave();", revealForm);

    expect(pendingLoad).toBeGreaterThanOrEqual(0);
    expect(page).toContain("if (!response.ok || !payload.data)");
    expect(page).toContain("$('save').disabled = saveInFlight || required.some");
    expect(revealForm).toBeGreaterThan(dataLoad);
    expect(syncSave).toBeGreaterThan(revealForm);
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
    const saveSuccess = page.indexOf("setStatus('success', 'บันทึกรายการสำเร็จ'");
    const dashboardRefresh = page.indexOf("await loadDashboard();", saveSuccess);

    expect(saveSuccess).toBeGreaterThanOrEqual(0);
    expect(dashboardRefresh).toBeGreaterThan(saveSuccess);
  });

  it("hydrates the verification form from an upload_id in the LIFF URL", () => {
    expect(page).toContain("new URLSearchParams(window.location.search).get('upload_id')");
    expect(page).toContain("fetch(`/api/slips/pending/${encodeURIComponent(urlUploadId)}`");
    expect(page).toContain("ลิงก์อาจหมดอายุหรือไม่ใช่ของผู้ใช้");
    expect(page).toContain("uploadId = urlUploadId");
  });

  it("makes the first-time workflow and dashboard boundaries explicit", () => {
    expect(page).toContain('aria-label="ขั้นตอนการบันทึกรายการ"');
    expect(page).toContain("เลือกรูปสลิปเพื่อเริ่มต้น");
    expect(page).toContain("รองรับไฟล์ JPG, PNG และ WEBP");
    expect(page).toContain('aria-labelledby="workflow-title"');
    expect(page).toContain('aria-labelledby="dashboard-title"');
    expect(page).toContain("Dashboard");
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

  it("exposes dashboard range controls and recent items using the same API range", () => {
    expect(page).toContain('id="dashboard-range"');
    expect(page).toContain('id="dashboard-start" type="date"');
    expect(page).toContain('id="dashboard-end" type="date"');
    expect(page).toContain("new URLSearchParams({ start: $('dashboard-start').value, end: $('dashboard-end').value })");
    expect(page).toContain("data.recent || []");
    expect(page).toContain('id="recent-list"');
  });

  it("provides authenticated history/detail loading with pagination and signed image rendering", () => {
    expect(page).toContain('id="history-filter"');
    expect(page).toContain("fetch(`/api/transactions?${params}`");
    expect(page).toContain('id="history-category"');
    expect(page).toContain('id="history-sort"');
    expect(page).toContain('id="history-start" type="date"');
    expect(page).toContain('id="history-end" type="date"');
    expect(page).toContain("fetch(`/api/transactions/${encodeURIComponent(transactionId)}`");
    expect(page).toContain("history-prev");
    expect(page).toContain("history-next");
    expect(page).toContain('alt="ภาพสลิปต้นฉบับ"');
    expect(page).toContain("await requireAuth()");
    expect(page).not.toContain("slip_image_url: 'https://");
  });

  it("provides authenticated CSV/XLSX exports using the active history filters", () => {
    expect(page).toContain('id="export-csv"');
    expect(page).toContain('id="export-xlsx"');
    expect(page).toContain("/api/transactions/export?");
    expect(page).toContain("await response.blob()");
    expect(page).toContain("headers: authHeaders(token)");
    expect(page).toContain("q: $('history-search').value");
    expect(page).toContain("$('history').append($('export-actions'))");
    expect(page).not.toContain("token=");
  });

  it("clears dashboard and history loading states when auth is unavailable", () => {
    expect(page).toContain("const token = await requireAuth(); if (!token) { $('dashboard-loading').hidden = true;");
    expect(page).toContain("const token = await requireAuth(); if (!token) { $('history-loading').hidden = true;");
  });

  it("keeps the upload CTA state visible and lets users close detail safely", () => {
    expect(page).toContain("previousElementSibling.setAttribute('aria-disabled'");
    expect(page).toContain('id="detail-close"');
    expect(page).toContain("$('transaction-detail').hidden = true");
    expect(page).toContain("await loadHistory();");
  });
});
