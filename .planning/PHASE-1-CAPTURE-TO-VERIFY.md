# Milestone 1 — Capture-to-Verify Plan

## Public seams under test

- `POST /api/slips/extract`: รับ multipart image + validated LINE identity และคืน extraction result
- `POST /api/transactions/validate`: ตรวจ payload ก่อน save และคืน field errors
- Verify form: แสดง extraction, แก้ไขได้ และ disable Save เมื่อฟิลด์สำคัญไม่ครบ
- storage/database adapters: เรียกผ่าน interface ที่เปลี่ยนเป็น dummy adapter ได้ใน test

## Phase 1 — Foundation and test harness

- สร้าง TypeScript/Vitest/Vercel-compatible project skeleton
- เพิ่ม shared domain types, constants และ environment validation
- เพิ่ม health endpoint และ test command

Acceptance: test suite รันได้, health endpoint ตอบสำเร็จ, ไม่มี secret ใน repository

## Phase 2 — LINE/LIFF identity and upload

- สร้าง LINE identity verifier interface พร้อม dummy implementation
- รับเฉพาะ image MIME type และจำกัดขนาดไฟล์
- แยก upload route จาก extraction service

Acceptance: invalid identity/file ถูก reject, valid dummy request ผ่าน, ไม่ log token หรือไฟล์ที่เป็นความลับ

## Phase 3 — Gemini extraction and validation

- สร้าง Gemini adapter interface และ dummy response fixture
- กำหนด Zod schema: type, amount, payee/payer, category, datetime
- normalize ผลลัพธ์และเปลี่ยน malformed response เป็น actionable error
- ระบุ bank hint แบบ optional เพื่อรองรับธนาคารที่กำหนดและธนาคารอื่นโดยไม่ hard-code parser

Acceptance: valid JSON ผ่าน, amount/type/date ผิดไม่ผ่าน, missing important fields ถูกระบุรายฟิลด์

## Phase 4 — Verify form and save boundary

- สร้าง mobile-first LIFF page แบบเรียบง่าย
- แสดง thumbnail, fields และ category choices
- validate ทั้ง client และ server
- Save จะทำงานได้เฉพาะเมื่อ amount, type, payee/payer, category และ transaction datetime ครบถ้วน

Acceptance: ผู้ใช้แก้ข้อมูลได้, Save disabled/blocked เมื่อข้อมูลไม่ครบ, valid payload ถูกส่งต่อได้

## Phase 5 — Supabase database/storage

- เพิ่ม migration สำหรับ transactions และ slip assets
- เพิ่ม private storage adapter และ transaction repository
- ใช้ `line_user_id` ในทุก operation และเตรียม RLS policy
- เก็บ signed URL เฉพาะเมื่อจำเป็น

Acceptance: transaction/image ถูกบันทึกผ่าน adapter, cross-user access ถูกปฏิเสธ, local tests ใช้ dummy adapter ได้โดยไม่ต้องมี credentials จริง

## Phase 6 — API integration and verification

- รวม upload → storage → Gemini → schema validation → verify response
- เพิ่ม save endpoint ที่ใช้ validated identity และ transaction repository
- รองรับ Vercel function entrypoint โดยไม่พึ่ง long-running server
- รัน unit/integration tests และตรวจ git diff ทุก phase

Acceptance: Capture-to-Verify flow ผ่านด้วย dummy external services, error paths มี response ที่เหมาะสม, `npm test` และ typecheck ผ่าน

## Decisions assumed for implementation

- Supabase เป็น persistence หลัก
- currency เป็น THB และ category ใช้ชุดคงที่จาก PRD
- ใช้ LIFF access token เป็น input แล้ว verify ผ่าน LINE endpoint เมื่อมี credentials; local ใช้ explicit dummy mode
- AI provider ถูกห่อด้วย interface เพื่อให้ทดสอบได้โดยไม่เรียก Gemini จริง
- adaptive categorization, export และ multi-currency อยู่นอก Milestone 1
