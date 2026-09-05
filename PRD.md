# Product Requirements Document (PRD)

## LINE AI Slip Expense Tracker & LIFF Dashboard

- **สถานะ:** Draft
- **เวอร์ชัน:** 1.0
- **วันที่:** 2026-09-05

## 1. ภาพรวมโครงการ

ระบบบันทึกและบริหารจัดการรายรับ-รายจ่ายผ่าน LINE ผู้ใช้สามารถส่งภาพสลิปในแชท LINE หรืออัปโหลดผ่าน LIFF Web App ระบบจะใช้ AI อ่านข้อมูลจากภาพสลิป แปลงเป็นข้อมูลรายการ ตรวจสอบแก้ไขก่อนบันทึก และแสดงรายงานย้อนหลังแบบรายวันและรายเดือน

### เป้าหมาย

- ลดเวลาการกรอกรายรับ-รายจ่ายด้วยตนเอง
- อ่านข้อมูลจากสลิปและจัดหมวดหมู่อัตโนมัติ
- ให้ผู้ใช้ตรวจสอบข้อมูลก่อนบันทึกจริง
- ดูภาพรวมและประวัติรายการได้จาก LINE โดยไม่ต้องติดตั้งแอปแยก

### ขอบเขต MVP

การรับสลิปผ่าน LINE, OCR/AI extraction, การยืนยันข้อมูลผ่าน LIFF, การบันทึกข้อมูลแบบแยกผู้ใช้, Dashboard รายวัน/รายเดือน, ประวัติรายการ และการส่งสรุปกลับผ่าน LINE

## 2. ผู้ใช้งานและ User Journey

### Flow A: บันทึกผ่าน LINE Chat

1. ผู้ใช้ส่งภาพสลิปเข้า LINE Official Account
2. Backend รับ Webhook และดาวน์โหลดภาพจาก LINE Content API
3. AI อ่านข้อมูลและจัดหมวดหมู่
4. ระบบส่ง Flex Message สรุปรายการ พร้อมปุ่มเปิด LIFF เพื่อดูหรือแก้ไข
5. ผู้ใช้ยืนยันข้อมูล และระบบบันทึกลงฐานข้อมูล

### Flow B: บันทึกผ่าน LIFF

1. ผู้ใช้กด “สแกนสลิปด่วน” จาก Rich Menu
2. เลือกหรือถ่ายภาพสลิป
3. ระบบประมวลผลและแสดงหน้า Verify & Save
4. ผู้ใช้ตรวจสอบ/แก้ไขข้อมูล
5. กดบันทึก และเห็นผลลัพธ์สำเร็จพร้อมยอดสรุป

### Flow C: ดูรายงาน

ผู้ใช้เปิด LIFF จาก Rich Menu → เลือกช่วงเวลา → ดูยอดรายรับ/รายจ่ายและกราฟ → แตะรายการเพื่อดูรายละเอียดและภาพสลิปต้นฉบับ

## 3. Functional Requirements

| รหัส | ฟีเจอร์ | รายละเอียด | ความสำคัญ |
|---|---|---|---|
| FR-01 | Slip OCR Upload | รับภาพสลิปผ่าน LINE Chat และปุ่มสแกนใน LIFF App | Must-Have |
| FR-02 | AI Data Extraction | อ่านยอดเงิน วันที่-เวลา ชื่อผู้รับ/ผู้โอน และจัดหมวดหมู่อัตโนมัติ | Must-Have |
| FR-03 | Data Verification (LIFF) | แสดงข้อมูลที่ AI อ่านได้ใน Modal/Form ให้ผู้ใช้ตรวจสอบและแก้ไขก่อนบันทึก | Should-Have |
| FR-04 | Daily/Monthly Dashboard | แสดงยอดรวมรายรับ-รายจ่าย รายวัน รายเดือน และกราฟแยกตามหมวดหมู่ | Must-Have |
| FR-05 | Transaction History | แสดงรายการย้อนหลังแบบตาราง/ลิสต์ และเปิดดูรายละเอียดพร้อมภาพสลิปต้นฉบับได้ | Must-Have |
| FR-06 | Flex Message Summary | ส่งยอดเงินและหมวดหมู่กลับเข้า LINE Chat ทันทีเมื่อบันทึกสำเร็จ | Should-Have |

