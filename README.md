# Mee Stock · ระบบบริหารคลังสินค้า (Inventory Management)

แอปจัดการคลังสินค้าที่ทำงานได้จริง พัฒนาต่อจากดีไซน์ `StockFlow.dc.html` (Claude Design Composer)
ให้กลายเป็นเว็บแอป React + Vite ที่ **เก็บข้อมูลถาวร** ผ่าน Supabase และ **deploy ขึ้นโฮสต์ฟรี** ได้

[Mee Stock]([https://example.com](https://mee-my-inventory-management.vercel.app/)){target="_blank"}

## ฟีเจอร์
- 🔐 เข้าสู่ระบบแยกสิทธิ์ **Admin / User**
- 📥 **รับเข้า** / 📤 **จ่ายออก** สินค้า พร้อมตัด-เพิ่มสต๊อกตามโซนอัตโนมัติ
- 📦 จัดการ **รายการสินค้า** (SKU, หมวดหมู่, หน่วยนับ, ราคา, จุดสั่งซื้อขั้นต่ำ, บาร์โค้ด)
- 🏬 ระบบ **คลัง → โซน (Location)** ติดตามคงเหลือแต่ละโซนแบบเรียลไทม์
- 📊 **รายงานคงเหลือ** แยกตาม Location และ **รายงานการเคลื่อนไหว** (รับเข้า–จ่ายออก)
- 🔖 สร้าง **Barcode / QR Code** + หน้าจำลองการสแกน
- 👥 **จัดการผู้ใช้งาน** (เพิ่ม/แก้ไข/ลบ, รหัสผ่านเข้ารหัส XOR+Base64)
- 🎨 เปลี่ยน **ธีมสี 5 แบบ** + โหมดมืด/สว่าง พร้อมเอฟเฟกต์เคลื่อนไหว

---

## 1) รันบนเครื่องตัวเอง (Local)

```bash
npm install
npm run dev
```

เปิด http://localhost:5173

> ถ้ายังไม่ได้ตั้งค่า Supabase แอปจะทำงานได้ทันทีโดยเก็บข้อมูลไว้ใน **localStorage** ของเบราว์เซอร์
> (เหมาะกับการลองเล่น แต่ข้อมูลจะอยู่แค่ในเครื่อง/เบราว์เซอร์นั้น และไม่แชร์ข้ามผู้ใช้)

**บัญชีเริ่มต้นสำหรับเข้าสู่ระบบ**
| สิทธิ์ | Username | Password |
|--------|----------|----------|
| Admin  | `Admin01` | `Admin001` |
| User   | `User01`  | `User001`  |

---

## 2) ต่อฐานข้อมูลจริงด้วย Supabase (ฟรี)

### ทำไมเลือก Supabase?
ใช้ฐานข้อมูล **PostgreSQL** จริง มี API สำเร็จรูป + ระบบ Auth ในตัว และ free tier ใจกว้าง

| บริการฟรี | ฐานข้อมูล | จุดเด่น | ข้อจำกัด free tier |
|-----------|-----------|---------|---------------------|
| **Supabase** ✅ (ที่ใช้) | PostgreSQL 500 MB | SQL จริง + Auth + REST/Realtime API | พัก project ถ้าไม่มีทราฟฟิก 7 วัน (ปลุกกลับได้) |
| Firebase Firestore | NoSQL | Realtime ดีมาก | query ซับซ้อนยาก, โครงสร้างต่างจาก SQL |
| Neon / Turso | PostgreSQL / SQLite | เร็ว, serverless | ต้องเขียน backend เอง |
| PlanetScale | MySQL | สเกลดี | ยกเลิก free tier แล้ว |

### ขั้นตอนตั้งค่า
1. สมัคร/เข้า https://supabase.com → **New project** (ตั้งรหัสผ่าน database ไว้)
2. ไปเมนู **SQL Editor** → **New query** → คัดลอกทั้งหมดจากไฟล์ [`supabase/schema.sql`](supabase/schema.sql) → กด **Run**
   (สร้างตาราง products, users, warehouses, zones, stock, movements, settings)
3. ไปเมนู **Settings → API** คัดลอกค่า 2 ตัว:
   - **Project URL**
   - **anon public** key
4. ที่โฟลเดอร์โปรเจกต์ คัดลอก `.env.example` เป็น `.env` แล้วใส่ค่า:
   ```env
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGci....
   ```
5. `npm run dev` อีกครั้ง — ครั้งแรกแอปจะ **seed ข้อมูลตัวอย่างลง Supabase อัตโนมัติ**
   หลังจากนั้นทุกการเปลี่ยนแปลง (รับเข้า/จ่ายออก/แก้สินค้า/ผู้ใช้) จะถูกบันทึกลงฐานข้อมูลจริง

> 🔒 **หมายเหตุความปลอดภัย:** `schema.sql` ตั้ง Row Level Security แบบ "อนุญาตทุกคน" เพื่อให้เริ่มใช้ได้ทันที
> เมื่อจะใช้งานจริงจังควรเปลี่ยนไปผูกกับ **Supabase Auth** แล้วกำหนด policy ให้รัดกุมขึ้น
> และรหัสผ่านผู้ใช้ในแอปนี้เข้ารหัสแบบ XOR+Base64 (กันการเห็นด้วยตาเปล่า) — ยังไม่ใช่ระดับ production
> ถ้าต้องการความปลอดภัยเต็มที่ ให้ย้ายการ login ไปใช้ Supabase Auth

---

## 3) Deploy ขึ้นโฮสต์ฟรี

| โฮสต์ฟรี | เหมาะกับ | หมายเหตุ |
|----------|----------|----------|
| **Vercel** ✅ (แนะนำ) | React/Vite | เชื่อม GitHub → deploy อัตโนมัติทุก push, โดเมน `.vercel.app` ฟรี |
| Netlify | React/Vite | ลากไฟล์ในโฟลเดอร์ `dist` ไปวางก็ได้ (ไม่ต้องใช้ GitHub) |
| Cloudflare Pages | static | CDN ทั่วโลก, bandwidth ไม่จำกัด |

### วิธี deploy ด้วย Vercel (แนะนำ)
1. push โค้ดขึ้น GitHub (สร้าง repo ใหม่แล้ว `git init && git add . && git commit && git push`)
2. เข้า https://vercel.com → **Add New → Project** → เลือก repo นี้
3. Vercel จะตรวจเจอ Vite เอง (Build = `npm run build`, Output = `dist`)
4. กด **Environment Variables** ใส่ 2 ตัวให้ตรงกับ `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. กด **Deploy** — เสร็จแล้วได้ลิงก์ใช้งานจริงทันที

> ไม่อยากใช้ GitHub? รัน `npm run build` แล้วลากโฟลเดอร์ `dist` ไปวางที่ https://app.netlify.com/drop
> (อย่าลืมตั้ง Environment Variables เช่นกัน ไม่งั้นจะ fallback เป็น localStorage)

---

## โครงสร้างโปรเจกต์

```
StockFlow.dc.html        ← ดีไซน์ต้นฉบับ (Claude Design Composer) — เป็น "แหล่งความจริง" ของ UI
scripts/prepare.mjs      ← แปลงต้นฉบับเป็น template/styles/component ตอน build (อัตโนมัติ)
src/
  runtime.jsx            ← รันไทม์เล็ก ๆ แทน support.js: คอมไพล์เทมเพลต DC → React + auto-save
  db.js                  ← ชั้นเก็บข้อมูล: Supabase หรือ localStorage
  main.jsx               ← โหลดข้อมูล, render, hydrate, seed, ตั้ง auto-save (debounce)
  generated/             ← ไฟล์ที่สร้างอัตโนมัติจาก StockFlow.dc.html (อย่าแก้ตรงนี้)
supabase/schema.sql      ← SQL สร้างตารางทั้งหมด
```

### อยากแก้หน้าตา/ตรรกะ?
แก้ที่ **`StockFlow.dc.html`** (ไฟล์ดีไซน์เดิม) แล้วรัน `npm run dev` — สคริปต์จะ regenerate ให้เอง
ไม่ต้องแตะไฟล์ใน `src/generated/`
