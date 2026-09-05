import { z } from "zod";

export const categories = [
  "อาหารและเครื่องดื่ม",
  "เดินทาง",
  "ช้อปปิ้ง",
  "บิลและสาธารณูปโภค",
  "เงินเดือน/รายได้",
  "โอนเงิน",
  "อื่น ๆ",
] as const;

export const extractionSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.number().finite().positive(),
  payee_payer: z.string().trim().min(1),
  category: z.enum(categories),
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