### กฎการทำงานสำคัญ

- รายการทุกแถวต้องผูกกับ `line_user_id` ของเจ้าของรายการ
- จำนวนเงินต้องมากกว่า 0 และใช้ทศนิยม 2 ตำแหน่ง
- ประเภทรายการต้องเป็น `income` หรือ `expense`
- หาก AI อ่านข้อมูลสำคัญไม่ได้ ระบบต้องแจ้งให้ผู้ใช้แก้ไขก่อนบันทึก
- การบันทึกสำเร็จต้องไม่สร้างรายการซ้ำจาก Webhook เดิม
- ผู้ใช้ต้องเข้าถึงได้เฉพาะข้อมูลของตนเอง

## 4. Data Schema

| ฟิลด์ | ประเภท | คำอธิบาย |
|---|---|---|
| `id` | UUID | รหัสอ้างอิงรายการ |
| `line_user_id` | String | LINE User ID สำหรับแยกข้อมูลผู้ใช้ |
| `type` | Enum | `income` หรือ `expense` |
| `amount` | Decimal(12,2) | จำนวนเงิน |
| `payee_payer` | String | ชื่อผู้รับเงินหรือผู้โอน |
| `category` | String | หมวดหมู่ เช่น อาหาร เดินทาง ช้อปปิ้ง บิล |
| `transaction_datetime` | Timestamp | วันและเวลาตามสลิป |
| `slip_image_url` | String | URL ภาพสลิปใน Object Storage |
| `created_at` | Timestamp | วันที่สร้างรายการในระบบ |

### หมวดหมู่เริ่มต้น

อาหารและเครื่องดื่ม, เดินทาง, ช้อปปิ้ง, บิลและสาธารณูปโภค, เงินเดือน/รายได้, โอนเงิน, อื่น ๆ

## 5. Architecture & Tech Stack

### Stack ที่เสนอสำหรับ MVP

- **Frontend:** LIFF SDK, HTML/Tailwind CSS, Chart.js
- **Backend:** Node.js + Express
- **AI Engine:** Google Gemini API สำหรับอ่านสลิปและคืนค่า JSON
- **Database/Storage:** Supabase PostgreSQL + Object Storage
- **LINE Integration:** LINE Messaging API, Webhook, Content API, Flex Message
- **Deployment:** Vercel หรือ Render

Google Sheets API + Cloudinary สามารถใช้เป็นทางเลือกสำหรับ prototype ได้ แต่ Supabase เหมาะกับการทำ Row Level Security และการเติบโตของระบบในระยะถัดไป

### System Workflow

```text
LINE Chat / LIFF Upload
        ↓
LINE Webhook / LIFF API
        ↓
Download & Store Slip Image
        ↓
Gemini Vision → Structured JSON
        ↓
Verify & Edit in LIFF
        ↓
Supabase Transaction + Storage
        ↓
Dashboard / Flex Message Summary
```

### ตัวอย่างผลลัพธ์จาก AI

```json
{
  "type": "expense",
  "amount": 250.00,
  "date": "2026-09-05",
  "time": "10:30",
  "payee_payer": "นายสมชาย (ธ.กสิกรไทย)",
  "category": "อาหารและเครื่องดื่ม"
}
```

## 6. Non-Functional Requirements

