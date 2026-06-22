// scripts/prepare.mjs
// แปลงไฟล์ต้นฉบับ StockFlow.dc.html (Claude Design Composer) ให้เป็นไฟล์ที่ Vite ใช้งานได้:
//  - src/generated/template.json  : โครงสร้าง (AST) ของเทมเพลต <x-dc>
//  - src/generated/styles.css     : CSS ทั้งหมดจาก <style>
//  - src/generated/component.js   : คลาส Component (ตรรกะเดิมทั้งหมด ไม่แก้ไข) ห่อด้วย factory
//
// ทำงานตอน build/dev อัตโนมัติ (ดู package.json: predev/prebuild) จึงไม่ต้องแก้ไฟล์ต้นฉบับด้วยมือ

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = readFileSync(resolve(ROOT, 'StockFlow.dc.html'), 'utf8');
const OUT = resolve(ROOT, 'src/generated');
mkdirSync(OUT, { recursive: true });

/* ---------- 1) ดึง CSS จาก <style>...</style> ---------- */
const styleMatch = SRC.match(/<style>([\s\S]*?)<\/style>/);
const css = styleMatch ? styleMatch[1].trim() : '';
writeFileSync(resolve(OUT, 'styles.css'), css + '\n');

/* ---------- 2) ดึงเทมเพลตจาก <x-dc> ---------- */
let tpl = SRC.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1];
// ตัด <helmet>...</helmet> และ <template ...>...</template> (thumbnail) ออก
tpl = tpl.replace(/<helmet>[\s\S]*?<\/helmet>/, '');
tpl = tpl.replace(/<template[\s\S]*?<\/template>/g, '');
tpl = tpl.trim();

/* ---------- 3) ดึงคลาส Component จาก <script type="text/x-dc"> ---------- */
const scriptMatch = SRC.match(/<script[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/);
const classSrc = scriptMatch[1].trim();

const componentModule =
`// AUTO-GENERATED จาก StockFlow.dc.html — อย่าแก้ไฟล์นี้โดยตรง (รัน \`npm run prepare:template\` เพื่อสร้างใหม่)
// คลาสด้านล่างคือตรรกะเดิมจาก prototype ทั้งหมด ไม่มีการเปลี่ยนแปลง
export default function defineComponent(React, DCLogic) {
${classSrc}
  return Component;
}
`;
writeFileSync(resolve(OUT, 'component.js'), componentModule);

/* ---------- 4) Parser เทมเพลต (ทนทาน, ไม่สน content-model ของ HTML) ---------- */
const VOID = new Set(['br','img','input','meta','hr','source','col','area','base','embed','link','param','track','wbr']);

function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([:@a-zA-Z_][-:.a-zA-Z0-9_]*)(\s*=\s*("([^"]*)"|'([^']*)'))?/g;
  let m;
  while ((m = re.exec(str))) {
    const name = m[1];
    if (m[2] == null) attrs[name] = true; // bare attribute
    else attrs[name] = decode(m[4] != null ? m[4] : (m[5] != null ? m[5] : ''));
  }
  return attrs;
}

function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < html.length) {
    if (html.startsWith('<!--', i)) { i = html.indexOf('-->', i); i = i < 0 ? html.length : i + 3; continue; }
    if (html[i] === '<') {
      const close = html[i + 1] === '/';
      const end = html.indexOf('>', i);
      if (end < 0) break;
      let raw = html.slice(i + (close ? 2 : 1), end).trim();
      i = end + 1;
      if (close) {
        // ปิด tag: pop จนกว่าจะเจอชื่อตรงกัน
        const name = raw.split(/\s/)[0].toLowerCase();
        for (let s = stack.length - 1; s > 0; s--) {
          if (stack[s].tag === name) { stack.length = s; break; }
        }
        continue;
      }
      const selfClose = raw.endsWith('/');
      if (selfClose) raw = raw.slice(0, -1).trim();
      const sp = raw.search(/\s/);
      const tag = (sp < 0 ? raw : raw.slice(0, sp)).toLowerCase();
      const attrs = sp < 0 ? {} : parseAttrs(raw.slice(sp + 1));
      const node = { tag, attrs, children: [] };
      top().children.push(node);
      if (!selfClose && !VOID.has(tag)) stack.push(node);
    } else {
      let next = html.indexOf('<', i);
      if (next < 0) next = html.length;
      const text = html.slice(i, next);
      i = next;
      if (text.trim().length) top().children.push({ text: decode(text) });
    }
  }
  return root.children;
}

const ast = parse(tpl);
writeFileSync(resolve(OUT, 'template.json'), JSON.stringify(ast));

console.log(`[prepare] template nodes=${ast.length}, css=${css.length}b, class=${classSrc.length}b -> src/generated/`);
