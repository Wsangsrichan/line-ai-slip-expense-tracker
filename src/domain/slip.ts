import { z } from "zod";

export const categories = [
  "อาหาร",
  "เดินทาง",
  "ที่พัก",
  "ช้อปปิ้ง",
  "บิล/สาธารณูปโภค",
  "สุขภาพ",
  "บันเทิง",
  "อื่น ๆ",
] as const;

const legacyCategoryNames: Record<string, typeof categories[number]> = {
  "อาหารและเครื่องดื่ม": "อาหาร",
  "บิลและสาธารณูปโภค": "บิล/สาธารณูปโภค",
  "เงินเดือน/รายได้": "อื่น ๆ",
  "โอนเงิน": "อื่น ๆ",
};

export function normalizeCategory(value: string) {
  return (categories.includes(value as typeof categories[number])
    ? value
    : legacyCategoryNames[value] ?? "อื่น ๆ") as typeof categories[number];
}

export const extractionSchema = z.object({
  type: z.enum(["income", "expense", "unknown"]),
  amount: z.number().finite().positive(),
  payee_payer: z.string().trim().min(1),
  category: z.string().trim().min(1).transform(normalizeCategory),
  transaction_datetime: z.string().datetime({ offset: true }),
  bank: z.string().trim().min(1).optional(),
});

export type SlipExtraction = z.infer<typeof extractionSchema>;

export function validateForSave(input: unknown) {
  const result = extractionSchema.safeParse(input);
  if (result.success) return result;

  return {
    success: false as const,
    errors: result.error.issues.map((issue) => ({
      field: String(issue.path[0] ?? "unknown"),
      message: issue.message,
    })),
  };
}
