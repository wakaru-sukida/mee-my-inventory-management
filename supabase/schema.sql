-- supabase/schema.sql
-- รัน SQL นี้ใน Supabase: เปิดโปรเจกต์ -> เมนู "SQL Editor" -> New query -> วางทั้งหมด -> Run
-- สร้างตารางทั้งหมดที่ Mee Stock ใช้งาน

create table if not exists products (
  sku     text primary key,
  name    text not null,
  cat     text,
  unit    text,
  min     integer default 0,
  price   numeric default 0,
  barcode text
);

create table if not exists users (
  id       integer primary key,
  name     text not null,
  username text unique not null,
  enc      text,            -- รหัสผ่านที่เข้ารหัสแล้ว (XOR + Base64) ไม่เก็บ plain text
  title    text,
  role     text default 'user',
  active   boolean default true
);

create table if not exists warehouses (
  id   integer primary key,
  name text not null,
  ord  integer default 0
);

create table if not exists zones (
  code         text primary key,
  warehouse_id integer references warehouses(id) on delete cascade,
  name         text,
  cap          integer default 1000,
  ord          integer default 0
);

create table if not exists stock (
  sku  text not null,
  zone text not null,
  qty  integer default 0,
  primary key (sku, zone)
);

create table if not exists movements (
  id    bigint primary key,
  ts    text,
  time  text,
  type  text,            -- 'in' | 'out'
  sku   text,
  name  text,
  qty   integer,
  zone  text,
  ref   text,
  "user" text
);

create table if not exists settings (
  key   text primary key,
  value jsonb
);

-- ===== Row Level Security =====
-- เริ่มต้นแบบง่าย: เปิดให้ผู้ใช้ทุกคน (anon key) อ่าน/เขียนได้ เพื่อให้แอปทำงานได้ทันที
-- เมื่อพร้อมขึ้น Production แนะนำเปลี่ยนมาใช้ Supabase Auth แล้วจำกัดสิทธิ์ตาม policy ที่เข้มขึ้น
alter table products   enable row level security;
alter table users      enable row level security;
alter table warehouses enable row level security;
alter table zones      enable row level security;
alter table stock      enable row level security;
alter table movements  enable row level security;
alter table settings   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['products','users','warehouses','zones','stock','movements','settings']
  loop
    execute format('drop policy if exists "allow all %1$s" on %1$s;', t);
    execute format('create policy "allow all %1$s" on %1$s for all using (true) with check (true);', t);
  end loop;
end $$;
