// src/db.js
// ชั้นจัดเก็บข้อมูล: ใช้ Supabase ถ้าตั้งค่า env ไว้ มิฉะนั้น fallback เป็น localStorage
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const usingSupabase = !!(URL && KEY);
const sb = usingSupabase ? createClient(URL, KEY) : null;
const LS_KEY = 'mee-stock-data-v1';

/* ---------- รูปแบบข้อมูลกลาง ----------
 { products:[{sku,name,cat,unit,min,price,barcode}],
   users:[{id,name,username,enc,title,role,active}],
   zonesMeta:[{wh,zones:[{code,name,cap}]}],
   categories:[str], units:[str],
   stock:{sku:{zone:qty}}, movements:[{...}] }
------------------------------------------ */

/* ===================== localStorage adapter ===================== */
function lsLoad() {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function lsSave(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

/* ===================== Supabase adapter ===================== */
async function sbLoad() {
  const [{ data: products }, { data: users }, { data: warehouses }, { data: zones },
         { data: stockRows }, { data: movements }, { data: settings }] = await Promise.all([
    sb.from('products').select('*'),
    sb.from('users').select('*'),
    sb.from('warehouses').select('*').order('ord'),
    sb.from('zones').select('*').order('ord'),
    sb.from('stock').select('*'),
    sb.from('movements').select('*'),
    sb.from('settings').select('*'),
  ]);

  if (!products || products.length === 0) return null; // ยังไม่มีข้อมูล -> ให้ seed

  const zonesByWh = {};
  (zones || []).forEach((z) => { (zonesByWh[z.warehouse_id] ||= []).push({ code: z.code, name: z.name, cap: z.cap }); });
  const zonesMeta = (warehouses || []).map((w) => ({ wh: w.name, zones: zonesByWh[w.id] || [] }));

  const stock = {};
  (stockRows || []).forEach((r) => { (stock[r.sku] ||= {})[r.zone] = r.qty; });

  const settingsMap = {};
  (settings || []).forEach((s) => { settingsMap[s.key] = s.value; });

  return {
    products: products.map((p) => ({ sku: p.sku, name: p.name, cat: p.cat, unit: p.unit, min: p.min, price: Number(p.price), barcode: p.barcode })),
    users: (users || []).map((u) => ({ id: u.id, name: u.name, username: u.username, enc: u.enc, title: u.title, role: u.role, active: u.active })),
    zonesMeta,
    categories: settingsMap.categories || null,
    units: settingsMap.units || null,
    stock,
    movements: (movements || []).map((m) => ({ id: Number(m.id), ts: m.ts, time: m.time, type: m.type, sku: m.sku, name: m.name, qty: m.qty, zone: m.zone, ref: m.ref, user: m.user })),
  };
}

async function delMissing(table, col, keepValues) {
  const { data: existing } = await sb.from(table).select(col);
  const keep = new Set(keepValues);
  const toDel = (existing || []).map((r) => r[col]).filter((v) => !keep.has(v));
  if (toDel.length) await sb.from(table).delete().in(col, toDel);
}

async function sbSave(data) {
  // products
  await sb.from('products').upsert(data.products.map((p) => ({
    sku: p.sku, name: p.name, cat: p.cat, unit: p.unit,
    min: parseInt(p.min, 10) || 0, price: Number(p.price) || 0, barcode: p.barcode,
  })), { onConflict: 'sku' });
  await delMissing('products', 'sku', data.products.map((p) => p.sku));

  // users
  await sb.from('users').upsert(data.users.map((u) => ({
    id: u.id, name: u.name, username: u.username, enc: u.enc, title: u.title, role: u.role, active: !!u.active,
  })), { onConflict: 'id' });
  await delMissing('users', 'id', data.users.map((u) => u.id));

  // warehouses + zones (rebuild — ปริมาณน้อย)
  const { data: existingWh } = await sb.from('warehouses').select('id');
  const whRows = data.zonesMeta.map((w, i) => ({ id: i + 1, name: w.wh, ord: i }));
  await sb.from('warehouses').upsert(whRows, { onConflict: 'id' });
  const keepWh = new Set(whRows.map((w) => w.id));
  const delWh = (existingWh || []).map((r) => r.id).filter((id) => !keepWh.has(id));
  if (delWh.length) await sb.from('zones').delete().in('warehouse_id', delWh);
  if (delWh.length) await sb.from('warehouses').delete().in('id', delWh);

  const zoneRows = [];
  data.zonesMeta.forEach((w, i) => w.zones.forEach((z, j) => zoneRows.push({ code: z.code, warehouse_id: i + 1, name: z.name, cap: z.cap, ord: j })));
  if (zoneRows.length) await sb.from('zones').upsert(zoneRows, { onConflict: 'code' });
  await delMissing('zones', 'code', zoneRows.map((z) => z.code));

  // stock
  const stockRows = [];
  Object.entries(data.stock).forEach(([sku, byZone]) => Object.entries(byZone).forEach(([zone, qty]) => stockRows.push({ sku, zone, qty })));
  if (stockRows.length) await sb.from('stock').upsert(stockRows, { onConflict: 'sku,zone' });
  // prune stock ที่อ้างถึงสินค้า/โซนที่ถูกลบ
  const skuSet = new Set(data.products.map((p) => p.sku));
  const zoneSet = new Set(zoneRows.map((z) => z.code));
  const { data: existStock } = await sb.from('stock').select('sku,zone');
  for (const r of (existStock || [])) {
    if (!skuSet.has(r.sku) || !zoneSet.has(r.zone)) await sb.from('stock').delete().eq('sku', r.sku).eq('zone', r.zone);
  }

  // movements (append/upsert)
  if (data.movements.length) await sb.from('movements').upsert(data.movements.map((m) => ({
    id: m.id, ts: m.ts, time: m.time, type: m.type, sku: m.sku, name: m.name, qty: m.qty, zone: m.zone, ref: m.ref, user: m.user,
  })), { onConflict: 'id' });

  // settings: categories / units
  await sb.from('settings').upsert([
    { key: 'categories', value: data.categories },
    { key: 'units', value: data.units },
  ], { onConflict: 'key' });
}

/* ===================== public API ===================== */
export async function loadAll() {
  if (usingSupabase) {
    try { return await sbLoad(); }
    catch (e) { console.error('[db] Supabase load ล้มเหลว, ใช้ localStorage แทน:', e.message); return lsLoad(); }
  }
  return lsLoad();
}

let _saving = false, _pending = null;
export async function saveAll(data) {
  if (!usingSupabase) { lsSave(data); return; }
  if (_saving) { _pending = data; return; }
  _saving = true;
  try { await sbSave(data); }
  catch (e) { console.error('[db] Supabase save ล้มเหลว:', e.message); lsSave(data); }
  finally {
    _saving = false;
    if (_pending) { const d = _pending; _pending = null; saveAll(d); }
  }
}
