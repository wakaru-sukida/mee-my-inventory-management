// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DCLogic, setSaveHook, injectHoverStyles } from './runtime.jsx';
import defineComponent from './generated/component.js';
import { loadAll, saveAll, usingSupabase } from './db.js';
import './generated/styles.css';

// ทำให้ React เป็น global เผื่อโค้ดในคลาส (renderVals ใช้ React.createElement) อ้างถึง
window.React = React;

const Component = defineComponent(React, DCLogic);

// อ่าน snapshot ปัจจุบันออกจาก instance เพื่อบันทึก
function snapshot(inst) {
  return {
    products: inst.products,
    users: inst.users,
    zonesMeta: inst.zonesMeta,
    categories: inst.categories,
    units: inst.units,
    stock: inst.state.stock,
    movements: inst.state.movements,
  };
}

// auto-save แบบ debounce — ถูกเรียกจาก DCLogic.setState/forceUpdate
let saveTimer = null;
setSaveHook((inst) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveAll(snapshot(inst)); }, 700);
});

let inst = null;

async function boot() {
  const root = createRoot(document.getElementById('root'));
  root.render(
    React.createElement(Component, {
      ref: (r) => { inst = r; },
      brand: 'Mee Stock',
      defaultTheme: 'emerald',
      decor: true,
    })
  );
  injectHoverStyles();

  // โหลดข้อมูลจากฐานข้อมูล (หรือ localStorage)
  let data = null;
  try { data = await loadAll(); } catch (e) { console.error(e); }

  if (!inst) return;

  if (data && data.products && data.products.length) {
    // มีข้อมูลอยู่แล้ว -> hydrate เข้า instance (กันไม่ให้ trigger save ซ้ำระหว่างโหลด)
    inst._suppressSave = true;
    inst.products = data.products;
    inst.users = data.users && data.users.length ? data.users : inst.users;
    inst.zonesMeta = data.zonesMeta && data.zonesMeta.length ? data.zonesMeta : inst.zonesMeta;
    inst.categories = data.categories || [...new Set(inst.products.map((p) => p.cat))];
    inst.units = data.units || [...new Set(inst.products.map((p) => p.unit))];
    inst.rebuildZones();
    inst.setState(
      { stock: data.stock || inst.state.stock, movements: data.movements || inst.state.movements },
      () => { inst._suppressSave = false; }
    );
    console.info(`[mee-stock] โหลดข้อมูลจาก ${usingSupabase ? 'Supabase' : 'localStorage'} แล้ว`);
  } else {
    // ยังไม่มีข้อมูล -> seed ด้วยข้อมูลตัวอย่างเริ่มต้นจาก instance
    console.info(`[mee-stock] เริ่มต้นใหม่ — บันทึกข้อมูลตัวอย่างลง ${usingSupabase ? 'Supabase' : 'localStorage'}`);
    await saveAll(snapshot(inst));
  }
}

boot();
