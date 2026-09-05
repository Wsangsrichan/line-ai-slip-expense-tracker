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
});
