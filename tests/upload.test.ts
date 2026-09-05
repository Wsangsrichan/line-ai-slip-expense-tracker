import { describe, expect, it } from "vitest";
import { validateImageUpload } from "../src/services/upload.js";

describe("slip upload validation", () => {
  it("accepts supported image types under the size limit", () => {
    expect(validateImageUpload("image/jpeg", 1024).valid).toBe(true);
    expect(validateImageUpload("image/png", 1024).valid).toBe(true);
  });

  it("rejects non-images and oversized files", () => {
    expect(validateImageUpload("application/pdf", 1024).valid).toBe(false);
    expect(validateImageUpload("image/jpeg", 11 * 1024 * 1024).valid).toBe(false);
  });
});
