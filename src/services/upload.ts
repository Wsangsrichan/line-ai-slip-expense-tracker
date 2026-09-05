const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateImageUpload(contentType: string, size: number) {
  if (!IMAGE_TYPES.has(contentType)) {
    return { valid: false, message: "รองรับเฉพาะไฟล์ภาพ JPEG, PNG หรือ WebP" };
  }
  if (size <= 0 || size > MAX_IMAGE_BYTES) {
    return { valid: false, message: "ขนาดภาพต้องมากกว่า 0 และไม่เกิน 10 MB" };
  }
  return { valid: true as const };
}

export { MAX_IMAGE_BYTES };
