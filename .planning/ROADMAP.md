# MVP Roadmap

## Milestone 1: Capture-to-Verify

ส่งภาพสลิปจาก LIFF ผ่าน API, ตรวจสอบตัวตน LINE, เรียก Gemini extraction, validate schema และแสดงฟอร์ม Verify ที่ไม่อนุญาตให้ Save หากฟิลด์สำคัญไม่ครบ

### Phases

1. Foundation and test harness
2. LINE/LIFF identity and slip upload
3. Gemini extraction and schema validation
4. Verify form and save boundary
5. Supabase database/storage integration
6. Vercel-compatible API integration and end-to-end verification

## Scope fences

- ใช้ dummy placeholders สำหรับ credentials และ external calls ใน local/test เท่านั้น
- ห้ามใส่ secret จริงใน source, test fixture หรือ log
- รองรับ slip จาก KBank, UOB, Bangkok Bank, SCB, KTB, GHB และ fallback สำหรับธนาคารอื่น โดยใช้ vision extraction ไม่ทำ parser แยกธนาคารใน MVP
- ยังไม่ deploy production และยังไม่ push