- **Performance:** เป้าหมายประมวลผลและแสดงผลภายใน 3–5 วินาทีในกรณีปกติ
- **Security:** ตรวจสอบตัวตนจาก LIFF/LINE และกรองข้อมูลด้วย `line_user_id` ทุกครั้ง
- **Privacy:** ไม่เปิดเผยภาพสลิปหรือรายการของผู้ใช้รายอื่น
- **Usability:** Responsive บนมือถือและใช้งานได้ภายใน LINE WebView
- **Reliability:** รองรับการ retry Webhook และป้องกันการบันทึกซ้ำด้วย message/event ID
- **Observability:** บันทึก error, processing time และสถานะ AI extraction โดยไม่เก็บ secret ใน log

## 7. UX/UI Design

แนวคิดหลักคือ **Fast Capture, Clear Visual** — สแกนไว ตรวจสอบง่าย และเห็นภาพรวมชัดเจน

### LINE Rich Menu

- 📸 **สแกนสลิปด่วน** — เปิด LIFF สำหรับอัปโหลด
- 📊 **สรุปรายเดือน** — เปิด Dashboard
- 📜 **ประวัติรายการ** — เปิด Transaction History

### Screen 1: Verify & Save

- Header แสดง Thumbnail สลิป และปุ่มดูภาพเต็ม
- ฟอร์มแก้ไขข้อมูล: ประเภท, จำนวนเงิน, หมวดหมู่, ผู้รับ/ผู้โอน, วันที่-เวลา
- หมวดหมู่ใช้ Selectable Pills/Chips
- ปุ่ม **บันทึกข้อมูล** เป็น Sticky Bottom Action สีเขียว LINE
- แสดงสถานะกำลังประมวลผลและข้อความ error ที่แก้ไขได้

### Screen 2: Dashboard

- ตัวเลือกช่วงเวลา: วันนี้ / เดือนนี้ / กำหนดเอง
- Overview Cards: รายรับสีเขียว และรายจ่ายสีแดง
- Donut Chart แสดงสัดส่วนรายจ่ายตามหมวดหมู่
- Trend/Bar Chart แสดงยอดรายวันหรือรายเดือน
- Recent List แสดง 5 รายการล่าสุดพร้อมไอคอนหมวดหมู่

### Screen 3: Transaction History

- Search ชื่อผู้รับ/ผู้โอน
- Filter ตามประเภท หมวดหมู่ และช่วงวันที่
- ลิสต์เรียงจากใหม่ไปเก่า
- คลิกแต่ละรายการเพื่อเปิด Modal รายละเอียดและภาพสลิปต้นฉบับ

### Design Tokens

| องค์ประกอบ | สี |
|---|---|
| LINE Primary | `#06C755` |
| Expense | `#FF4D4D` |
| Income | `#16A34A` |
| Background | `#F7F9F8` |
| Text Primary | `#1F2937` |
| Text Secondary | `#6B7280` |
| Border | `#E5E7EB` |

## 8. Acceptance Criteria (MVP)

- ส่งภาพสลิปเข้า LINE แล้วระบบรับ Webhook และประมวลผลได้
- AI คืนข้อมูล JSON ตาม schema และแสดงผลให้ผู้ใช้ตรวจสอบ
- ผู้ใช้แก้ไขข้อมูลและบันทึกได้สำเร็จ
- ผู้ใช้เห็นเฉพาะรายการของตนเอง
- Dashboard คำนวณยอดรายรับ/รายจ่ายรายวันและรายเดือนได้ถูกต้อง
- เปิดประวัติรายการและดูภาพสลิปต้นฉบับได้
- LINE ส่งข้อความยืนยันหรือ Flex Message หลังบันทึกสำเร็จ
- หน้า LIFF ใช้งานได้บนหน้าจอมือถือ

## 9. Open Questions

1. จะเลือก Supabase เป็น production database หรือใช้ Google Sheets ใน prototype ก่อน?
2. ต้องการรองรับสลิปธนาคารใดบ้างใน MVP?
3. ผู้ใช้สามารถเพิ่ม/แก้ไขหมวดหมู่เองได้หรือไม่?
4. ต้องมีระบบ export CSV/Excel หรือไม่?
5. ต้องการรองรับหลายสกุลเงินหรือเฉพาะเงินบาท?
